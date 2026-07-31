'use strict';

const assert = require('assert');
const Filter = require(
  '../notifications/ictWatchlistNotificationFilter'
);
const NotifyRunner = require(
  '../scripts/runWatchlistAnalystNotify'
);
const OpportunityHistory = require(
  '../history/ictOpportunityHistory'
);

const CURRENT_TIME = Date.UTC(2026, 6, 29, 0);
const SYMBOLS = [
  'BTCUSDT',
  'SNDKUSDT',
  'MUUSDT',
  'XAUUSDT',
  'CLUSDT',
  'SPCXUSDT',
];
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function stableMss(location, price) {
  return {
    id: 'MSS-' + location,
    direction: 'BULLISH',
    index: location,
    availableIndex: location,
    time: 1000 + location,
    brokenStructureLevel: {
      id: 'PIVOT-' + location,
      type: 'HIGH',
      index: location - 2,
      availableIndex: location,
      time: 900 + location,
      price: price === undefined ? 100 : price,
    },
  };
}

function symbolResult(symbol, options) {
  options = options || {};
  return {
    symbol,
    status: 'SUCCESS',
    formatted: '完整中文 ICT 分析：' + symbol,
    report: {
      symbol,
      current: {
        fourHourAnalysis: {
          bias: options.bias || 'BULLISH',
          primaryDraw: options.primaryDraw || {
            type: 'PWH',
            price: 66924,
          },
        },
        structurePhase: options.structurePhase || {
          state: 'BULLISH_CONTINUATION',
        },
        htfAlignment: options.htfAlignment || {
          status: 'ALIGNED',
        },
        opportunity: options.opportunity || {
          status: 'WAITING',
          direction: options.bias || 'BULLISH',
          liquidityType: null,
          price: null,
        },
        fiveMinuteConfirmationStatus:
          options.confirmationStatus || 'WAITING',
        alignment: {
          status: options.alignmentStatus || 'WAITING',
          direction: options.alignmentDirection || null,
          reason: options.alignmentReason || '',
        },
        fiveMinuteObservation: {
          currentConfirmed: {
            liquiditySweeps: options.sweeps || [],
            mss: options.currentMss || null,
            displacement: options.displacement || null,
            confirmation:
              options.confirmationStatus &&
              options.confirmationStatus !== 'WAITING'
                ? {
                  status: 'CONFIRMED',
                  direction:
                    options.confirmationDirection ||
                    'BULLISH',
                }
                : null,
          },
          latestConfirmed: {
            mss: options.mss || null,
            liquiditySweep: options.sweep || null,
          },
        },
      },
    },
  };
}

function rows(overrides) {
  overrides = overrides || {};
  return SYMBOLS.map((symbol) => symbolResult(
    symbol,
    overrides[symbol]
  ));
}

function analysis(results, symbols) {
  return {
    currentTime: CURRENT_TIME,
    symbols: (symbols || SYMBOLS).slice(),
    availability: {
      validSymbols: results.map(
        (result) => result.symbol
      ),
      invalidSymbols: [],
      checkFailed: false,
      error: null,
    },
    results,
    message: [
      'FULL WATCHLIST MUST NOT BE USED',
      ...SYMBOLS,
    ].join('\n'),
  };
}

function mutableRunner(initialResults, symbols) {
  let currentResults = initialResults;
  return {
    setResults(nextResults) {
      currentResults = nextResults;
    },
    async run() {
      return analysis(currentResults, symbols);
    },
  };
}

function httpRecorder(messages) {
  return {
    async post(url, payload) {
      messages.push(payload.text.content);
      return { data: { errcode: 0 } };
    },
  };
}

async function primeAndRun(nextRows, symbols) {
  const runner = mutableRunner(rows(), symbols);
  const store = Filter.createMemoryStore();
  const messages = [];
  const options = {
    watchlistRunner: runner,
    stateStore: store,
    opportunityHistoryStore:
      OpportunityHistory.createMemoryStore(),
    webhookUrl: 'https://example.test/watchlist',
    httpClient: httpRecorder(messages),
  };

  await NotifyRunner.run(options);
  runner.setResults(nextRows);
  const result = await NotifyRunner.run(options);
  return { result, messages };
}

test('6个交易对只有1个变化时只渲染1个', async () => {
  const changedRows = rows({
    XAUUSDT: {
      bias: 'BEARISH',
      delivery: 'BEARISH',
      relation: 'RETRACEMENT',
    },
  });
  const { result, messages } =
    await primeAndRun(changedRows);

  assert.strictEqual(result.sent, true);
  assert.deepStrictEqual(
    result.notificationSymbols,
    ['XAUUSDT']
  );
  assert.deepStrictEqual(
    result.renderedNotificationSymbols,
    ['XAUUSDT']
  );
  assert.strictEqual(messages.length, 2);
  assert.ok(result.message.includes(
    '===== XAUUSDT ====='
  ));
  for (const symbol of SYMBOLS.filter(
    (symbol) => symbol !== 'XAUUSDT'
  )) {
    assert.strictEqual(
      result.message.includes('===== ' + symbol + ' ====='),
      false
    );
  }
});

test('6个交易对有2个变化时只渲染2个', async () => {
  const changedRows = rows({
    BTCUSDT: { bias: 'BEARISH' },
    XAUUSDT: {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
      alignmentStatus: 'ALIGNED',
      alignmentDirection: 'BULLISH',
    },
  });
  const { result } = await primeAndRun(changedRows);

  assert.deepStrictEqual(
    result.notificationSymbols,
    ['BTCUSDT', 'XAUUSDT']
  );
  assert.deepStrictEqual(
    result.renderedNotificationSymbols,
    ['BTCUSDT', 'XAUUSDT']
  );
  assert.ok(
    result.message.indexOf('===== BTCUSDT =====') <
    result.message.indexOf('===== XAUUSDT =====')
  );
  for (const symbol of [
    'SNDKUSDT',
    'MUUSDT',
    'CLUSDT',
    'SPCXUSDT',
  ]) {
    assert.strictEqual(result.message.includes(symbol), false);
  }
});

test('没有变化时不发送', async () => {
  const { result, messages } = await primeAndRun(rows());

  assert.strictEqual(result.sent, false);
  assert.strictEqual(result.message, null);
  assert.deepStrictEqual(result.notificationSymbols, []);
  assert.strictEqual(messages.length, 1);
});

test('首次运行发送完整有效Watchlist', async () => {
  const runner = mutableRunner(rows());
  const messages = [];
  const result = await NotifyRunner.run({
    watchlistRunner: runner,
    stateStore: Filter.createMemoryStore(),
    opportunityHistoryStore:
      OpportunityHistory.createMemoryStore(),
    webhookUrl: 'https://example.test/watchlist',
    httpClient: httpRecorder(messages),
  });

  assert.strictEqual(result.sent, true);
  assert.deepStrictEqual(
    result.notificationSymbols,
    SYMBOLS
  );
  assert.deepStrictEqual(
    result.renderedNotificationSymbols,
    SYMBOLS
  );
  for (const symbol of SYMBOLS) {
    assert.ok(result.message.includes(
      '===== ' + symbol + ' ====='
    ));
  }
});

test('notification顺序保持原始Watchlist顺序', async () => {
  const changedRows = rows({
    BTCUSDT: { bias: 'BEARISH' },
    XAUUSDT: { bias: 'BEARISH' },
    SPCXUSDT: { bias: 'BEARISH' },
  });
  const { result } = await primeAndRun(changedRows);

  assert.deepStrictEqual(
    result.notificationSymbols,
    ['BTCUSDT', 'XAUUSDT', 'SPCXUSDT']
  );
  assert.deepStrictEqual(
    result.renderedNotificationSymbols,
    result.notificationSymbols
  );
});

test('Sweep-only变化不发送', async () => {
  const initialRows = rows({
    SPCXUSDT: {
      sweep: {
        id: 'SWEEP-1',
        side: 'SELL_SIDE',
        type: 'LTF_SWING_LOW',
        availableIndex: 10,
        time: 1000,
      },
    },
  });
  const runner = mutableRunner(initialRows);
  const store = Filter.createMemoryStore();
  const messages = [];
  const options = {
    watchlistRunner: runner,
    stateStore: store,
    opportunityHistoryStore:
      OpportunityHistory.createMemoryStore(),
    webhookUrl: 'https://example.test/watchlist',
    httpClient: httpRecorder(messages),
  };

  await NotifyRunner.run(options);
  runner.setResults(rows({
    SPCXUSDT: {
      sweep: {
        id: 'SWEEP-99',
        side: 'BUY_SIDE',
        type: 'LTF_SWING_HIGH',
        availableIndex: 99,
        time: 9999,
      },
    },
  }));
  const result = await NotifyRunner.run(options);

  assert.strictEqual(result.sent, false);
  assert.strictEqual(messages.length, 1);
});

test('动态MSS定位字段变化不发送', async () => {
  const initialRows = rows({
    BTCUSDT: { mss: stableMss(10, 100) },
  });
  const runner = mutableRunner(initialRows);
  const store = Filter.createMemoryStore();
  const messages = [];
  const options = {
    watchlistRunner: runner,
    stateStore: store,
    opportunityHistoryStore:
      OpportunityHistory.createMemoryStore(),
    webhookUrl: 'https://example.test/watchlist',
    httpClient: httpRecorder(messages),
  };

  await NotifyRunner.run(options);
  runner.setResults(rows({
    BTCUSDT: { mss: stableMss(999, 100) },
  }));
  const result = await NotifyRunner.run(options);

  assert.strictEqual(result.sent, false);
  assert.strictEqual(messages.length, 1);
});

test('进入WATCH_ZONE通知只突出Entry Watch变化', async () => {
  const changedRows = rows({
    BTCUSDT: {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62782,
      },
    },
  });
  const { result } = await primeAndRun(changedRows);
  const section = result.message.slice(
    result.message.indexOf('===== BTCUSDT =====')
  );

  assert.ok(section.includes('进入 WATCH_ZONE'));
  assert.ok(section.includes(
    '② 【Entry Watch】\n等待：\nEqual Low\n62782'
  ));
  assert.strictEqual(section.includes('Bias：'), false);
  assert.strictEqual(section.includes('Structure：'), false);
  assert.strictEqual(section.includes('Alignment：'), false);
});

test('确认变化通知突出事件链和下一等待事件', async () => {
  const changedRows = rows({
    BTCUSDT: {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62782,
      },
      sweeps: [{
        side: 'SELL_SIDE',
        type: 'EQUAL_LOW',
        price: 62782,
      }],
      currentMss: { direction: 'BULLISH' },
      displacement: { direction: 'BULLISH' },
    },
  });
  const { result } = await primeAndRun(changedRows);
  const section = result.message.slice(
    result.message.indexOf('===== BTCUSDT =====')
  );

  assert.ok(section.includes('✓ Sweep Equal Low'));
  assert.ok(section.includes('✓ Bullish MSS'));
  assert.ok(section.includes('✓ Bullish Displacement'));
  assert.ok(section.includes('状态：READY'));
  assert.strictEqual(section.includes('Bias：'), false);
  assert.strictEqual(section.includes('Structure：'), false);
});

test('缺失Symbol报告时不回退发送完整Watchlist', async () => {
  const initial = rows();
  const next = rows({
    BTCUSDT: { bias: 'BEARISH' },
  }).filter((result) => result.symbol !== 'MUUSDT');
  const runner = mutableRunner(initial);
  const store = Filter.createMemoryStore();
  const messages = [];
  const options = {
    watchlistRunner: runner,
    stateStore: store,
    opportunityHistoryStore:
      OpportunityHistory.createMemoryStore(),
    webhookUrl: 'https://example.test/watchlist',
    httpClient: httpRecorder(messages),
  };

  await NotifyRunner.run(options);
  runner.setResults(next);
  const result = await NotifyRunner.run(options);

  assert.strictEqual(result.sent, true);
  assert.deepStrictEqual(
    result.renderedNotificationSymbols,
    ['BTCUSDT']
  );
  assert.strictEqual(
    result.message.includes('FULL WATCHLIST MUST NOT BE USED'),
    false
  );
  assert.strictEqual(result.message.includes('MUUSDT'), false);
});

test('被选择的失败结果会明确显示状态而不静默丢失', () => {
  const message = NotifyRunner.formatChangeNotification(
    [{
      symbol: 'SPCXUSDT',
      status: 'FAILED',
      displayMessage: '分析生成失败',
    }],
    CURRENT_TIME,
    ['SPCXUSDT']
  );

  assert.ok(message.includes('===== SPCXUSDT ====='));
  assert.ok(message.includes('分析生成失败'));
});

test('Debug中的Notification与Rendered Symbols一致', async () => {
  const runner = mutableRunner(rows());
  const store = Filter.createMemoryStore();
  const messages = [];
  const logs = [];
  const baseOptions = {
    watchlistRunner: runner,
    stateStore: store,
    opportunityHistoryStore:
      OpportunityHistory.createMemoryStore(),
    webhookUrl: 'https://example.test/watchlist',
    httpClient: httpRecorder(messages),
  };

  await NotifyRunner.run(baseOptions);
  runner.setResults(rows({
    BTCUSDT: { bias: 'BEARISH' },
    XAUUSDT: {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
      alignmentStatus: 'ALIGNED',
      alignmentDirection: 'BULLISH',
    },
  }));
  const result = await NotifyRunner.run({
    ...baseOptions,
    debugNotification: true,
    logger: {
      log(value) {
        logs.push(value);
      },
    },
  });
  const output = logs.join('\n');
  const expected = '[\n  "BTCUSDT",\n  "XAUUSDT"\n]';

  assert.deepStrictEqual(
    result.notificationSymbols,
    result.renderedNotificationSymbols
  );
  assert.ok(output.includes(
    'Notification Symbols:\n' + expected
  ));
  assert.ok(output.includes(
    'Rendered Notification Symbols:\n' + expected
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
