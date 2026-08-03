'use strict';

const assert = require('assert');
const DecisionGate = require('../indicators/ictDecisionGate');

let testsPassed = 0;
const NOW = Date.UTC(2026, 7, 3, 16);

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

function current(options) {
  options = options || {};
  const dailyBias = {
    marketBias: options.marketBias,
    transitionDirection:
      options.transitionDirection || null,
    structureState: options.dailyStructureState ||
      options.phase,
  };
  return {
    index: 120,
    availableIndex: 120,
    asOf: NOW,
    fourHourAnalysis: {
      bias: options.oldBias || 'NEUTRAL',
      dailyBias,
    },
    structurePhase: {
      state: options.phase || 'UNDETERMINED',
      context: options.context || null,
    },
    htfAlignment: {
      status: options.alignment || 'UNDETERMINED',
    },
    opportunity: options.opportunity || {
      status: 'WAITING',
      direction: null,
      liquidityType: null,
      price: null,
    },
    alignment: { status: 'WAITING' },
    fiveMinuteObservation: {
      index: 120,
      availableIndex: 120,
      time: NOW,
      currentConfirmed: {
        liquiditySweeps: [],
        mss: null,
        confirmation: null,
      },
      latestConfirmed: {
        liquiditySweep: null,
        mss: null,
        confirmation: null,
      },
    },
  };
}

function analyze(options) {
  return DecisionGate.analyze({
    current: current(options),
    previousGateState: null,
  });
}

test('Bullish POST_MSS Daily Bias is expressed as HTF_TRANSITION', () => {
  const result = analyze({
    oldBias: 'BEARISH',
    marketBias: 'NEUTRAL',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    context: 'POST_MSS',
  });

  assert.strictEqual(result.state, 'HTF_TRANSITION');
  assert.strictEqual(result.reasonCode, 'HTF_STRUCTURE_TRANSITION');
  assert.strictEqual(result.direction, null);
  assert.strictEqual(result.activeOpportunity, null);
  assert.deepStrictEqual(result.progress, {
    sweepCompleted: false,
    mssCompleted: false,
    displacementCompleted: false,
    strictConfirmationCompleted: false,
  });
});

test('Bearish POST_MSS Daily Bias is expressed as HTF_TRANSITION', () => {
  const result = analyze({
    oldBias: 'BULLISH',
    marketBias: 'NEUTRAL',
    transitionDirection: 'BEARISH',
    phase: 'BEARISH_PULLBACK',
    context: 'POST_MSS',
  });

  assert.strictEqual(result.state, 'HTF_TRANSITION');
  assert.strictEqual(result.direction, null);
  assert.strictEqual(result.activeOpportunity, null);
});

test('Daily Bias embedded POST_MSS context is supported', () => {
  const result = analyze({
    marketBias: 'NEUTRAL',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    dailyStructureState: {
      state: 'BULLISH_PULLBACK',
      context: 'POST_MSS',
    },
  });

  assert.strictEqual(result.state, 'HTF_TRANSITION');
});

test('Neutral CONTINUATION context remains WAITING_HTF', () => {
  const result = analyze({
    marketBias: 'NEUTRAL',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    context: 'CONTINUATION',
  });

  assert.strictEqual(result.state, 'WAITING_HTF');
  assert.strictEqual(result.reasonCode, 'WAITING_FOR_HTF_BIAS');
});

test('Neutral without transitionDirection remains WAITING_HTF', () => {
  const result = analyze({
    marketBias: 'NEUTRAL',
    phase: 'UNDETERMINED',
    context: 'POST_MSS',
  });

  assert.strictEqual(result.state, 'WAITING_HTF');
});

test('confirmed Bullish trend behavior remains unchanged', () => {
  const result = analyze({
    oldBias: 'BULLISH',
    marketBias: 'BULLISH',
    phase: 'BULLISH_CONFIRMED',
    context: 'POST_MSS',
    alignment: 'ALIGNED',
    opportunity: {
      status: 'WAITING',
      direction: 'BULLISH',
      liquidityType: null,
      price: null,
    },
  });

  assert.strictEqual(result.state, 'WAITING_OPPORTUNITY');
  assert.strictEqual(result.direction, 'BULLISH');
});

test('confirmed Bearish WATCH_ZONE behavior remains unchanged', () => {
  const result = analyze({
    oldBias: 'BEARISH',
    marketBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
    context: 'CONTINUATION',
    alignment: 'ALIGNED',
    opportunity: {
      status: 'WATCH_ZONE',
      direction: 'BEARISH',
      liquidityType: 'EQUAL_HIGH',
      price: 100.2,
    },
  });

  assert.strictEqual(result.state, 'WATCH_ZONE');
  assert.strictEqual(result.direction, 'BEARISH');
  assert.strictEqual(
    result.activeOpportunity.liquidityType,
    'EQUAL_HIGH'
  );
});

test('Daily Bias Transition never creates active Gate states', () => {
  const result = analyze({
    oldBias: 'BEARISH',
    marketBias: 'NEUTRAL',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    context: 'POST_MSS',
    alignment: 'ALIGNED',
    opportunity: {
      status: 'WATCH_ZONE',
      direction: 'BEARISH',
      liquidityType: 'EQUAL_HIGH',
      price: 100.2,
    },
  });

  assert.ok(![
    'WATCH_ZONE',
    'CONFIRMING',
    'READY_OBSERVATION',
  ].includes(result.state));
  assert.strictEqual(result.state, 'HTF_TRANSITION');
  assert.strictEqual(result.activeOpportunity, null);
});

test('Transition migration does not mutate current input', () => {
  const input = current({
    marketBias: 'NEUTRAL',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    context: 'POST_MSS',
  });
  const before = JSON.stringify(input);

  DecisionGate.analyze({
    current: input,
    previousGateState: null,
  });

  assert.strictEqual(JSON.stringify(input), before);
});

console.log('\n' + testsPassed + ' tests passed.');
