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

function mss(index, direction, structurePrice) {
  direction = direction || 'BULLISH';
  return {
    id: 'MSS-' + index,
    direction,
    index,
    availableIndex: index,
    time: 1000 + index,
    brokenStructureLevel: {
      id: 'PIVOT-' + index,
      label: direction === 'BULLISH' ? 'LH' : 'HL',
      type: direction === 'BULLISH' ? 'HIGH' : 'LOW',
      index: index - 2,
      availableIndex: index,
      time: 900 + index,
      price: structurePrice === undefined
        ? 100
        : structurePrice,
    },
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
    decision.changedSymbols,
    ['BTCUSDT']
  );
  assert.deepStrictEqual(
    decision.notificationSymbols,
    ['BTCUSDT']
  );
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
  assert.deepStrictEqual(duplicate.changedSymbols, []);
  assert.deepStrictEqual(
    duplicate.notificationSymbols,
    []
  );
});

test('notification state excludes every window locator and Sweep', () => {
  const state = Filter.extractSymbolState(
    result('BTCUSDT', {
      mss: mss(10),
      sweep: sweep(10, 'SELL_SIDE'),
    })
  );

  assert.deepStrictEqual(state, {
    symbol: 'BTCUSDT',
    h4Bias: 'BULLISH',
    latestMss: {
      direction: 'BULLISH',
      brokenStructureLevel: {
        type: 'HIGH',
        price: 100,
      },
    },
  });
  assert.strictEqual(
    JSON.stringify(state).includes('index'),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      state,
      'latestSweep'
    ),
    false
  );
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

test('window locator changes keep the same stable MSS state', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(10) })],
    null
  );
  const sameEventLaterPublication = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(99) })],
    committed(initial)
  );

  assert.strictEqual(
    sameEventLaterPublication.shouldNotify,
    false
  );
  assert.deepStrictEqual(
    sameEventLaterPublication.changes,
    []
  );
});

test('legacy 15m fields do not notify', () => {
  const first = result('BTCUSDT');
  first.report.current.fifteenMinuteAnalysis = {
    deliveryDirection: 'BULLISH',
    relationToH4: 'ALIGNED',
    index: 10,
    time: 1000,
  };
  const initial = Filter.evaluate([first], null);

  const next = result('BTCUSDT');
  next.report.current.fifteenMinuteAnalysis = {
    deliveryDirection: 'BEARISH',
    relationToH4: 'RETRACEMENT',
    index: 20,
    time: 2000,
  };
  const unchanged = Filter.evaluate(
    [next],
    committed(initial)
  );

  assert.strictEqual(unchanged.shouldNotify, false);
  assert.deepStrictEqual(unchanged.changes, []);
});

test('new stable 5m MSS event sends even with same direction', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(10) })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(20, null, 120) })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['NEW_5M_MSS']
  );
});

test('MSS direction change sends without time identity', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      mss: {
        direction: 'BULLISH',
        availableIndex: 10,
        time: 1000,
      },
    })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      mss: {
        direction: 'BEARISH',
        availableIndex: 20,
        time: 2000,
      },
    })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['NEW_5M_MSS']
  );
});

test('Sweep identity count index and time changes never send', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      sweep: sweep(10, 'SELL_SIDE'),
    })],
    null
  );
  const changedSweepOnly = Filter.evaluate(
    [result('BTCUSDT', {
      sweep: sweep(20, 'BUY_SIDE'),
    })],
    committed(initial)
  );

  assert.strictEqual(changedSweepOnly.shouldNotify, false);
  assert.deepStrictEqual(changedSweepOnly.changes, []);
});

test('old persisted locator fields are normalized before comparison', () => {
  const previous = {
    version: 1,
    symbols: {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        h4Bias: 'BULLISH',
        h1Relation: 'ALIGNED',
        h1DeliveryDirection: 'BULLISH',
        m15Relation: 'ALIGNED',
        m15DeliveryDirection: 'BULLISH',
        latestMss: mss(10),
        latestSweep: sweep(10, 'SELL_SIDE'),
      },
    },
  };
  const decision = Filter.evaluate([
    result('BTCUSDT', {
      mss: mss(99),
      sweep: sweep(99, 'BUY_SIDE'),
    }),
  ], previous);

  assert.strictEqual(decision.shouldNotify, false);
  assert.deepStrictEqual(decision.changes, []);
  assert.deepStrictEqual(
    decision.previousState.symbols.BTCUSDT,
    Filter.extractSymbolState(
      result('BTCUSDT', { mss: mss(10) })
    )
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      decision.previousState.symbols.BTCUSDT,
      'h1Relation'
    ),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      decision.previousState.symbols.BTCUSDT,
      'm15Relation'
    ),
    false
  );
});

test('15m relation change is ignored', () => {
  const first = result('BTCUSDT');
  first.report.current.fifteenMinuteAnalysis = {
    relationToH4: 'ALIGNED',
    deliveryDirection: 'BULLISH',
  };
  const initial = Filter.evaluate(
    [first],
    null
  );
  const next = result('BTCUSDT');
  next.report.current.fifteenMinuteAnalysis = {
    relationToH4: 'RETRACEMENT',
    deliveryDirection: 'NEUTRAL',
  };
  const changed = Filter.evaluate(
    [next],
    committed(initial)
  );

  assert.strictEqual(changed.shouldNotify, false);
  assert.deepStrictEqual(changed.changes, []);
});

test('symbols maintain independent state', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT'),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT', {
      bias: 'BEARISH',
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
    ['H4_BIAS_CHANGED']
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

test('notification debug is silent when disabled', async () => {
  const logs = [];
  const processed = await Filter.processNotifications({
    results: [result('BTCUSDT')],
    store: Filter.createMemoryStore(),
    debugNotification: false,
    logger: {
      log(value) {
        logs.push(value);
      },
    },
    async send() {
      return { data: { errcode: 0 } };
    },
  });

  assert.strictEqual(processed.sent, true);
  assert.deepStrictEqual(logs, []);
});

test('DEBUG_NOTIFICATION environment switch is supported', () => {
  const original = process.env.DEBUG_NOTIFICATION;

  try {
    process.env.DEBUG_NOTIFICATION = 'true';
    assert.strictEqual(
      Filter.debugNotificationEnabled(),
      true
    );
    process.env.DEBUG_NOTIFICATION = 'false';
    assert.strictEqual(
      Filter.debugNotificationEnabled(),
      false
    );
  } finally {
    if (original === undefined) {
      delete process.env.DEBUG_NOTIFICATION;
    } else {
      process.env.DEBUG_NOTIFICATION = original;
    }
  }
});

test('notification debug prints compared states and decision', async () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      mss: mss(10),
      sweep: sweep(10, 'SELL_SIDE'),
    })],
    null
  ).nextState;
  const logs = [];
  const processed = await Filter.processNotifications({
    results: [result('BTCUSDT', {
      mss: mss(99),
      sweep: sweep(20, 'BUY_SIDE'),
    })],
    store: Filter.createMemoryStore(initial),
    debugNotification: true,
    logger: {
      log(value) {
        logs.push(value);
      },
    },
  });
  const output = logs.join('\n');

  assert.strictEqual(processed.shouldNotify, false);
  assert.ok(output.includes('State File:'));
  assert.ok(output.includes('<memory/custom store>'));
  assert.ok(output.includes('Load Success:\ntrue'));
  assert.ok(output.includes(
    'Previous State Exists:\ntrue'
  ));
  assert.ok(output.includes(
    '========== Previous Watchlist State =========='
  ));
  assert.ok(output.includes(
    '========== Current Watchlist State =========='
  ));
  assert.ok(output.includes('Symbol:\nBTCUSDT'));
  assert.ok(output.includes(
    'Changed Fields:\nNONE'
  ));
  assert.strictEqual(
    output.includes('Dynamic field detected:'),
    false
  );
  assert.ok(output.includes(
    'shouldNotify:\nfalse'
  ));
  assert.ok(output.includes(
    'Reason:\nNo state changed'
  ));
  assert.strictEqual(
    output.includes('Notification Symbols:'),
    false
  );
});

test('notification debug prints changed and sent symbols', async () => {
  const logs = [];
  const processed = await Filter.processNotifications({
    results: [result('SPCXUSDT')],
    store: Filter.createMemoryStore(),
    debugNotification: true,
    logger: {
      log(value) {
        logs.push(value);
      },
    },
    async send() {
      return { data: { errcode: 0 } };
    },
  });
  const output = logs.join('\n');

  assert.strictEqual(processed.sent, true);
  assert.ok(output.includes(
    'shouldNotify:\ntrue'
  ));
  assert.ok(output.includes(
    'Reason:\nSPCXUSDT changed'
  ));
  assert.ok(output.includes(
    'Changed Symbols:\n[\n  "SPCXUSDT"\n]'
  ));
  assert.ok(output.includes(
    'Notification Symbols:\n[\n  "SPCXUSDT"\n]'
  ));
});

test('notification debug records state load failure', async () => {
  const logs = [];

  await assert.rejects(
    () => Filter.processNotifications({
      results: [result('BTCUSDT')],
      store: {
        filePath: '/tmp/broken-state.json',
        async load() {
          throw new Error('state read failed');
        },
      },
      debugNotification: true,
      logger: {
        log(value) {
          logs.push(value);
        },
      },
    }),
    /state read failed/
  );

  const output = logs.join('\n');
  assert.ok(output.includes(
    'State File:\n/tmp/broken-state.json'
  ));
  assert.ok(output.includes('Load Success:\nfalse'));
  assert.ok(output.includes(
    'Previous State Exists:\nfalse'
  ));
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
