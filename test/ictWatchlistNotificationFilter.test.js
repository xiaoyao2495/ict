'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Filter = require(
  '../notifications/ictWatchlistNotificationFilter'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function mss(index, direction) {
  return {
    direction: direction || 'BULLISH',
    availableIndex: index,
    time: 1000 + index,
  };
}

function sweep(index, side) {
  return {
    id: 'SWEEP-' + index,
    type: side === 'BUY_SIDE'
      ? 'LTF_SWING_HIGH'
      : 'LTF_SWING_LOW',
    side: side || 'SELL_SIDE',
    availableIndex: index,
    time: 2000 + index,
  };
}

function result(symbol, options) {
  options = options || {};
  return {
    symbol,
    status: 'SUCCESS',
    formatted: 'formatted ' + symbol,
    report: {
      symbol,
      current: {
        fourHourAnalysis: {
          bias: options.bias || 'BULLISH',
        },
        oneHourAnalysis: {
          relationToH4:
            options.relation || 'ALIGNED',
          deliveryDirection:
            options.delivery || 'BULLISH',
        },
        fiveMinuteObservation: {
          latestConfirmed: {
            mss: options.mss === undefined
              ? null
              : options.mss,
            liquiditySweep:
              options.sweep === undefined
                ? null
                : options.sweep,
          },
        },
      },
    },
  };
}

function committed(decision) {
  return decision.nextState;
}

test('first symbol state sends once', () => {
  const decision = Filter.evaluate(
    [result('BTCUSDT')],
    null
  );

  assert.strictEqual(decision.shouldNotify, true);
  assert.strictEqual(decision.changes.length, 1);
  assert.deepStrictEqual(
    decision.changes[0].reasons,
    ['INITIAL_STATE']
  );
  assert.strictEqual(
    decision.nextState.symbols.BTCUSDT.symbol,
    'BTCUSDT'
  );
});

test('identical state and ordinary candle changes are filtered', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT')],
    null
  );
  const duplicate = Filter.evaluate(
    [result('BTCUSDT')],
    committed(initial)
  );

  assert.strictEqual(duplicate.shouldNotify, false);
  assert.deepStrictEqual(duplicate.changes, []);
});

test('raw symbol Analyst Reports are accepted directly', () => {
  const row = result('BTCUSDT');
  const decision = Filter.evaluate([row.report], null);

  assert.strictEqual(decision.shouldNotify, true);
  assert.strictEqual(
    decision.changes[0].symbol,
    'BTCUSDT'
  );
});

test('4H Bias change sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT')],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', { bias: 'BEARISH' })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['H4_BIAS_CHANGED']
  );
});

test('new 5m MSS identity sends even with same direction', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(10) })],
    null
  );
  const duplicate = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(10) })],
    committed(initial)
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(20) })],
    committed(initial)
  );

  assert.strictEqual(duplicate.shouldNotify, false);
  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['NEW_5M_MSS']
  );
});

test('symbols maintain independent state', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT'),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT', {
      delivery: 'BEARISH',
      relation: 'RETRACEMENT',
      sweep: sweep(30, 'SELL_SIDE'),
    }),
    {
      symbol: 'SKHYUSDT',
      status: 'FAILED',
    },
  ], committed(initial));

  assert.strictEqual(changed.changes.length, 1);
  assert.strictEqual(
    changed.changes[0].symbol,
    'ETHUSDT'
  );
  assert.deepStrictEqual(
    changed.changes[0].reasons,
    [
      'H1_DELIVERY_CHANGED',
      'H1_RELATION_CHANGED',
      'NEW_5M_SWEEP',
    ]
  );
  assert.deepStrictEqual(
    changed.nextState.symbols.BTCUSDT,
    initial.nextState.symbols.BTCUSDT
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      changed.nextState.symbols,
      'SKHYUSDT'
    ),
    false
  );
});

test('webhook success is required before state update', async () => {
  const store = Filter.createMemoryStore();
  const rows = [result('BTCUSDT')];

  await assert.rejects(
    () => Filter.processNotifications({
      results: rows,
      store,
      async send() {
        throw new Error('webhook failed');
      },
    }),
    /webhook failed/
  );
  assert.strictEqual(await store.load(), null);

  await assert.rejects(
    () => Filter.processNotifications({
      results: rows,
      store,
      async send() {
        return { data: { errcode: 310000 } };
      },
    }),
    /did not accept/
  );
  assert.strictEqual(await store.load(), null);

  const processed = await Filter.processNotifications({
    results: rows,
    store,
    async send(changes) {
      assert.strictEqual(changes.length, 1);
      return { data: { errcode: 0 } };
    },
  });
  assert.strictEqual(processed.sent, true);
  assert.ok((await store.load()).symbols.BTCUSDT);
});

test('file store persists independent symbol states', async () => {
  const filePath = path.join(
    os.tmpdir(),
    'ict-watchlist-notification-' +
      process.pid + '-' + Date.now() + '.json'
  );
  const state = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT'),
  ], null).nextState;

  try {
    const writer = Filter.createFileStore(filePath);
    assert.strictEqual(await writer.load(), null);
    await writer.save(state);

    const reader = Filter.createFileStore(filePath);
    assert.deepStrictEqual(await reader.load(), state);
  } finally {
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
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
