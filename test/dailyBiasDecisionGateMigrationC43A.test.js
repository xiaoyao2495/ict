'use strict';

const assert = require('assert');
const DecisionGate = require('../indicators/ictDecisionGate');

let testsPassed = 0;
const NOW = Date.UTC(2026, 7, 3, 12);

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
  const fourHourAnalysis = {
    bias: options.oldBias,
  };
  if (options.marketBias !== undefined) {
    fourHourAnalysis.dailyBias = {
      marketBias: options.marketBias,
      transitionDirection:
        options.transitionDirection || null,
    };
  }
  return {
    index: 100,
    availableIndex: 100,
    asOf: NOW,
    fourHourAnalysis,
    structurePhase: {
      state: options.phase || 'UNDETERMINED',
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
      index: 100,
      availableIndex: 100,
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

test('BNB Daily Bias moves Gate from WAITING_HTF to WATCH_ZONE', () => {
  const result = analyze({
    oldBias: 'NEUTRAL',
    marketBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
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
  assert.strictEqual(result.sourceState.h4Bias, 'BEARISH');
  assert.strictEqual(
    result.activeOpportunity.liquidityType,
    'EQUAL_HIGH'
  );
});

test('ETH Daily Bias restores HTF context without forcing a zone', () => {
  const result = analyze({
    oldBias: 'NEUTRAL',
    marketBias: 'BULLISH',
    phase: 'BULLISH_CONTINUATION',
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
  assert.strictEqual(result.activeOpportunity, null);
});

test('CL Daily Bias restores Bearish waiting context', () => {
  const result = analyze({
    oldBias: 'NEUTRAL',
    marketBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
    alignment: 'ALIGNED',
    opportunity: {
      status: 'WAITING',
      direction: 'BEARISH',
      liquidityType: null,
      price: null,
    },
  });

  assert.strictEqual(result.state, 'WAITING_OPPORTUNITY');
  assert.strictEqual(result.direction, 'BEARISH');
  assert.strictEqual(result.activeOpportunity, null);
});

test('SNDK transition remains waiting without legacy Bearish zone', () => {
  const result = analyze({
    oldBias: 'BEARISH',
    marketBias: 'NEUTRAL',
    transitionDirection: 'BULLISH',
    phase: 'BULLISH_PULLBACK',
    alignment: 'UNDETERMINED',
    opportunity: {
      status: 'WAITING',
      direction: null,
      liquidityType: null,
      price: null,
    },
  });

  assert.strictEqual(result.state, 'WAITING_HTF');
  assert.strictEqual(result.direction, null);
  assert.strictEqual(result.activeOpportunity, null);
  assert.strictEqual(result.sourceState.h4Bias, 'NEUTRAL');
});

test('legacy reports without dailyBias retain old Gate behavior', () => {
  const result = analyze({
    oldBias: 'BEARISH',
    phase: 'BEARISH_CONTINUATION',
    alignment: 'ALIGNED',
    opportunity: {
      status: 'WATCH_ZONE',
      direction: 'BEARISH',
      liquidityType: 'PDH',
      price: 100.3,
    },
  });

  assert.strictEqual(result.state, 'WATCH_ZONE');
  assert.strictEqual(result.direction, 'BEARISH');
  assert.strictEqual(result.sourceState.h4Bias, 'BEARISH');
});

test('existing HTF_TRANSITION rule remains unchanged', () => {
  const result = analyze({
    oldBias: 'BULLISH',
    marketBias: 'BULLISH',
    phase: 'BULLISH_MSS',
    alignment: 'ALIGNED',
    opportunity: {
      status: 'WAITING',
      direction: 'BULLISH',
      liquidityType: null,
      price: null,
    },
  });

  assert.strictEqual(result.state, 'HTF_TRANSITION');
  assert.strictEqual(result.reasonCode, 'HTF_STRUCTURE_TRANSITION');
});

test('Gate Bias migration does not mutate current input', () => {
  const input = current({
    oldBias: 'NEUTRAL',
    marketBias: 'BULLISH',
    phase: 'BULLISH_CONTINUATION',
    alignment: 'ALIGNED',
  });
  const before = JSON.stringify(input);

  DecisionGate.analyze({
    current: input,
    previousGateState: null,
  });

  assert.strictEqual(JSON.stringify(input), before);
});

console.log('\n' + testsPassed + ' tests passed.');
