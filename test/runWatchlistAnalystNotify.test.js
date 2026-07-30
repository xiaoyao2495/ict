'use strict';

const assert = require('assert');
const Filter = require(
  '../notifications/ictWatchlistNotificationFilter'
);
const NotifyRunner = require(
  '../scripts/runWatchlistAnalystNotify'
);

const CURRENT_TIME = Date.UTC(2026, 6, 28, 0);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function symbolResult(symbol, options) {
  options = options || {};
  return {
    symbol,
    status: 'SUCCESS',
    formatted: [
      '【ICT市场分析】',
      '',
      '时间：2026-07-28 08:00:00',
      '',
      '1. 4H HTF Bias',
      '- Bias：' + (options.bias || 'BULLISH'),
      '2. 15分钟状态',
      '3. 【5分钟确认】',
      '4. 当前人工判断',
    ].join('\n'),
    report: {
      symbol,
      current: {
        asOf: CURRENT_TIME,
        fourHourAnalysis: {
          bias: options.bias || 'BULLISH',
        },
        fifteenMinuteAnalysis: {
          timeframe: '15m',
          relationToH4:
            options.relation || 'ALIGNED',
          deliveryDirection:
            options.delivery || 'BULLISH',
        },
        fiveMinuteObservation: {
          latestConfirmed: {
            mss: options.mss || null,
            liquiditySweep: options.sweep || null,
          },
        },
      },
    },
  };
}

function watchlistAnalysis(results) {
  return {
    currentTime: CURRENT_TIME,
    symbols: results.map((result) => result.symbol),
    availability: {
      validSymbols: results.map(
        (result) => result.symbol
      ),
      invalidSymbols: ['NOTEXISTUSDT'],
      checkFailed: false,
      error: null,
    },
    results,
    message: 'full unfiltered watchlist report',
  };
}

function mutableRunner(initialResults) {
  let results = initialResults;
  return {
    setResults(nextResults) {
      results = nextResults;
    },
    async run(options) {
      assert.strictEqual(typeof options.output, 'function');
      return watchlistAnalysis(results);
    },
  };
}

test('first Watchlist state sends one combined DingTalk message', async () => {
  const runner = mutableRunner([
    symbolResult('BTCUSDT'),
    symbolResult('ETHUSDT'),
  ]);
  const store = Filter.createMemoryStore();
  const webhookCalls = [];
  const result = await NotifyRunner.run({
    watchlistRunner: runner,
    stateStore: store,
    webhookUrl: 'https://example.test/watchlist',
    httpClient: {
      async post(url, payload) {
        webhookCalls.push({ url, payload });
        return { data: { errcode: 0, errmsg: 'ok' } };
      },
    },
  });

  assert.strictEqual(result.sent, true);
  assert.strictEqual(webhookCalls.length, 1);
  assert.strictEqual(
    webhookCalls[0].url,
    'https://example.test/watchlist'
  );
  assert.deepStrictEqual(
    webhookCalls[0].payload,
    result.payload
  );
  assert.ok(result.message.startsWith(
    '检测---ICT Watchlist 状态变化'
  ));
  assert.ok(result.message.includes(
    '===== BTCUSDT ====='
  ));
  assert.ok(result.message.includes(
    '===== ETHUSDT ====='
  ));
  assert.strictEqual(
    result.message.includes('NOTEXISTUSDT'),
    false
  );
  assert.deepStrictEqual(
    result.notificationSymbols,
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.deepStrictEqual(
    result.renderedNotificationSymbols,
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.deepStrictEqual(
    result.notification.changes.map(
      (change) => change.reasons
    ),
    [['INITIAL_STATE'], ['INITIAL_STATE']]
  );
  const saved = await store.load();
  assert.ok(saved.symbols.BTCUSDT);
  assert.ok(saved.symbols.ETHUSDT);
});

test('duplicate Watchlist state does not call webhook', async () => {
  const rows = [
    symbolResult('BTCUSDT'),
    symbolResult('ETHUSDT'),
  ];
  const runner = mutableRunner(rows);
  const store = Filter.createMemoryStore();
  let webhookCalls = 0;
  const options = {
    watchlistRunner: runner,
    stateStore: store,
    webhookUrl: 'https://example.test/watchlist',
    httpClient: {
      async post() {
        webhookCalls += 1;
        return { data: { errcode: 0 } };
      },
    },
  };

  const first = await NotifyRunner.run(options);
  const duplicate = await NotifyRunner.run(options);

  assert.strictEqual(first.sent, true);
  assert.strictEqual(duplicate.sent, false);
  assert.strictEqual(duplicate.message, null);
  assert.strictEqual(duplicate.payload, null);
  assert.deepStrictEqual(
    duplicate.notificationSymbols,
    []
  );
  assert.deepStrictEqual(
    duplicate.renderedNotificationSymbols,
    []
  );
  assert.strictEqual(webhookCalls, 1);
});

test('Sweep-only changes do not call Watchlist webhook', async () => {
  const runner = mutableRunner([
    symbolResult('BTCUSDT', {
      sweep: {
        id: 'SWEEP-1',
        type: 'LTF_SWING_LOW',
        side: 'SELL_SIDE',
        availableIndex: 10,
        time: 1000,
      },
    }),
  ]);
  const store = Filter.createMemoryStore();
  let webhookCalls = 0;
  const options = {
    watchlistRunner: runner,
    stateStore: store,
    webhookUrl: 'https://example.test/watchlist',
    httpClient: {
      async post() {
        webhookCalls += 1;
        return { data: { errcode: 0 } };
      },
    },
  };
  await NotifyRunner.run(options);

  runner.setResults([
    symbolResult('BTCUSDT', {
      sweep: {
        id: 'SWEEP-2',
        type: 'EQUAL_LOW',
        side: 'SELL_SIDE',
        availableIndex: 20,
        time: 2000,
      },
    }),
  ]);
  const sweepOnly = await NotifyRunner.run(options);

  assert.strictEqual(sweepOnly.sent, false);
  assert.strictEqual(webhookCalls, 1);
});

test('only the independently changed symbol is sent', async () => {
  const runner = mutableRunner([
    symbolResult('BTCUSDT'),
    symbolResult('ETHUSDT'),
  ]);
  const store = Filter.createMemoryStore();
  const messages = [];
  const options = {
    watchlistRunner: runner,
    stateStore: store,
    webhookUrl: 'https://example.test/watchlist',
    httpClient: {
      async post(url, payload) {
        messages.push(payload.text.content);
        return { data: { errcode: 0 } };
      },
    },
  };
  await NotifyRunner.run(options);

  runner.setResults([
    symbolResult('BTCUSDT'),
    symbolResult('ETHUSDT', {
      bias: 'BEARISH',
      delivery: 'BEARISH',
      relation: 'RETRACEMENT',
    }),
  ]);
  const changed = await NotifyRunner.run(options);

  assert.strictEqual(changed.sent, true);
  assert.strictEqual(messages.length, 2);
  assert.ok(changed.message.includes(
    '===== ETHUSDT ====='
  ));
  assert.strictEqual(
    changed.message.includes('===== BTCUSDT ====='),
    false
  );
  assert.deepStrictEqual(
    changed.notification.changes[0].reasons,
    [
      'H4_BIAS_CHANGED',
      'M15_DELIVERY_CHANGED',
      'M15_RELATION_CHANGED',
    ]
  );
  const saved = await store.load();
  assert.strictEqual(
    saved.symbols.BTCUSDT.h4Bias,
    'BULLISH'
  );
  assert.strictEqual(
    saved.symbols.ETHUSDT.h4Bias,
    'BEARISH'
  );
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
