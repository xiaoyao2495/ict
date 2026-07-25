'use strict';

const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const H1Delivery = require('../indicators/ictH1DeliveryEngine');
const LtfExecution = require(
  '../indicators/ictLtfExecutionEngine'
);

const HORIZONS = Object.freeze([24, 48, 72]);
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);
const BULLISH_SWEEP_TYPES = new Set([
  'PDL',
  'H1_SWING_LOW',
  'EQUAL_LOW',
  'LTF_SWING_LOW',
]);
const BEARISH_SWEEP_TYPES = new Set([
  'PDH',
  'H1_SWING_HIGH',
  'EQUAL_HIGH',
  'LTF_SWING_HIGH',
]);

function rate(count, total) {
  return total > 0 ? count / total : null;
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function drawSignature(state) {
  const draw = state.narrative.primaryDraw;
  return draw
    ? [
      state.narrative.bias,
      draw.side,
      draw.type,
      draw.price,
    ].join(':')
    : state.narrative.bias + ':NO_DRAW';
}

function buildBiasPeriods(states) {
  const periods = [];
  const periodByH4Index = Array(states.length).fill(null);
  let current = null;
  let previousSignature = null;
  for (const state of states) {
    const bias = state.narrative.bias;
    const signature = drawSignature(state);
    if (
      bias === 'NEUTRAL' ||
      !state.narrative.primaryDraw
    ) {
      current = null;
      previousSignature = signature;
      continue;
    }
    if (!current || signature !== previousSignature) {
      current = {
        id: periods.length,
        bias,
        startIndex: state.index,
        endIndex: state.index,
        startTime: state.time,
        endTime: state.time,
        primaryDraw: { ...state.narrative.primaryDraw },
      };
      periods.push(current);
    } else {
      current.endIndex = state.index;
      current.endTime = state.time;
    }
    periodByH4Index[state.index] = current;
    previousSignature = signature;
  }
  return { periods, periodByH4Index };
}

function allowedSweep(direction, level) {
  if (!level) return false;
  return direction === 'BULLISH'
    ? level.side === 'SELL_SIDE' &&
      BULLISH_SWEEP_TYPES.has(level.type)
    : direction === 'BEARISH' &&
      level.side === 'BUY_SIDE' &&
      BEARISH_SWEEP_TYPES.has(level.type);
}

function periodAtTime(
  time,
  h4States,
  periodByH4Index
) {
  const h4Index = LtfExecution.latestSnapshotIndex(
    h4States,
    time
  );
  return h4Index >= 0 ? periodByH4Index[h4Index] : null;
}

function primaryDrawAhead(period, referencePrice) {
  const draw = period.primaryDraw;
  return period.bias === 'BULLISH'
    ? draw.side === 'BUY_SIDE' && draw.price > referencePrice
    : draw.side === 'SELL_SIDE' && draw.price < referencePrice;
}

function matchConfirmationEvents(
  mssEvents,
  h4States,
  periodByH4Index,
  ltfKlines
) {
  const result = [];
  const usedPeriods = new Set();
  for (const mss of mssEvents) {
    const sweep = mss.sweep;
    if (!sweep || !sweep.level) continue;
    const sweepPeriod = periodAtTime(
      sweep.time,
      h4States,
      periodByH4Index
    );
    const mssPeriod = periodAtTime(
      mss.time,
      h4States,
      periodByH4Index
    );
    if (
      !sweepPeriod ||
      !mssPeriod ||
      sweepPeriod.id !== mssPeriod.id ||
      mss.direction !== mssPeriod.bias ||
      !allowedSweep(mssPeriod.bias, sweep.level) ||
      usedPeriods.has(mssPeriod.id)
    ) {
      continue;
    }
    const referencePrice = ltfKlines[mss.index].close;
    if (!primaryDrawAhead(mssPeriod, referencePrice)) continue;
    usedPeriods.add(mssPeriod.id);
    result.push({
      periodId: mssPeriod.id,
      bias: mssPeriod.bias,
      biasTime: mssPeriod.startTime,
      primaryDraw: { ...mssPeriod.primaryDraw },
      liquidityType: mssPeriod.primaryDraw.type,
      sweep: {
        side: sweep.side,
        level: sweep.level,
        index: sweep.index,
        time: sweep.time,
      },
      mss,
      index: mss.index,
      availableIndex: mss.index,
      time: mss.time,
      year: new Date(mss.time).getUTCFullYear(),
      referencePrice,
    });
  }
  return result;
}

function countAllowedSweeps(
  sweepEvents,
  ltfKlines,
  h4States,
  periodByH4Index
) {
  return sweepEvents.filter((level) => {
    const period = periodAtTime(
      level.time,
      h4States,
      periodByH4Index
    );
    return period && allowedSweep(period.bias, level);
  }).length;
}

function evaluateEvent(event, klines, horizonHours) {
  const horizonBars = horizonHours * 12;
  const endIndex = event.index + horizonBars;
  if (endIndex >= klines.length) return null;
  const bullish = event.bias === 'BULLISH';
  let maximumHigh = -Infinity;
  let minimumLow = Infinity;
  let primaryDrawHitIndex = null;
  for (
    let index = event.index + 1;
    index <= endIndex;
    index += 1
  ) {
    const bar = klines[index];
    maximumHigh = Math.max(maximumHigh, bar.high);
    minimumLow = Math.min(minimumLow, bar.low);
    const hit = bullish
      ? bar.high >= event.primaryDraw.price
      : bar.low <= event.primaryDraw.price;
    if (hit && primaryDrawHitIndex === null) {
      primaryDrawHitIndex = index;
    }
  }
  const endClose = klines[endIndex].close;
  const directionSuccess = bullish
    ? endClose > event.referencePrice
    : endClose < event.referencePrice;
  const mfe = bullish
    ? (maximumHigh - event.referencePrice) /
      event.referencePrice * 100
    : (event.referencePrice - minimumLow) /
      event.referencePrice * 100;
  const mae = bullish
    ? (event.referencePrice - minimumLow) /
      event.referencePrice * 100
    : (maximumHigh - event.referencePrice) /
      event.referencePrice * 100;
  return {
    horizonHours,
    directionSuccess,
    primaryDrawHit: primaryDrawHitIndex !== null,
    primaryDrawHitIndex,
    mfe: Math.max(0, mfe),
    mae: Math.max(0, mae),
  };
}

function attachOutcomes(events, klines, horizons) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateEvent(event, klines, hours),
    ])),
  }));
}

function summarize(events, horizonHours) {
  const key = horizonHours + 'h';
  const outcomes = events
    .map((event) => event.outcomes[key])
    .filter(Boolean);
  const directionSuccesses = outcomes.filter(
    (outcome) => outcome.directionSuccess
  ).length;
  const primaryDrawHits = outcomes.filter(
    (outcome) => outcome.primaryDrawHit
  ).length;
  return {
    eligibleEvents: outcomes.length,
    directionSuccesses,
    directionSuccessRate: rate(
      directionSuccesses,
      outcomes.length
    ),
    primaryDrawHits,
    primaryDrawHitRate: rate(
      primaryDrawHits,
      outcomes.length
    ),
    averageMFE: average(outcomes.map((outcome) => outcome.mfe)),
    averageMAE: average(outcomes.map((outcome) => outcome.mae)),
  };
}

function summarizeHorizons(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => [
    hours + 'h',
    summarize(events, hours),
  ]));
}

function buildYearly(events, years, horizons) {
  return Object.fromEntries(years.map((year) => {
    const samples = events.filter((event) => event.year === year);
    return [
      String(year),
      {
        events: samples.length,
        directionDistribution: {
          BULLISH: samples.filter(
            (event) => event.bias === 'BULLISH'
          ).length,
          BEARISH: samples.filter(
            (event) => event.bias === 'BEARISH'
          ).length,
        },
        horizons: summarizeHorizons(samples, horizons),
      },
    ];
  }));
}

function analyze(input) {
  input = input || {};
  const horizons = input.horizons || HORIZONS;
  const years = input.years || YEARS;
  const h4 = HtfBiasV3.analyze({ h4Klines: input.h4Klines });
  const h1 = H1Delivery.analyze({
    h1Klines: input.h1Klines,
    h4BiasSnapshots: h4.states,
    includeLiquidity: false,
  });
  const ltf = LtfExecution.analyze({
    ltfKlines: input.ltf5mKlines,
    intervalMilliseconds: LtfExecution.FIVE_MINUTES,
    h4BiasSnapshots: h4.states,
    h1DeliverySnapshots: h1.states,
    retainStates: false,
  });
  const biasTimeline = buildBiasPeriods(h4.states);
  const confirmations = matchConfirmationEvents(
    ltf.events.mss,
    h4.states,
    biasTimeline.periodByH4Index,
    input.ltf5mKlines
  );
  const events = attachOutcomes(
    confirmations,
    input.ltf5mKlines,
    horizons
  );
  return {
    protocol: {
      validation:
        'ICT_HTF_BIAS_TO_LTF_CONFIRMATION_VALIDATION_V1',
      htfBiasVersion: 'ICT_HTF_BIAS_ENGINE_V3',
      flow: [
        '4H directional Bias with frozen Primary Draw',
        'Allowed opposite-side 5m liquidity sweep',
        'Same-direction 5m MSS after sweep',
        'Future delivery validation',
      ],
      readsTrades: false,
      readsBaseline: false,
      generatesEntry: false,
      parameterSearch: false,
      usesConfirmedSwings: true,
      usesAvailableIndex: true,
      modifiesProduction: false,
    },
    source: {
      h4Klines: input.h4Klines.length,
      h1Klines: input.h1Klines.length,
      ltf5mKlines: input.ltf5mKlines.length,
      from: input.ltf5mKlines[0].openTime,
      to: input.ltf5mKlines[
        input.ltf5mKlines.length - 1
      ].closeTime,
    },
    eventCounts: {
      h4BiasPeriods: biasTimeline.periods.length,
      allowedSweeps: countAllowedSweeps(
        ltf.events.sweeps,
        input.ltf5mKlines,
        h4.states,
        biasTimeline.periodByH4Index
      ),
      allLtfMss: ltf.events.mss.length,
      confirmedEvents: events.length,
    },
    directionDistribution: {
      BULLISH: events.filter(
        (event) => event.bias === 'BULLISH'
      ).length,
      BEARISH: events.filter(
        (event) => event.bias === 'BEARISH'
      ).length,
    },
    liquidityTypeDistribution: events.reduce((result, event) => {
      result[event.sweep.level.type] =
        (result[event.sweep.level.type] || 0) + 1;
      return result;
    }, {}),
    primaryDrawTypeDistribution: events.reduce(
      (result, event) => {
        result[event.liquidityType] =
          (result[event.liquidityType] || 0) + 1;
        return result;
      },
      {}
    ),
    horizons: summarizeHorizons(events, horizons),
    yearly: buildYearly(events, years, horizons),
    events,
  };
}

module.exports = {
  BEARISH_SWEEP_TYPES,
  BULLISH_SWEEP_TYPES,
  HORIZONS,
  YEARS,
  allowedSweep,
  analyze,
  attachOutcomes,
  buildBiasPeriods,
  buildYearly,
  countAllowedSweeps,
  evaluateEvent,
  matchConfirmationEvents,
  periodAtTime,
  primaryDrawAhead,
  summarize,
  summarizeHorizons,
};
