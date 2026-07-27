'use strict';

const HtfBiasV3 = require('./ictHtfBiasEngineV3');
const H1Delivery = require('./ictH1DeliveryEngine');
const LtfExecution = require('./ictLtfExecutionEngine');
const HumanSummary = require(
  '../formatters/ictAnalystHumanSummary'
);

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function projectH4(state) {
  if (!state) {
    return {
      status: 'UNAVAILABLE',
      availableIndex: null,
      confirmedSwingSequence: [],
      currentStructure: 'UNAVAILABLE',
      dealingRange: null,
      premiumDiscount: 'UNAVAILABLE',
      externalLiquidity: {
        buySideLiquidity: [],
        sellSideLiquidity: [],
        recentlyTaken: [],
      },
      primaryDraw: null,
      bias: 'UNAVAILABLE',
      reasons: [],
    };
  }
  return {
    status: 'AVAILABLE',
    index: state.index,
    availableIndex: state.availableIndex,
    time: state.time,
    confirmedSwingSequence: clone(
      state.structure.swingSequence
    ),
    lastConfirmedSwingHigh: clone(
      state.structure.lastConfirmedSwingHigh
    ),
    lastConfirmedSwingLow: clone(
      state.structure.lastConfirmedSwingLow
    ),
    protectedHigh: clone(state.structure.protectedHigh),
    protectedLow: clone(state.structure.protectedLow),
    currentStructure: state.structure.state,
    dealingRange: clone(state.dealingRange),
    premiumDiscount: state.dealingRange.location,
    externalLiquidity: {
      buySideLiquidity: clone(
        state.liquidity.buySideLiquidity
      ),
      sellSideLiquidity: clone(
        state.liquidity.sellSideLiquidity
      ),
      recentlyTaken: clone(
        state.liquidity.recentlyTaken
      ),
    },
    primaryDraw: clone(state.narrative.primaryDraw),
    bias: state.narrative.bias,
    reasons: state.narrative.reasons.slice(),
  };
}

function projectH1(state) {
  if (!state) {
    return {
      status: 'UNAVAILABLE',
      availableIndex: null,
      confirmedSwingSequence: [],
      currentStructure: 'UNAVAILABLE',
      deliveryDirection: 'UNAVAILABLE',
      deliveryState: 'UNAVAILABLE',
      relationToH4: 'UNCLEAR',
      h4Bias: 'UNAVAILABLE',
    };
  }
  return {
    status: 'AVAILABLE',
    index: state.index,
    availableIndex: state.availableIndex,
    time: state.time,
    confirmedSwingSequence: clone(
      state.structure.swingSequence
    ),
    lastConfirmedSwingHigh: clone(
      state.structure.lastConfirmedSwingHigh
    ),
    lastConfirmedSwingLow: clone(
      state.structure.lastConfirmedSwingLow
    ),
    currentStructure: state.structure.state,
    deliveryDirection: state.deliveryDirection,
    deliveryState: state.deliveryState,
    relationToH4: state.relationToH4,
    h4Bias: state.h4Context.bias,
  };
}

function projectSweep(level) {
  return {
    id: level.id,
    type: level.type,
    side: level.side,
    price: level.price,
    status: level.status,
    availableIndex: level.sweptIndex,
    time: level.time,
  };
}

function projectDisplacement(event) {
  if (!event) return null;
  return {
    direction: event.direction,
    strength: event.strength,
    index: event.index,
    availableIndex: event.index,
    time: event.time,
  };
}

function projectMss(event) {
  if (!event) return null;
  return {
    direction: event.direction,
    brokenStructureLevel: clone(event.level),
    sweep: event.sweep
      ? {
        side: event.sweep.side,
        level: clone(event.sweep.level),
        index: event.sweep.index,
        availableIndex: event.sweep.index,
        time: event.sweep.time,
      }
      : null,
    index: event.index,
    availableIndex: event.index,
    time: event.time,
  };
}

function potentialObservation(h4, h1, mss, displacement) {
  if (!mss) {
    return {
      state: 'NONE',
      side: null,
      confirmedAt: null,
      availableIndex: null,
      reasons: ['NO_CURRENT_CONFIRMED_5M_MSS'],
      informationalOnly: true,
    };
  }
  const matchingDisplacement = displacement &&
    displacement.direction === mss.direction;
  const bullish = (
    h4.bias === 'BULLISH' &&
    mss.direction === 'BULLISH' &&
    mss.sweep &&
    mss.sweep.side === 'SELL_SIDE' &&
    matchingDisplacement
  );
  const bearish = (
    h4.bias === 'BEARISH' &&
    mss.direction === 'BEARISH' &&
    mss.sweep &&
    mss.sweep.side === 'BUY_SIDE' &&
    matchingDisplacement
  );
  if (!bullish && !bearish) {
    return {
      state: 'NONE',
      side: null,
      confirmedAt: mss.time,
      availableIndex: mss.availableIndex,
      reasons: [
        'CURRENT_5M_MSS_NOT_ALIGNED_WITH_4H_BIAS',
        'H1_RELATION_' + h1.relationToH4,
      ],
      informationalOnly: true,
    };
  }
  return {
    state: bullish
      ? 'POTENTIAL_LONG_OBSERVATION'
      : 'POTENTIAL_SHORT_OBSERVATION',
    side: bullish ? 'LONG' : 'SHORT',
    confirmedAt: mss.time,
    availableIndex: mss.availableIndex,
    reasons: [
      'CONFIRMED_OPPOSITE_SIDE_LIQUIDITY_SWEEP',
      'CONFIRMED_SAME_DIRECTION_5M_DISPLACEMENT',
      'CONFIRMED_SAME_DIRECTION_5M_MSS',
      'ALIGNED_WITH_4H_BIAS',
      'H1_RELATION_' + h1.relationToH4,
    ],
    informationalOnly: true,
  };
}

function eventIndex(event, type) {
  return type === 'sweep' ? event.sweptIndex : event.index;
}

function groupEventsByIndex(events, type) {
  const grouped = new Map();
  for (const event of events) {
    const index = eventIndex(event, type);
    if (!Number.isInteger(index)) continue;
    if (!grouped.has(index)) grouped.set(index, []);
    grouped.get(index).push(event);
  }
  return grouped;
}

function buildTimeline(
  h4States,
  h1States,
  ltfEvents,
  ltfKlines,
  retainSnapshots,
  onSnapshot
) {
  const sweepsAt = groupEventsByIndex(
    ltfEvents.sweeps,
    'sweep'
  );
  const mssAt = groupEventsByIndex(ltfEvents.mss, 'mss');
  const displacementAt = groupEventsByIndex(
    ltfEvents.displacements,
    'displacement'
  );
  let h4Index = -1;
  let h1Index = -1;
  let latestSweep = null;
  let latestMss = null;
  let latestDisplacement = null;
  let projectedH4 = projectH4(null);
  let projectedH1 = projectH1(null);
  let current = null;
  const snapshots = [];

  for (let index = 0; index < ltfKlines.length; index += 1) {
    const time = ltfKlines[index].closeTime;
    while (
      h4Index + 1 < h4States.length &&
      h4States[h4Index + 1].time <= time
    ) {
      h4Index += 1;
      projectedH4 = projectH4(h4States[h4Index]);
    }
    while (
      h1Index + 1 < h1States.length &&
      h1States[h1Index + 1].time <= time
    ) {
      h1Index += 1;
      projectedH1 = projectH1(h1States[h1Index]);
    }
    const currentSweeps = sweepsAt.get(index) || [];
    const currentMssEvents = mssAt.get(index) || [];
    const currentDisplacements =
      displacementAt.get(index) || [];
    if (currentSweeps.length > 0) {
      latestSweep = currentSweeps[
        currentSweeps.length - 1
      ];
    }
    if (currentMssEvents.length > 0) {
      latestMss = currentMssEvents[
        currentMssEvents.length - 1
      ];
    }
    if (currentDisplacements.length > 0) {
      latestDisplacement = currentDisplacements[
        currentDisplacements.length - 1
      ];
    }
    const h4 = projectedH4;
    const h1 = projectedH1;
    const currentMss = projectMss(
      currentMssEvents[
        currentMssEvents.length - 1
      ] || null
    );
    const currentDisplacement = projectDisplacement(
      currentDisplacements[
        currentDisplacements.length - 1
      ] || null
    );
    const fiveMinuteObservation = {
      index,
      availableIndex: index,
      time,
      currentConfirmed: {
        liquiditySweeps: currentSweeps.map(projectSweep),
        mss: currentMss,
        displacement: currentDisplacement,
      },
      latestConfirmed: {
        liquiditySweep: latestSweep
          ? projectSweep(latestSweep)
          : null,
        mss: projectMss(latestMss),
        displacement:
          projectDisplacement(latestDisplacement),
      },
      potentialObservation: potentialObservation(
        h4,
        h1,
        currentMss,
        currentDisplacement
      ),
    };
    current = {
      index,
      availableIndex: index,
      asOf: time,
      fourHourAnalysis: h4,
      oneHourAnalysis: h1,
      fiveMinuteObservation,
      humanSummary: HumanSummary.summarize(
        h4,
        h1,
        fiveMinuteObservation
      ),
    };
    if (typeof onSnapshot === 'function') {
      onSnapshot(current);
    }
    if (retainSnapshots) snapshots.push(current);
  }
  return { current, snapshots };
}

function analyze(input) {
  input = input || {};
  const symbol = input.symbol || 'BTCUSDT';
  const h4 = HtfBiasV3.analyze({
    h4Klines: input.h4Klines,
  });
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
  const timeline = buildTimeline(
    h4.states,
    h1.states,
    ltf.events,
    input.ltf5mKlines,
    input.retainSnapshots === true,
    input.onSnapshot
  );
  return {
    protocol: {
      version: 'ICT_HTF_ANALYST_REPORT_V1',
      purpose: 'Human discretionary analysis assistance only',
      inputs: [
        'Complete closed 4H Klines',
        'Complete closed 1H Klines',
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
      h1Klines: input.h1Klines.length,
      ltf5mKlines: input.ltf5mKlines.length,
      from: input.ltf5mKlines[0].openTime,
      to: input.ltf5mKlines[
        input.ltf5mKlines.length - 1
      ].closeTime,
    },
    current: timeline.current,
    snapshots: timeline.snapshots,
  };
}

module.exports = {
  analyze,
  buildTimeline,
  groupEventsByIndex,
  potentialObservation,
  projectDisplacement,
  projectH1,
  projectH4,
  projectMss,
  projectSweep,
};
