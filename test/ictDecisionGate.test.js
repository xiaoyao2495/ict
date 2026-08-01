'use strict';

const assert = require('assert');
const DecisionGate = require(
  '../indicators/ictDecisionGate'
);

const START = Date.UTC(2026, 7, 1);
const FIVE_MINUTES = 5 * 60 * 1000;
let testsPassed = 0;

function test(name, callback) {
  try {
    callback();
    testsPassed += 1;
    console.log('PASS:', name);
  } catch (error) {
    console.error('FAIL:', name);
    throw error;
  }
}

function timeAt(index) {
  return START + (index + 1) * FIVE_MINUTES - 1;
}

function current(options) {
  options = options || {};
  const bias = options.bias === undefined
    ? 'BULLISH'
    : options.bias;
  const direction = options.opportunityDirection === undefined
    ? bias
    : options.opportunityDirection;
  const index = options.index === undefined ? 20 : options.index;
  return {
    index,
    availableIndex: index,
    asOf: timeAt(index),
    fourHourAnalysis: { bias },
    structurePhase: {
      state: options.structurePhase ||
        (bias === 'BEARISH'
          ? 'BEARISH_CONFIRMED'
          : 'BULLISH_CONFIRMED'),
      direction: direction,
    },
    htfAlignment: {
      status: options.htfAlignment || 'ALIGNED',
      biasDirection: bias,
      structureDirection: direction,
    },
    opportunity: {
      status: options.opportunityStatus || 'WAITING',
      direction,
      liquidityType: options.liquidityType === undefined
        ? null
        : options.liquidityType,
      price: options.price === undefined ? null : options.price,
    },
    alignment: {
      status: options.ltfAlignment || 'WAITING',
      direction: options.ltfDirection || null,
    },
    fiveMinuteObservation: {
      index,
      availableIndex: index,
      time: timeAt(index),
      currentConfirmed: {
        liquiditySweeps: [],
        mss: null,
        displacement: null,
        confirmation: null,
      },
      latestConfirmed: {
        liquiditySweep: null,
        mss: null,
        displacement: null,
        confirmation: null,
      },
    },
  };
}

function bullishSweep(index) {
  return {
    type: 'EQUAL_LOW',
    side: 'SELL_SIDE',
    price: 90,
    availableIndex: index,
    time: timeAt(index),
  };
}

function bullishMss(index, sweep) {
  return {
    direction: 'BULLISH',
    availableIndex: index,
    time: timeAt(index),
    brokenStructureLevel: {
      type: 'LH',
      price: 101,
    },
    sweep: {
      side: sweep.side,
      level: { ...sweep },
      availableIndex: sweep.availableIndex,
      time: sweep.time,
    },
  };
}

function bullishConfirmation(
  sweepIndex,
  mssIndex,
  displacementIndex
) {
  const sweep = bullishSweep(sweepIndex);
  const mss = bullishMss(mssIndex, sweep);
  return {
    status: 'CONFIRMED',
    direction: 'BULLISH',
    sweep,
    mss,
    displacement: {
      direction: 'BULLISH',
      availableIndex: displacementIndex,
      time: timeAt(displacementIndex),
    },
    availableIndex: displacementIndex,
    time: timeAt(displacementIndex),
  };
}

function watchCurrent(index) {
  return current({
    index: index === undefined ? 20 : index,
    opportunityStatus: 'WATCH_ZONE',
    liquidityType: 'EQUAL_LOW',
    price: 90,
  });
}

function enterWatch(index) {
  return DecisionGate.analyze({
    current: watchCurrent(index),
    previousGateState: null,
  });
}

test('Neutral Bias waits for HTF direction', () => {
  const result = DecisionGate.analyze({
    current: current({
      bias: 'NEUTRAL',
      htfAlignment: 'UNDETERMINED',
      structurePhase: 'UNDETERMINED',
      opportunityDirection: null,
    }),
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.WAITING_HTF
  );
  assert.strictEqual(result.direction, null);
  assert.deepStrictEqual(result.blockers, [
    'HTF_BIAS_UNCLEAR',
  ]);
});

test('missing required analysis returns DATA_UNAVAILABLE', () => {
  const result = DecisionGate.analyze({
    current: {
      fourHourAnalysis: { bias: 'BULLISH' },
    },
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.DATA_UNAVAILABLE
  );
  assert.strictEqual(result.informationalOnly, true);
});

test('HTF Conflict blocks a directional Opportunity', () => {
  const result = DecisionGate.analyze({
    current: current({
      structurePhase: 'BEARISH_PULLBACK',
      htfAlignment: 'CONFLICT',
      opportunityStatus: 'WATCH_ZONE',
      liquidityType: 'EQUAL_LOW',
      price: 90,
    }),
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.HTF_CONFLICT
  );
  assert.strictEqual(result.activeOpportunity, null);
});

test('MSS-only HTF phase remains HTF Transition', () => {
  const result = DecisionGate.analyze({
    current: current({
      structurePhase: 'BULLISH_MSS',
      htfAlignment: 'UNDETERMINED',
      opportunityStatus: 'WATCH_ZONE',
      liquidityType: 'EQUAL_LOW',
      price: 90,
    }),
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.HTF_TRANSITION
  );
  assert.strictEqual(result.direction, 'BULLISH');
});

test('concrete aligned Opportunity enters WATCH_ZONE', () => {
  const result = enterWatch(20);

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.WATCH_ZONE
  );
  assert.deepStrictEqual(result.activeOpportunity, {
    id: 'BULLISH|EQUAL_LOW|90',
    direction: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
    price: 90,
    enteredAt: timeAt(20),
    enteredAvailableIndex: 20,
  });
  assert.strictEqual(result.informationalOnly, true);
});

test('WATCH_ZONE without concrete liquidity waits', () => {
  const result = DecisionGate.analyze({
    current: current({ opportunityStatus: 'WATCH_ZONE' }),
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.WAITING_OPPORTUNITY
  );
  assert(result.blockers.includes(
    'CONCRETE_LIQUIDITY_NOT_SELECTED'
  ));
});

test('matching Sweep advances active Opportunity to CONFIRMING', () => {
  const previous = enterWatch(20);
  const next = current({ index: 21 });
  next.fiveMinuteObservation.latestConfirmed
    .liquiditySweep = bullishSweep(21);

  const result = DecisionGate.analyze({
    current: next,
    previousGateState: previous,
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.CONFIRMING
  );
  assert.strictEqual(result.progress.sweepCompleted, true);
  assert.strictEqual(result.progress.mssCompleted, false);
});

test('matching MSS keeps the same chain CONFIRMING', () => {
  const previous = enterWatch(20);
  const sweep = bullishSweep(21);
  const next = current({ index: 22 });
  next.fiveMinuteObservation.latestConfirmed.mss =
    bullishMss(22, sweep);

  const result = DecisionGate.analyze({
    current: next,
    previousGateState: previous,
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.CONFIRMING
  );
  assert.deepStrictEqual(result.progress, {
    sweepCompleted: true,
    mssCompleted: true,
    displacementCompleted: false,
    strictConfirmationCompleted: false,
  });
});

test('strict causal chain advances to READY_OBSERVATION', () => {
  const previous = enterWatch(20);
  const next = current({
    index: 23,
    ltfAlignment: 'ALIGNED',
    ltfDirection: 'BULLISH',
  });
  next.fiveMinuteObservation.latestConfirmed.confirmation =
    bullishConfirmation(21, 22, 23);

  const result = DecisionGate.analyze({
    current: next,
    previousGateState: previous,
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.READY_OBSERVATION
  );
  assert.deepStrictEqual(result.progress, {
    sweepCompleted: true,
    mssCompleted: true,
    displacementCompleted: true,
    strictConfirmationCompleted: true,
  });
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(result, 'entry'),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(result, 'stop'),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(result, 'target'),
    false
  );
});

test('validated READY persists for the same Opportunity', () => {
  const watch = enterWatch(20);
  const confirmed = current({ index: 23 });
  confirmed.fiveMinuteObservation.latestConfirmed.confirmation =
    bullishConfirmation(21, 22, 23);
  const ready = DecisionGate.analyze({
    current: confirmed,
    previousGateState: watch,
  });
  const later = current({ index: 24 });

  const result = DecisionGate.analyze({
    current: later,
    previousGateState: ready,
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.READY_OBSERVATION
  );
  assert.strictEqual(result.transition.changed, false);
});

test('Confirmation before Opportunity cannot produce READY', () => {
  const previous = enterWatch(20);
  const next = watchCurrent(23);
  next.fiveMinuteObservation.latestConfirmed.confirmation =
    bullishConfirmation(10, 11, 12);

  const result = DecisionGate.analyze({
    current: next,
    previousGateState: previous,
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.WATCH_ZONE
  );
  assert.strictEqual(
    result.progress.strictConfirmationCompleted,
    false
  );
});

test('latest Confirmation alone cannot backfill a new Opportunity', () => {
  const input = watchCurrent(23);
  input.fiveMinuteObservation.latestConfirmed.confirmation =
    bullishConfirmation(10, 11, 12);

  const result = DecisionGate.analyze({ current: input });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.WATCH_ZONE
  );
});

test('same Opportunity preserves creation and is not recreated', () => {
  const previous = enterWatch(20);
  const result = DecisionGate.analyze({
    current: watchCurrent(21),
    previousGateState: previous,
  });

  assert.strictEqual(
    result.activeOpportunity.enteredAt,
    previous.activeOpportunity.enteredAt
  );
  assert.strictEqual(
    result.activeOpportunity.enteredAvailableIndex,
    20
  );
  assert.strictEqual(result.transition.changed, false);
});

test('existing Opportunity invalidates before Neutral handling', () => {
  const previous = enterWatch(20);
  const next = current({
    index: 21,
    bias: 'NEUTRAL',
    htfAlignment: 'UNDETERMINED',
    structurePhase: 'UNDETERMINED',
    opportunityDirection: null,
  });

  const result = DecisionGate.analyze({
    current: next,
    previousGateState: previous,
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.INVALIDATED
  );
  assert.strictEqual(
    result.reasonCode,
    'HTF_DIRECTION_CHANGED'
  );
});

test('existing Opportunity invalidates when HTF alignment is lost', () => {
  const previous = enterWatch(20);
  const next = current({
    index: 21,
    htfAlignment: 'UNDETERMINED',
    structurePhase: 'BULLISH_MSS',
  });

  const result = DecisionGate.analyze({
    current: next,
    previousGateState: previous,
  });

  assert.strictEqual(
    result.state,
    DecisionGate.STATES.INVALIDATED
  );
  assert.strictEqual(result.reasonCode, 'HTF_ALIGNMENT_LOST');
});

test('same inputs are deterministic', () => {
  const input = {
    current: watchCurrent(20),
    previousGateState: null,
  };

  assert.deepStrictEqual(
    DecisionGate.analyze(input),
    DecisionGate.analyze(input)
  );
});

test('analysis never mutates current or previousGateState', () => {
  const currentInput = watchCurrent(21);
  const previous = enterWatch(20);
  currentInput.fiveMinuteObservation.latestConfirmed
    .liquiditySweep = bullishSweep(21);
  const before = JSON.stringify({ currentInput, previous });

  DecisionGate.analyze({
    current: currentInput,
    previousGateState: previous,
  });

  assert.strictEqual(
    JSON.stringify({ currentInput, previous }),
    before
  );
});

console.log('\n' + testsPassed + ' tests passed.');
