'use strict';

const HtfBiasV3 = require('./ictHtfBiasEngineV3');
const M15Delivery = require('./ictM15DeliveryEngine');
const LtfExecution = require('./ictLtfExecutionEngine');
const AnalystReport = require('./ictHtfAnalystReport');
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
);

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function renameIntermediateLiquidityType(type) {
  return typeof type === 'string'
    ? type.replace(/^H1_SWING_/, 'M15_SWING_')
    : type;
}

function normalizeSweep(sweep) {
  if (!sweep) return sweep;
  return {
    ...sweep,
    type: renameIntermediateLiquidityType(sweep.type),
  };
}

function normalizeMss(mss) {
  if (!mss) return mss;
  return {
    ...mss,
    sweep: mss.sweep
      ? {
        ...mss.sweep,
        level: normalizeSweep(mss.sweep.level),
      }
      : null,
  };
}

function normalizeFiveMinuteObservation(observation) {
  const result = clone(observation);
  const current = result.currentConfirmed || {};
  const latest = result.latestConfirmed || {};
  current.liquiditySweeps = (
    current.liquiditySweeps || []
  ).map(normalizeSweep);
  current.mss = normalizeMss(current.mss);
  latest.liquiditySweep =
    normalizeSweep(latest.liquiditySweep);
  latest.mss = normalizeMss(latest.mss);
  const potential = result.potentialObservation;
  if (potential && Array.isArray(potential.reasons)) {
    potential.reasons = potential.reasons.map(
      (reason) => reason.replace(
        /^H1_RELATION_/,
        'M15_RELATION_'
      )
    );
  }
  return result;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) return snapshot;
  const m15 = {
    ...clone(snapshot.oneHourAnalysis),
    timeframe: '15m',
  };
  const fiveMinute = normalizeFiveMinuteObservation(
    snapshot.fiveMinuteObservation
  );
  const normalized = {
    ...clone(snapshot),
    fifteenMinuteAnalysis: m15,
    fiveMinuteObservation: fiveMinute,
    humanSummary: HumanSummary.summarize(
      snapshot.fourHourAnalysis,
      m15,
      fiveMinute
    ),
  };
  delete normalized.oneHourAnalysis;
  return normalized;
}

function analyze(input) {
  input = input || {};
  const symbol = input.symbol || 'BTCUSDT';
  const h4 = HtfBiasV3.analyze({
    h4Klines: input.h4Klines,
  });
  const m15 = M15Delivery.analyze15mDelivery({
    m15Klines: input.m15Klines,
    h4BiasSnapshots: h4.states,
  });
  const ltf = LtfExecution.analyze({
    ltfKlines: input.ltf5mKlines,
    intervalMilliseconds: LtfExecution.FIVE_MINUTES,
    h4BiasSnapshots: h4.states,
    // Compatibility boundary for the unchanged 5m engine.
    h1DeliverySnapshots: m15.states,
    retainStates: false,
  });
  const needsSnapshots = (
    input.retainSnapshots === true ||
    typeof input.onSnapshot === 'function'
  );
  const rawTimeline = AnalystReport.buildTimeline(
    h4.states,
    m15.states,
    ltf.events,
    input.ltf5mKlines,
    needsSnapshots
  );
  const snapshots = rawTimeline.snapshots.map(
    normalizeSnapshot
  );
  if (typeof input.onSnapshot === 'function') {
    for (const snapshot of snapshots) {
      input.onSnapshot(snapshot);
    }
  }

  return {
    protocol: {
      version: 'ICT_WATCHLIST_ANALYST_REPORT_M15_V1',
      purpose: 'Human discretionary analysis assistance only',
      inputs: [
        'Complete closed 4H Klines',
        'Complete closed 15m Klines',
        'Complete closed 5m Klines',
      ],
      usesConfirmedCandles: true,
      usesAvailableIndex: true,
      prefixInvariant: true,
      readsTrades: false,
      readsBaseline: false,
      callsEntryEngine: false,
      callsRisk: false,
      callsBacktest: false,
      generatesEntryPrice: false,
      generatesStop: false,
      generatesTarget: false,
      generatesPositionSize: false,
      generatesOrder: false,
      modifiesProduction: false,
    },
    symbol,
    source: {
      h4Klines: input.h4Klines.length,
      m15Klines: input.m15Klines.length,
      ltf5mKlines: input.ltf5mKlines.length,
      from: input.ltf5mKlines[0].openTime,
      to: input.ltf5mKlines[
        input.ltf5mKlines.length - 1
      ].closeTime,
    },
    current: normalizeSnapshot(rawTimeline.current),
    snapshots: input.retainSnapshots === true
      ? snapshots
      : [],
  };
}

module.exports = {
  analyze,
  normalizeFiveMinuteObservation,
  normalizeMss,
  normalizeSnapshot,
  normalizeSweep,
  renameIntermediateLiquidityType,
};
