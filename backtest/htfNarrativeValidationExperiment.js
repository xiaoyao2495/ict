'use strict';

const HTFBiasEngine = require('../indicators/htfBiasEngine');
const HTFBiasExperiment = require('./htfBiasExperiment');

const HORIZONS = Object.freeze([24, 48, 72]);
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);

function nearestLiquidity(levels, referencePrice) {
  if (!levels || levels.length === 0) return null;
  const level = levels.slice().sort((left, right) => (
    Math.abs(left.price - referencePrice) -
    Math.abs(right.price - referencePrice)
  ))[0];
  return {
    side: level.side,
    type: level.type,
    price: level.price,
    availableIndex: level.availableIndex,
  };
}

function protectedLevel(state, direction) {
  const expectedLabel = direction === 'BULLISH' ? 'HL' : 'LH';
  for (
    let index = state.marketStructure.sequence.length - 1;
    index >= 0;
    index -= 1
  ) {
    const item = state.marketStructure.sequence[index];
    if (item.label === expectedLabel) {
      return {
        type: direction === 'BULLISH'
          ? 'PROTECTED_LOW'
          : 'PROTECTED_HIGH',
        price: item.price,
        index: item.index,
        availableIndex: item.availableIndex,
      };
    }
  }
  return null;
}

function extractNarrativeEvents(engineResult) {
  return HTFBiasExperiment.extractBiasEvents(engineResult)
    .map((event) => {
      const state = engineResult.h4.states[event.index];
      return {
        ...event,
        recentBuySideLiquidity: nearestLiquidity(
          state.liquidity.buySideLiquidity,
          state.referencePrice
        ),
        recentSellSideLiquidity: nearestLiquidity(
          state.liquidity.sellSideLiquidity,
          state.referencePrice
        ),
        protectedLevel: protectedLevel(state, event.direction),
      };
    });
}

function firstLiquidityHit(level, direction, h4Klines, start, end) {
  if (!level) return null;
  for (let index = start; index <= end; index += 1) {
    const hit = direction === 'BUY_SIDE'
      ? h4Klines[index].high >= level.price
      : h4Klines[index].low <= level.price;
    if (hit) return index;
  }
  return null;
}

function firstProtectedBreak(event, h4Klines, start, end) {
  if (!event.protectedLevel) return null;
  for (let index = start; index <= end; index += 1) {
    const broken = event.direction === 'BULLISH'
      ? h4Klines[index].close < event.protectedLevel.price
      : h4Klines[index].close > event.protectedLevel.price;
    if (broken) return index;
  }
  return null;
}

function expectedMssType(direction) {
  return direction === 'BULLISH'
    ? 'BEARISH_MSS'
    : 'BULLISH_MSS';
}

function findMssAfterBreak(
  event,
  breakIndex,
  endIndex,
  h4States
) {
  if (!Number.isInteger(breakIndex)) return null;
  const expected = expectedMssType(event.direction);
  for (let index = breakIndex; index <= endIndex; index += 1) {
    const structureEvent =
      h4States[index].marketStructure.lastStructureEvent;
    if (
      structureEvent &&
      structureEvent.type === expected &&
      structureEvent.availableIndex >= breakIndex &&
      structureEvent.availableIndex <= endIndex
    ) {
      return structureEvent.availableIndex;
    }
  }
  return null;
}

function evaluateEvent(
  event,
  h4Klines,
  h4States,
  horizonHours
) {
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
  for (let index = event.index + 1; index <= endIndex; index += 1) {
    maximumHigh = Math.max(maximumHigh, h4Klines[index].high);
    minimumLow = Math.min(minimumLow, h4Klines[index].low);
  }

  const opposingLevel = event.direction === 'BULLISH'
    ? event.recentSellSideLiquidity
    : event.recentBuySideLiquidity;
  const opposingSide = event.direction === 'BULLISH'
    ? 'SELL_SIDE'
    : 'BUY_SIDE';
  const opposingSweepIndex = firstLiquidityHit(
    opposingLevel,
    opposingSide,
    h4Klines,
    event.index + 1,
    endIndex
  );
  const primaryTargetHitIndex = firstLiquidityHit(
    event.primaryLiquidityTarget,
    event.primaryLiquidityTarget
      ? event.primaryLiquidityTarget.side
      : null,
    h4Klines,
    event.index + 1,
    endIndex
  );
  const protectedBreakIndex = firstProtectedBreak(
    event,
    h4Klines,
    event.index + 1,
    endIndex
  );
  const mssIndex = findMssAfterBreak(
    event,
    protectedBreakIndex,
    endIndex,
    h4States
  );
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
    opposingLiquidityEligible: Boolean(opposingLevel),
    opposingSweepIndex,
    opposingLiquiditySwept: Number.isInteger(opposingSweepIndex),
    primaryTargetEligible: Boolean(event.primaryLiquidityTarget),
    primaryTargetHitIndex,
    primaryTargetHit: Number.isInteger(primaryTargetHitIndex),
    sweepThenTarget: (
      Number.isInteger(opposingSweepIndex) &&
      Number.isInteger(primaryTargetHitIndex) &&
      opposingSweepIndex < primaryTargetHitIndex
    ),
    mfe: Math.max(0, mfe),
    mae: Math.max(0, mae),
    directionalDelivery: mfe > mae,
    protectedLevelEligible: Boolean(event.protectedLevel),
    protectedBreakIndex,
    protectedLevelBroken: Number.isInteger(protectedBreakIndex),
    expectedMssType: expectedMssType(event.direction),
    mssIndex,
    expectedMssConfirmed: Number.isInteger(mssIndex),
  };
}

function attachOutcomes(
  events,
  h4Klines,
  h4States,
  horizons
) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateEvent(event, h4Klines, h4States, hours),
    ])),
  }));
}

function outcomesFor(events, horizonHours) {
  const key = horizonHours + 'h';
  return events
    .map((event) => event.outcomes[key])
    .filter(Boolean);
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function rate(count, total) {
  return total > 0 ? count / total : null;
}

function summarizeSweep(events, horizonHours) {
  const outcomes = outcomesFor(events, horizonHours);
  const sweepEligible = outcomes.filter(
    (outcome) => outcome.opposingLiquidityEligible
  );
  const swept = sweepEligible.filter(
    (outcome) => outcome.opposingLiquiditySwept
  );
  const targetEligible = outcomes.filter(
    (outcome) => outcome.primaryTargetEligible
  );
  const targetHits = targetEligible.filter(
    (outcome) => outcome.primaryTargetHit
  );
  const sweepThenTarget = sweepEligible.filter(
    (outcome) => outcome.sweepThenTarget
  );

  return {
    events: outcomes.length,
    opposingSweepEligible: sweepEligible.length,
    opposingSweeps: swept.length,
    opposingSweepRate: rate(swept.length, sweepEligible.length),
    primaryTargetEligible: targetEligible.length,
    primaryTargetHits: targetHits.length,
    primaryTargetHitRate: rate(
      targetHits.length,
      targetEligible.length
    ),
    sweepThenTarget: sweepThenTarget.length,
    sweepThenTargetRate: rate(
      sweepThenTarget.length,
      sweepEligible.length
    ),
    conditionalSweepToTargetRate: rate(
      sweepThenTarget.length,
      swept.length
    ),
  };
}

function summarizePremiumDiscount(events, horizonHours) {
  const outcomes = outcomesFor(events, horizonHours);
  return {
    events: outcomes.length,
    averageMFE: average(outcomes.map((outcome) => outcome.mfe)),
    averageMAE: average(outcomes.map((outcome) => outcome.mae)),
    directionalDeliveryRate: rate(
      outcomes.filter((outcome) => outcome.directionalDelivery).length,
      outcomes.length
    ),
    liquidityHitRate: rate(
      outcomes.filter((outcome) => outcome.primaryTargetHit).length,
      outcomes.filter(
        (outcome) => outcome.primaryTargetEligible
      ).length
    ),
  };
}

function summarizeProtected(events, horizonHours) {
  const outcomes = outcomesFor(events, horizonHours);
  const eligible = outcomes.filter(
    (outcome) => outcome.protectedLevelEligible
  );
  const broken = eligible.filter(
    (outcome) => outcome.protectedLevelBroken
  );
  const mss = broken.filter(
    (outcome) => outcome.expectedMssConfirmed
  );
  return {
    events: outcomes.length,
    protectedLevelEligible: eligible.length,
    protectedLevelBreaks: broken.length,
    protectedLevelBreakRate: rate(broken.length, eligible.length),
    expectedMssConfirmed: mss.length,
    mssAccuracy: rate(mss.length, broken.length),
  };
}

function summarizeGroup(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => [
    hours + 'h',
    {
      sweep: summarizeSweep(events, hours),
      premiumDiscount: summarizePremiumDiscount(events, hours),
      protectedLevel: summarizeProtected(events, hours),
    },
  ]));
}

function summarizeDirections(events, horizons) {
  return {
    BULLISH: summarizeGroup(
      events.filter((event) => event.direction === 'BULLISH'),
      horizons
    ),
    BEARISH: summarizeGroup(
      events.filter((event) => event.direction === 'BEARISH'),
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
        overall: summarizeGroup(samples, horizons),
        directions: summarizeDirections(samples, horizons),
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
    extractNarrativeEvents(engineResult),
    input.h4Klines,
    engineResult.h4.states,
    horizons
  );

  return {
    protocol: {
      independentHtfValidation: true,
      reads5mSetup: false,
      readsEntry: false,
      readsExit: false,
      readsBaselineTrades: false,
      changesBiasRules: false,
      nonOverlappingBiasDefinition:
        'Only the first event in each continuous non-neutral bias period',
      protectedBreakDefinition:
        '4H close beyond the final HL/LH protected level',
      deliveryDefinition:
        'Directional MFE greater than directional MAE',
    },
    eventCount: events.length,
    overall: summarizeGroup(events, horizons),
    directions: summarizeDirections(events, horizons),
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
  expectedMssType,
  extractNarrativeEvents,
  findMssAfterBreak,
  firstLiquidityHit,
  firstProtectedBreak,
  nearestLiquidity,
  protectedLevel,
  summarizeDirections,
  summarizeGroup,
  summarizePremiumDiscount,
  summarizeProtected,
  summarizeSweep,
};
