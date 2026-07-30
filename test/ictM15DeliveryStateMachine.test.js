'use strict';

const assert = require('assert');
const StateMachine = require(
  '../indicators/ictM15DeliveryStateMachine'
);

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

function bearishChain() {
  return [{
    h4Bias: 'BEARISH',
    retracement: true,
    index: 0,
    time: 100,
  }, {
    h4Bias: 'BEARISH',
    retracement: true,
    index: 1,
    time: 200,
  }, {
    h4Bias: 'BEARISH',
    retracement: true,
    liquidityTaken: true,
    index: 2,
    time: 300,
  }, {
    h4Bias: 'BEARISH',
    structureShift: true,
    index: 3,
    time: 400,
  }, {
    h4Bias: 'BEARISH',
    deliveryConfirmed: true,
    index: 4,
    time: 500,
  }];
}

test('complete bearish Delivery chain advances every stage', () => {
  const states = StateMachine.run(bearishChain());

  assert.deepStrictEqual(
    states.map((state) => state.stage),
    [
      'RETRACEMENT',
      'WAITING_LIQUIDITY',
      'LIQUIDITY_TAKEN',
      'STRUCTURE_SHIFT',
      'DELIVERY_CONFIRMED',
    ]
  );
});

test('bullish Delivery chain is symmetric', () => {
  const events = bearishChain().map((event) => ({
    ...event,
    h4Bias: 'BULLISH',
  }));

  assert.strictEqual(
    StateMachine.run(events).at(-1).stage,
    'DELIVERY_CONFIRMED'
  );
});

test('Sweep alone remains LIQUIDITY_TAKEN', () => {
  const states = StateMachine.run(
    bearishChain().slice(0, 3)
  );

  assert.strictEqual(
    states.at(-1).stage,
    'LIQUIDITY_TAKEN'
  );
  assert.notStrictEqual(
    states.at(-1).stage,
    'DELIVERY_CONFIRMED'
  );
});

test('waiting liquidity side follows the 4H direction', () => {
  const bearish = StateMachine.run([
    bearishChain()[0],
    bearishChain()[1],
  ]);
  const bullish = StateMachine.run([
    {
      ...bearishChain()[0],
      h4Bias: 'BULLISH',
    },
    {
      ...bearishChain()[1],
      h4Bias: 'BULLISH',
    },
  ]);
  const taken = StateMachine.run(
    bearishChain().slice(0, 3)
  );

  assert.strictEqual(
    bearish.at(-1).waitingLiquiditySide,
    'BUY_SIDE'
  );
  assert.strictEqual(
    bullish.at(-1).waitingLiquiditySide,
    'SELL_SIDE'
  );
  assert.strictEqual(
    taken.at(-1).waitingLiquiditySide,
    null
  );
});

test('MSS without Displacement remains STRUCTURE_SHIFT', () => {
  const states = StateMachine.run(
    bearishChain().slice(0, 4)
  );

  assert.strictEqual(
    states.at(-1).stage,
    'STRUCTURE_SHIFT'
  );
  assert.notStrictEqual(
    states.at(-1).stage,
    'DELIVERY_CONFIRMED'
  );
});

test('post-MSS retracement extreme break invalidates Delivery', () => {
  const beforeInvalidation = StateMachine.run(
    bearishChain().slice(0, 4)
  ).at(-1);
  const invalidated = StateMachine.transition(
    beforeInvalidation,
    {
      h4Bias: 'BEARISH',
      invalidated: true,
      index: 4,
      time: 500,
    }
  );

  assert.strictEqual(
    StateMachine.deliveryInvalidated({
      h4Bias: 'BEARISH',
      retracementExtreme: 110,
      structureShiftIndex: 3,
      index: 4,
      high: 110.01,
      low: 100,
    }),
    true
  );
  assert.strictEqual(
    StateMachine.deliveryInvalidated({
      h4Bias: 'BULLISH',
      retracementExtreme: 90,
      structureShiftIndex: 3,
      index: 4,
      high: 100,
      low: 89.99,
    }),
    true
  );
  assert.strictEqual(
    StateMachine.deliveryInvalidated({
      h4Bias: 'BEARISH',
      retracementExtreme: 110,
      structureShiftIndex: 3,
      index: 4,
      high: 110,
      low: 100,
    }),
    false
  );
  assert.strictEqual(invalidated.stage, 'INVALIDATED');
  assert.strictEqual(
    invalidated.waitingLiquiditySide,
    null
  );
});

test('state history is prefix invariant', () => {
  const events = bearishChain();
  const prefixLength = 4;
  const prefix = StateMachine.run(
    events.slice(0, prefixLength)
  );
  const full = StateMachine.run(events);

  assert.deepStrictEqual(
    full.slice(0, prefixLength),
    prefix
  );
});

console.log('\n' + testsPassed + ' tests passed.');
