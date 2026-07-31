'use strict';

const Pivot = require('./pivot');
const Swing = require('./swing');
const StructureEngineV2 = require('./structureEngineV2');
const HtfBiasV3 = require('./ictHtfBiasEngineV3');
const HtfStructurePhase = require(
  './ictHtfStructurePhaseEngine'
);
const LtfExecution = require('./ictLtfExecutionEngine');
const FiveMinuteConfirmation = require(
  './ict5mConfirmationEngine'
);
const Alignment = require('./ictAlignmentEngine');
const LiquidityRoadmap = require(
  './ictLiquidityRoadmapEngine'
);
const PositionContext = require(
  './ictPositionContextEngine'
);
const OpportunityDetector = require(
  './ictOpportunityDetector'
);
const AnalystReport = require('./ictHtfAnalystReport');
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
);

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function normalizeSweep(sweep) {
  if (!sweep) return sweep;
  return { ...sweep };
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

function projectConfirmation(confirmation) {
  if (!confirmation) return null;
  return {
    status: confirmation.status,
    direction: confirmation.direction,
    sweep: normalizeSweep(confirmation.sweep),
    mss: normalizeMss(
      AnalystReport.projectMss(confirmation.mss)
    ),
    displacement: AnalystReport.projectDisplacement(
      confirmation.displacement
    ),
    index: confirmation.index,
    availableIndex: confirmation.availableIndex,
    time: confirmation.time,
  };
}

function strictPotentialObservation(
  h4,
  confirmation
) {
  if (!confirmation) {
    return {
      state: 'NONE',
      side: null,
      confirmedAt: null,
      availableIndex: null,
      reasons: ['NO_STRICT_5M_CONFIRMATION_CHAIN'],
      informationalOnly: true,
    };
  }
  const aligned = h4.bias === confirmation.direction;
  if (!aligned) {
    return {
      state: 'NONE',
      side: null,
      confirmedAt: confirmation.time,
      availableIndex: confirmation.availableIndex,
      reasons: [
        'STRICT_5M_CHAIN_NOT_ALIGNED_WITH_4H_BIAS',
      ],
      informationalOnly: true,
    };
  }
  return {
    state: confirmation.direction === 'BULLISH'
      ? 'POTENTIAL_LONG_OBSERVATION'
      : 'POTENTIAL_SHORT_OBSERVATION',
    side: confirmation.direction === 'BULLISH'
      ? 'LONG'
      : 'SHORT',
    confirmedAt: confirmation.time,
    availableIndex: confirmation.availableIndex,
    reasons: [
      'STRICT_SWEEP_MSS_DISPLACEMENT_CHAIN',
      'ALIGNED_WITH_4H_BIAS',
    ],
    informationalOnly: true,
  };
}

function normalizeFiveMinuteObservation(
  observation,
  confirmationState,
  h4
) {
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
  const confirmation = projectConfirmation(
    confirmationState
      ? confirmationState.currentConfirmation
      : null
  );
  result.currentConfirmed.confirmation = confirmation;
  result.latestConfirmed.confirmation = projectConfirmation(
    confirmationState
      ? confirmationState.latestConfirmation
      : null
  );
  if (h4) {
    result.potentialObservation =
      strictPotentialObservation(h4, confirmation);
  }
  return result;
}

function normalizeSnapshot(snapshot, confirmationState) {
  if (!snapshot) return snapshot;
  const fiveMinute = normalizeFiveMinuteObservation(
    snapshot.fiveMinuteObservation,
    confirmationState,
    snapshot.fourHourAnalysis
  );
  const currentConfirmation =
    fiveMinute.currentConfirmed.confirmation;
  const alignment = Alignment.analyze({
    h4Bias: snapshot.fourHourAnalysis.bias,
    fiveMinuteConfirmationDirection:
      currentConfirmation
        ? currentConfirmation.direction
        : null,
    fiveMinuteConfirmationStatus:
      currentConfirmation
        ? currentConfirmation.status
        : 'NONE',
  });
  const summaryInput = {
    h4: snapshot.fourHourAnalysis,
    fiveMinute,
    alignment,
  };
  const narrative =
    HumanSummary.analyzeNarrative(summaryInput);
  const normalized = {
    ...clone(snapshot),
    fiveMinuteObservation: fiveMinute,
    alignment,
    fiveMinuteConfirmationStatus:
      narrative.fiveMinuteConfirmationStatus,
    nextScenario: narrative.nextScenario,
    humanSummary: HumanSummary.summarizeTraderContext({
      ...summaryInput,
      narrative,
    }),
  };
  delete normalized.oneHourAnalysis;
  return normalized;
}

function latestStateAtOrBefore(states, timestamp) {
  if (!Array.isArray(states)) return null;
  const index = LtfExecution.latestSnapshotIndex(
    states,
    timestamp
  );
  return index >= 0 ? states[index] : null;
}

function internalLiquidityLevels(state) {
  const levels = state &&
    state.liquidity &&
    Array.isArray(state.liquidity.activeLevels)
    ? state.liquidity.activeLevels
    : [];
  return levels
    .filter((level) => level.source === 'INTERNAL')
    .map((level) => ({
      ...level,
      timeframe: '5m',
    }));
}

function collectRoadmapLiquidity(h4State, ltfState) {
  const h4Liquidity = h4State && h4State.liquidity
    ? h4State.liquidity
    : {};
  const h4Levels = (
    (h4Liquidity.buySideLiquidity || [])
      .concat(h4Liquidity.sellSideLiquidity || [])
  ).map((level) => ({
    ...level,
    timeframe: level.type === 'EQUAL_HIGH' ||
      level.type === 'EQUAL_LOW'
      ? '4H'
      : undefined,
  }));

  return h4Levels.concat(
    internalLiquidityLevels(ltfState)
  );
}

function analyzeStructurePhase(h4Klines) {
  const confirmedSwings = Swing.filterSwings(
    Pivot.findPivots(h4Klines, 2, 2)
  );
  const structure = StructureEngineV2.analyze(
    h4Klines,
    confirmedSwings,
    {
      averageLength: 20,
      displacementMultiplier: 1.5,
      minBodyRatio: 0.65,
    }
  );

  return HtfStructurePhase.analyze({
    structureEvents: structure.events,
    confirmedSwings,
    endIndex: h4Klines.length - 1,
  });
}

function analyze(input) {
  input = input || {};
  const symbol = input.symbol || 'BTCUSDT';
  const h4 = HtfBiasV3.analyze({
    h4Klines: input.h4Klines,
  });
  const structurePhaseAnalysis = analyzeStructurePhase(
    input.h4Klines
  );
  const ltf = LtfExecution.analyze({
    ltfKlines: input.ltf5mKlines,
    intervalMilliseconds: LtfExecution.FIVE_MINUTES,
    h4BiasSnapshots: h4.states,
    retainStates: true,
  });
  const confirmation = FiveMinuteConfirmation.analyze({
    events: ltf.events,
    ltf5mKlines: input.ltf5mKlines,
  });
  const needsSnapshots = (
    input.retainSnapshots === true ||
    typeof input.onSnapshot === 'function'
  );
  const rawTimeline = AnalystReport.buildTimeline(
    h4.states,
    [],
    ltf.events,
    input.ltf5mKlines,
    needsSnapshots
  );
  const snapshots = rawTimeline.snapshots.map(
    (snapshot, index) => normalizeSnapshot(
      snapshot,
      confirmation.states[index]
    )
  );
  if (typeof input.onSnapshot === 'function') {
    for (const snapshot of snapshots) {
      input.onSnapshot(snapshot);
    }
  }
  const currentTime = input.ltf5mKlines[
    input.ltf5mKlines.length - 1
  ].closeTime;
  const currentPrice = input.ltf5mKlines[
    input.ltf5mKlines.length - 1
  ].close;
  const h4State = latestStateAtOrBefore(
    h4.states,
    currentTime
  );
  const ltfState = latestStateAtOrBefore(
    ltf.states,
    currentTime
  );
  const current = normalizeSnapshot(
    rawTimeline.current,
    confirmation.states[
      confirmation.states.length - 1
    ]
  );
  current.structurePhase = {
    ...clone(structurePhaseAnalysis.current),
    state: structurePhaseAnalysis.current.structurePhase,
  };
  const roadmapLiquidity = collectRoadmapLiquidity(
    h4State,
    ltfState
  );
  current.liquidityRoadmap = LiquidityRoadmap.analyze({
    currentPrice,
    h4Bias: current.fourHourAnalysis.bias,
    liquidity: roadmapLiquidity,
  });
  current.opportunity = OpportunityDetector.detect({
    currentPrice,
    h4Bias: current.fourHourAnalysis.bias,
    liquidity: roadmapLiquidity,
  });
  current.positionContext = PositionContext.analyze({
    currentPrice,
    structureRange:
      current.fourHourAnalysis.dealingRange,
    premiumDiscount:
      current.fourHourAnalysis.premiumDiscount,
    liquidityRoadmap: current.liquidityRoadmap,
  });
  current.positionContext.context =
    HumanSummary.positionWaitingNarrative(
      current.fourHourAnalysis,
      current.positionContext
    );
  const summaryInput = {
    h4: current.fourHourAnalysis,
    fiveMinute: current.fiveMinuteObservation,
    alignment: current.alignment,
    opportunity: current.opportunity,
    liquidityRoadmap: current.liquidityRoadmap,
    positionContext: current.positionContext,
    structurePhase: current.structurePhase,
  };
  const setupAnalysis =
    HumanSummary.analyzeSetupStage(summaryInput);
  const narrative =
    HumanSummary.analyzeNarrative(summaryInput);
  current.setupStage = setupAnalysis.setupStage;
  current.missingConditions =
    setupAnalysis.missingConditions.slice();
  current.fiveMinuteConfirmationStatus =
    narrative.fiveMinuteConfirmationStatus;
  current.nextScenario = narrative.nextScenario;
  current.humanSummary =
    HumanSummary.summarizeTraderContext({
      ...summaryInput,
      setupAnalysis,
      narrative,
    });

  return {
    protocol: {
      version: 'ICT_WATCHLIST_ANALYST_REPORT_H4_5M_V1',
      purpose: 'Human discretionary analysis assistance only',
      inputs: [
        'Complete closed 4H Klines',
        'Complete closed 5m Klines',
      ],
      usesConfirmedCandles: true,
      usesAvailableIndex: true,
      prefixInvariant: true,
      includesAlignment: true,
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
      ltf5mKlines: input.ltf5mKlines.length,
      from: input.ltf5mKlines[0].openTime,
      to: input.ltf5mKlines[
        input.ltf5mKlines.length - 1
      ].closeTime,
    },
    current,
    snapshots: input.retainSnapshots === true
      ? snapshots
      : [],
  };
}

module.exports = {
  analyze,
  analyzeStructurePhase,
  collectRoadmapLiquidity,
  internalLiquidityLevels,
  latestStateAtOrBefore,
  normalizeFiveMinuteObservation,
  normalizeMss,
  normalizeSnapshot,
  normalizeSweep,
  projectConfirmation,
  strictPotentialObservation,
};
