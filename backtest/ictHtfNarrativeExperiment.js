'use strict';

const IctHtfBiasEngineV2 = require(
  '../indicators/ictHtfBiasEngineV2'
);
const IctH1DeliveryEngine = require(
  '../indicators/ictH1DeliveryEngine'
);

const HORIZONS = Object.freeze([24, 48, 72]);
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);
const REPORTED_LIQUIDITY_TYPES = Object.freeze([
  'PDH', 'PDL', 'PWH', 'PWL',
]);

function rate(count, total) {
  return total > 0 ? count / total : null;
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function biasDistribution(states) {
  const result = {
    BULLISH: 0,
    BEARISH: 0,
    NEUTRAL: 0,
  };
  for (const state of states) {
    result[state.narrative.bias] += 1;
  }
  const total = states.length;
  return {
    totalSnapshots: total,
    BULLISH: {
      snapshots: result.BULLISH,
      rate: rate(result.BULLISH, total),
    },
    BEARISH: {
      snapshots: result.BEARISH,
      rate: rate(result.BEARISH, total),
    },
    NEUTRAL: {
      snapshots: result.NEUTRAL,
      rate: rate(result.NEUTRAL, total),
    },
  };
}

function extractBiasPeriods(states) {
  const periods = [];
  let current = null;
  for (const state of states) {
    const bias = state.narrative.bias;
    if (!current || current.bias !== bias) {
      if (current) periods.push(current);
      current = {
        bias,
        startIndex: state.index,
        endIndex: state.index,
        startTime: state.time,
        endTime: state.time,
        bars: 1,
      };
    } else {
      current.endIndex = state.index;
      current.endTime = state.time;
      current.bars += 1;
    }
  }
  if (current) periods.push(current);
  return periods;
}

function summarizeDurations(periods) {
  const result = {};
  for (const bias of ['BULLISH', 'BEARISH', 'NEUTRAL']) {
    const values = periods
      .filter((period) => period.bias === bias)
      .map((period) => period.bars * 4);
    result[bias] = {
      periods: values.length,
      averageHours: average(values),
      medianHours: median(values),
      maxHours: values.length > 0 ? Math.max(...values) : null,
    };
  }
  return result;
}

function extractBiasEvents(states) {
  const events = [];
  let previousBias = null;
  for (const state of states) {
    const bias = state.narrative.bias;
    if (bias !== previousBias && bias !== 'NEUTRAL') {
      events.push({
        index: state.index,
        availableIndex: state.availableIndex,
        time: state.time,
        year: new Date(state.time).getUTCFullYear(),
        bias,
        referencePrice: state.referencePrice,
        primaryDraw: state.narrative.primaryDraw
          ? { ...state.narrative.primaryDraw }
          : null,
      });
    }
    previousBias = bias;
  }
  return events;
}

function evaluateDraw(event, h4Klines, horizonHours) {
  const horizonBars = horizonHours / 4;
  const endIndex = event.index + horizonBars;
  if (
    !event.primaryDraw ||
    !Number.isInteger(horizonBars) ||
    endIndex >= h4Klines.length
  ) {
    return null;
  }
  let hitIndex = null;
  for (
    let index = event.index + 1;
    index <= endIndex;
    index += 1
  ) {
    const hit = event.primaryDraw.side === 'BUY_SIDE'
      ? h4Klines[index].high >= event.primaryDraw.price
      : h4Klines[index].low <= event.primaryDraw.price;
    if (hit) {
      hitIndex = index;
      break;
    }
  }
  return {
    horizonHours,
    targetType: event.primaryDraw.type,
    hit: Number.isInteger(hitIndex),
    hitIndex,
  };
}

function attachOutcomes(events, h4Klines, horizons) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateDraw(event, h4Klines, hours),
    ])),
  }));
}

function summarizeDraws(events, horizonHours) {
  const key = horizonHours + 'h';
  const outcomes = events
    .map((event) => event.outcomes[key])
    .filter(Boolean);
  const hits = outcomes.filter((outcome) => outcome.hit).length;
  return {
    eligibleEvents: outcomes.length,
    hits,
    hitRate: rate(hits, outcomes.length),
  };
}

function summarizeLiquidityTypes(events, horizonHours) {
  const key = horizonHours + 'h';
  return Object.fromEntries(REPORTED_LIQUIDITY_TYPES.map((type) => {
    const outcomes = events
      .map((event) => event.outcomes[key])
      .filter((outcome) => outcome && outcome.targetType === type);
    const hits = outcomes.filter((outcome) => outcome.hit).length;
    return [
      type,
      {
        eligibleEvents: outcomes.length,
        hits,
        hitRate: rate(hits, outcomes.length),
      },
    ];
  }));
}

function summarizeHorizons(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => [
    hours + 'h',
    {
      primaryDraw: summarizeDraws(events, hours),
      liquidityTypes: summarizeLiquidityTypes(events, hours),
    },
  ]));
}

function buildYearly(states, periods, events, years, horizons) {
  return Object.fromEntries(years.map((year) => {
    const yearStates = states.filter(
      (state) => new Date(state.time).getUTCFullYear() === year
    );
    const yearPeriods = periods.filter(
      (period) => new Date(period.startTime).getUTCFullYear() === year
    );
    const yearEvents = events.filter((event) => event.year === year);
    return [
      String(year),
      {
        biasDistribution: biasDistribution(yearStates),
        biasDuration: summarizeDurations(yearPeriods),
        eventCount: yearEvents.length,
        horizons: summarizeHorizons(yearEvents, horizons),
      },
    ];
  }));
}

function analyze(input) {
  input = input || {};
  const horizons = input.horizons || HORIZONS;
  const years = input.years || YEARS;
  const h4 = IctHtfBiasEngineV2.analyze({
    h4Klines: input.h4Klines,
  });
  const h1 = IctH1DeliveryEngine.analyze({
    h1Klines: input.h1Klines,
    h4States: h4.states,
  });
  const periods = extractBiasPeriods(h4.states);
  const events = attachOutcomes(
    extractBiasEvents(h4.states),
    input.h4Klines,
    horizons
  );
  return {
    protocol: {
      experiment: 'ICT_HTF_NARRATIVE_EXPERIMENT',
      inputs: ['4H closed Klines', '1H closed Klines'],
      reads5m: false,
      readsSetup: false,
      readsEntry: false,
      readsExit: false,
      readsTrades: false,
      modifiesProduction: false,
      primaryDrawSample:
        'First snapshot of each non-neutral bias period',
    },
    source: {
      h4Klines: input.h4Klines.length,
      h1Klines: input.h1Klines.length,
      from: input.h4Klines[0].openTime,
      to: input.h4Klines[input.h4Klines.length - 1].closeTime,
    },
    biasDistribution: biasDistribution(h4.states),
    biasDuration: summarizeDurations(periods),
    eventCount: events.length,
    horizons: summarizeHorizons(events, horizons),
    yearly: buildYearly(
      h4.states,
      periods,
      events,
      years,
      horizons
    ),
    h4,
    h1,
    events,
  };
}

module.exports = {
  HORIZONS,
  REPORTED_LIQUIDITY_TYPES,
  YEARS,
  analyze,
  attachOutcomes,
  biasDistribution,
  buildYearly,
  evaluateDraw,
  extractBiasEvents,
  extractBiasPeriods,
  summarizeDraws,
  summarizeDurations,
  summarizeHorizons,
  summarizeLiquidityTypes,
};
