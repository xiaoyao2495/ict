'use strict';

const assert = require('assert');
const Confirmation = require(
  '../indicators/ict5mConfirmationEngine'
);

const FIVE_MINUTES = 5 * 60 * 1000;
const START = Date.UTC(2026, 0, 1);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function sweep(index, side) {
  return {
    id: 'SWEEP-' + index,
    type: side === 'SELL_SIDE'
      ? 'LTF_SWING_LOW'
      : 'LTF_SWING_HIGH',
    side,
    index,
    availableIndex: index,
    sweptIndex: index,
    time: START + (index + 1) * FIVE_MINUTES - 1,
  };
}

function mss(index, direction, sourceSweep) {
  return {
    direction,
    index,
    availableIndex: index,
    time: START + (index + 1) * FIVE_MINUTES - 1,
    level: {
      label: direction === 'BULLISH' ? 'LH' : 'HL',
      price: 100,
    },
    sweep: {
      side: sourceSweep.side,
      level: sourceSweep,
      index: sourceSweep.index,
      time: sourceSweep.time,
    },
  };
}

function displacement(index, direction) {
  return {
    direction,
    strength: 2,
    index,
    availableIndex: index,
    time: START + (index + 1) * FIVE_MINUTES - 1,
  };
}

function chain(options) {
  options = options || {};
  const direction = options.direction || 'BULLISH';
  const sourceSweep = sweep(
    options.sweepIndex === undefined
      ? 2
      : options.sweepIndex,
    options.sweepSide || (
      direction === 'BULLISH'
        ? 'SELL_SIDE'
        : 'BUY_SIDE'
    )
  );
  const structureShift = mss(
    options.mssIndex === undefined
      ? 5
      : options.mssIndex,
    direction,
    sourceSweep
  );
  return {
    sweep: sourceSweep,
    mss: structureShift,
    displacement: displacement(
      options.displacementIndex === undefined
        ? 7
        : options.displacementIndex,
      options.displacementDirection || direction
    ),
  };
}

function klines(length) {
  return Array.from({ length }, (_, index) => ({
    openTime: START + index * FIVE_MINUTES,
    closeTime:
      START + (index + 1) * FIVE_MINUTES - 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
}

test(
  'Sell Side Sweep -> Bullish MSS -> Bullish Displacement confirms bullish',
  () => {
    assert.deepStrictEqual(
      Confirmation.validateEventChain(chain()),
      {
        confirmed: true,
        direction: 'BULLISH',
        reason: 'CONFIRMED_BULLISH',
      }
    );
  }
);

test(
  'Buy Side Sweep -> Bearish MSS -> Bearish Displacement confirms bearish',
  () => {
    assert.deepStrictEqual(
      Confirmation.validateEventChain(
        chain({ direction: 'BEARISH' })
      ),
      {
        confirmed: true,
        direction: 'BEARISH',
        reason: 'CONFIRMED_BEARISH',
      }
    );
  }
);

test('Buy Side Sweep cannot confirm Bullish MSS', () => {
  const result = Confirmation.validateEventChain(
    chain({
      direction: 'BULLISH',
      sweepSide: 'BUY_SIDE',
    })
  );
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(
    result.reason,
    'SWEEP_DIRECTION_MISMATCH'
  );
});

test('Sweep more than 12 bars before MSS is rejected', () => {
  const result = Confirmation.validateEventChain(
    chain({
      sweepIndex: 2,
      mssIndex: 15,
      displacementIndex: 16,
    })
  );
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(
    result.reason,
    'SWEEP_TO_MSS_TOO_FAR'
  );
});

test('Displacement more than 6 bars after MSS is rejected', () => {
  const result = Confirmation.validateEventChain(
    chain({ mssIndex: 5, displacementIndex: 12 })
  );
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(
    result.reason,
    'MSS_TO_DISPLACEMENT_TOO_FAR'
  );
});

test('Displacement before MSS is rejected', () => {
  const result = Confirmation.validateEventChain(
    chain({ mssIndex: 5, displacementIndex: 4 })
  );
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(result.reason, 'INVALID_EVENT_ORDER');
});

test('confirmation publication is causal and prefix invariant', () => {
  const completeKlines = klines(20);
  const sourceSweep = sweep(2, 'SELL_SIDE');
  const structureShift = mss(
    5,
    'BULLISH',
    sourceSweep
  );
  const allEvents = {
    mss: [structureShift],
    displacements: [
      displacement(5, 'BULLISH'),
      displacement(7, 'BULLISH'),
    ],
  };
  const prefixLength = 7;
  const prefix = Confirmation.analyze({
    events: {
      mss: allEvents.mss.filter(
        (event) => event.index < prefixLength
      ),
      displacements: allEvents.displacements.filter(
        (event) => event.index < prefixLength
      ),
    },
    ltf5mKlines:
      completeKlines.slice(0, prefixLength),
  });
  const full = Confirmation.analyze({
    events: allEvents,
    ltf5mKlines: completeKlines,
  });

  assert.deepStrictEqual(
    full.states.slice(0, prefixLength),
    prefix.states
  );
  assert.strictEqual(prefix.confirmations.length, 0);
  assert.strictEqual(full.confirmations.length, 1);
  assert.strictEqual(full.confirmations[0].index, 7);
});

(async () => {
  for (const item of tests) {
    try {
      await item.callback();
      testsPassed += 1;
      console.log('PASS:', item.name);
    } catch (error) {
      console.error('FAIL:', item.name);
      throw error;
    }
  }
  console.log('\n' + testsPassed + ' tests passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
