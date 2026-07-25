'use strict';

const HTFBiasEngine = require('../indicators/htfBiasEngine');

const HORIZONS = Object.freeze([24, 48, 72]);
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);

function extractBiasEvents(engineResult) {
  const events = [];
  let previousDirection = 'NEUTRAL';

  for (const state of engineResult.h4.states) {
    const direction = state.bias.direction;
    if (
      direction !== 'NEUTRAL' &&
      direction !== previousDirection
    ) {
      events.push({
        index: state.index,
        time: state.time,
        year: new Date(state.time).getUTCFullYear(),
        direction,
        referencePrice: state.referencePrice,
        structureState: state.marketStructure.state,
        location: state.dealingRange.location,
        primaryLiquidityTarget:
          state.bias.primaryLiquidityTarget,
        reasons: state.bias.reasons.slice(),
      });
    }
    previousDirection = direction;
  }

  return events;
}

function evaluateEvent(event, h4Klines, horizonHours) {
  const horizonBars = horizonHours / 4;
  const endIndex = event.index + horizonBars;
  if (
    !Number.isInteger(horizonBars) ||
    endIndex >= h4Klines.length
  ) {
    return null;
  }

  let maximumHigh = -Infinity;
  let minimumLow = Infinity;
  let targetHit = false;
  let targetHitIndex = null;

  for (let index = event.index + 1; index <= endIndex; index += 1) {
    maximumHigh = Math.max(maximumHigh, h4Klines[index].high);
    minimumLow = Math.min(minimumLow, h4Klines[index].low);
    if (!event.primaryLiquidityTarget || targetHit) continue;
    targetHit = event.primaryLiquidityTarget.side === 'BUY_SIDE'
      ? h4Klines[index].high >= event.primaryLiquidityTarget.price
      : h4Klines[index].low <= event.primaryLiquidityTarget.price;
    if (targetHit) targetHitIndex = index;
  }

  const rawReturn = (
    h4Klines[endIndex].close / event.referencePrice - 1
  ) * 100;
  const directionalReturn = event.direction === 'BULLISH'
    ? rawReturn
    : -rawReturn;
  const mfe = event.direction === 'BULLISH'
    ? (maximumHigh - event.referencePrice) /
      event.referencePrice * 100
    : (event.referencePrice - minimumLow) /
      event.referencePrice * 100;
  const mae = event.direction === 'BULLISH'
    ? (event.referencePrice - minimumLow) /
      event.referencePrice * 100
    : (maximumHigh - event.referencePrice) /
      event.referencePrice * 100;

  return {
    horizonHours,
    endIndex,
    endTime: h4Klines[endIndex].closeTime,
    directionCorrect: directionalReturn > 0,
    rawReturn,
    return: directionalReturn,
    mfe: Math.max(0, mfe),
    mae: Math.max(0, mae),
    targetHit,
    targetHitIndex,
  };
}

function attachOutcomes(events, h4Klines, horizons) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateEvent(event, h4Klines, hours),
    ])),
  }));
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function summarize(events, horizonHours) {
  const key = horizonHours + 'h';
  const outcomes = events
    .map((event) => event.outcomes[key])
    .filter(Boolean);
  const targetOutcomes = events
    .filter((event) => (
      event.primaryLiquidityTarget &&
      event.outcomes[key]
    ))
    .map((event) => event.outcomes[key]);

  return {
    events: outcomes.length,
    accuracy: outcomes.length > 0
      ? outcomes.filter((outcome) => outcome.directionCorrect).length /
        outcomes.length
      : null,
    averageReturn: average(outcomes.map((outcome) => outcome.return)),
    averageMFE: average(outcomes.map((outcome) => outcome.mfe)),
    averageMAE: average(outcomes.map((outcome) => outcome.mae)),
    targetEligible: targetOutcomes.length,
    targetHits: targetOutcomes.filter(
      (outcome) => outcome.targetHit
    ).length,
    targetHitRate: targetOutcomes.length > 0
      ? targetOutcomes.filter((outcome) => outcome.targetHit).length /
        targetOutcomes.length
      : null,
  };
}

function summarizeHorizons(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => [
    hours + 'h',
    summarize(events, hours),
  ]));
}

function summarizePremiumDiscount(events, horizons) {
  return {
    BULLISH_DISCOUNT: summarizeHorizons(
      events.filter((event) => (
        event.direction === 'BULLISH' &&
        event.location === 'DISCOUNT'
      )),
      horizons
    ),
    BEARISH_PREMIUM: summarizeHorizons(
      events.filter((event) => (
        event.direction === 'BEARISH' &&
        event.location === 'PREMIUM'
      )),
      horizons
    ),
  };
}

function buildYearly(events, years, horizons) {
  return Object.fromEntries(years.map((year) => {
    const samples = events.filter((event) => event.year === year);
    return [
      String(year),
      {
        eventCount: samples.length,
        overall: summarizeHorizons(samples, horizons),
        premiumDiscount: summarizePremiumDiscount(
          samples,
          horizons
        ),
      },
    ];
  }));
}

function analyze(input) {
  input = input || {};
  const horizons = input.horizons || HORIZONS;
  const years = input.years || YEARS;
  const engineResult = HTFBiasEngine.analyze({
    h4Klines: input.h4Klines,
    h1Klines: input.h1Klines,
  });
  const events = attachOutcomes(
    extractBiasEvents(engineResult),
    input.h4Klines,
    horizons
  );

  return {
    protocol: {
      standaloneHtfOnly: true,
      reads5mSetup: false,
      readsBaselineTrades: false,
      readsEntryExit: false,
      changesTradingLogic: false,
      eventDefinition:
        'A new non-neutral 4H bias after a different prior bias state',
      returnDefinition:
        'Direction-adjusted close return from the bias bar close',
      excursionDefinition:
        'Future high/low excursion from the bias bar close',
    },
    eventCount: events.length,
    overall: summarizeHorizons(events, horizons),
    premiumDiscount: summarizePremiumDiscount(events, horizons),
    yearly: buildYearly(events, years, horizons),
    events,
  };
}

module.exports = {
  HORIZONS,
  YEARS,
  analyze,
  attachOutcomes,
  buildYearly,
  evaluateEvent,
  extractBiasEvents,
  summarize,
  summarizeHorizons,
  summarizePremiumDiscount,
};
