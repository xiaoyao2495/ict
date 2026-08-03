'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const History = require(
  '../history/ictOpportunityHistory'
);

const BASE_TIME = Date.UTC(2026, 6, 30, 0);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function result(symbol, options) {
  options = options || {};
  const opportunity = options.opportunity || {
    status: 'WAITING',
    direction: options.bias || 'BULLISH',
    liquidityType: null,
    price: null,
  };
  return {
    symbol,
    status: 'SUCCESS',
    report: {
      symbol,
      current: {
        asOf: options.time || BASE_TIME,
        fourHourAnalysis: {
          bias: options.bias || 'BULLISH',
          ...(options.dailyBias === undefined
            ? {}
            : { dailyBias: options.dailyBias }),
        },
        opportunity,
        fiveMinuteObservation: {
          currentConfirmed: {
            liquiditySweeps: options.sweeps || [],
            confirmation: options.confirmation || null,
          },
        },
      },
    },
  };
}

test('initial WAITING state is recorded once', async () => {
  const store = History.createMemoryStore();
  const first = await History.recordResults({
    results: [result('BTCUSDT')],
    store,
    recordedAt: BASE_TIME,
  });
  const duplicate = await History.recordResults({
    results: [result('BTCUSDT')],
    store,
    recordedAt: BASE_TIME + 300000,
  });

  assert.strictEqual(first.changed, true);
  assert.strictEqual(duplicate.changed, false);
  const record = duplicate.state.symbols.BTCUSDT;
  assert.strictEqual(record.transitions.length, 1);
  assert.deepStrictEqual(record.current, {
    symbol: 'BTCUSDT',
    h4Bias: 'BULLISH',
    marketBias: 'BULLISH',
    biasSourceVersion: 'htf_bias_v3',
    direction: 'BULLISH',
    opportunityDirection: 'BULLISH',
    liquidityType: null,
    liquidityPrice: null,
    status: 'WAITING',
    changedAt: '2026-07-30T00:00:00.000Z',
  });
});

test('WATCH_ZONE CONFIRMING CONFIRMED transitions keep times', async () => {
  const store = History.createMemoryStore();
  const opportunity = {
    status: 'WATCH_ZONE',
    direction: 'BULLISH',
    liquidityType: 'PDL',
    price: 99.6,
  };

  await History.recordResults({
    results: [result('BTCUSDT', {
      time: BASE_TIME,
      opportunity,
    })],
    store,
  });
  await History.recordResults({
    results: [result('BTCUSDT', {
      time: BASE_TIME + 300000,
      opportunity,
      sweeps: [{ side: 'SELL_SIDE' }],
    })],
    store,
  });
  const completed = await History.recordResults({
    results: [result('BTCUSDT', {
      time: BASE_TIME + 600000,
      opportunity,
      sweeps: [{ side: 'SELL_SIDE' }],
      confirmation: {
        status: 'CONFIRMED',
        direction: 'BULLISH',
      },
    })],
    store,
  });

  const transitions =
    completed.state.symbols.BTCUSDT.transitions;
  assert.deepStrictEqual(
    transitions.map((entry) => entry.status),
    ['WATCH_ZONE', 'CONFIRMING', 'CONFIRMED']
  );
  assert.deepStrictEqual(
    transitions.map((entry) => entry.changedAt),
    [
      '2026-07-30T00:00:00.000Z',
      '2026-07-30T00:05:00.000Z',
      '2026-07-30T00:10:00.000Z',
    ]
  );
});

test('symbols keep independent lifecycle histories', async () => {
  const store = History.createMemoryStore();
  const recorded = await History.recordResults({
    results: [
      result('BTCUSDT'),
      result('ETHUSDT', {
        bias: 'BEARISH',
        opportunity: {
          status: 'WATCH_ZONE',
          direction: 'BEARISH',
          liquidityType: 'PDH',
          price: 101,
        },
      }),
      { symbol: 'FAILEDUSDT', status: 'FAILED' },
    ],
    store,
  });

  assert.deepStrictEqual(
    Object.keys(recorded.state.symbols).sort(),
    ['BTCUSDT', 'ETHUSDT']
  );
  assert.strictEqual(
    recorded.state.symbols.ETHUSDT.current.status,
    'WATCH_ZONE'
  );
});

test('opportunity identity change is recorded within a status', async () => {
  const store = History.createMemoryStore();
  const base = {
    status: 'WATCH_ZONE',
    direction: 'BULLISH',
    liquidityType: 'PDL',
    price: 99.6,
  };
  await History.recordResults({
    results: [result('BTCUSDT', {
      opportunity: base,
    })],
    store,
  });
  const changed = await History.recordResults({
    results: [result('BTCUSDT', {
      time: BASE_TIME + 300000,
      opportunity: {
        ...base,
        liquidityType: 'PWL',
        price: 99.5,
      },
    })],
    store,
  });

  assert.strictEqual(changed.changed, true);
  assert.strictEqual(
    changed.state.symbols.BTCUSDT.transitions.length,
    2
  );
});

test('file store persists standalone JSON history', async () => {
  const filePath = path.join(
    os.tmpdir(),
    'ict-opportunity-history-' +
      process.pid + '-' + Date.now() + '.json'
  );
  try {
    const writer = History.createFileStore(filePath);
    await History.recordResults({
      results: [result('BTCUSDT')],
      store: writer,
    });
    const reader = History.createFileStore(filePath);
    const loaded = await reader.load();

    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(
      loaded.symbols.BTCUSDT.transitions.length,
      1
    );
  } finally {
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
});

test('Daily Bias opportunity history records daily_bias_v1 source', async () => {
  const store = History.createMemoryStore();
  const recorded = await History.recordResults({
    results: [result('BTCUSDT', {
      bias: 'BULLISH',
      dailyBias: {
        marketBias: 'BEARISH',
        transitionDirection: null,
        structureState: 'BEARISH_CONFIRMED',
      },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BEARISH',
        liquidityType: 'PDH',
        price: 101,
      },
    })],
    store,
    recordedAt: BASE_TIME,
  });

  const entry = recorded.state.symbols.BTCUSDT.current;
  assert.strictEqual(entry.biasSourceVersion, 'daily_bias_v1');
  assert.strictEqual(entry.h4Bias, 'BEARISH');
  assert.strictEqual(entry.marketBias, 'BEARISH');
  assert.strictEqual(entry.direction, 'BEARISH');
  assert.strictEqual(entry.opportunityDirection, 'BEARISH');
});

test('legacy history without biasSourceVersion defaults to htf_bias_v3', async () => {
  const legacy = {
    version: 1,
    symbols: {
      BTCUSDT: {
        current: {
          symbol: 'BTCUSDT',
          h4Bias: 'BULLISH',
          direction: 'BULLISH',
          liquidityType: null,
          liquidityPrice: null,
          status: 'WAITING',
          changedAt: '2026-07-30T00:00:00.000Z',
        },
        transitions: [
          {
            symbol: 'BTCUSDT',
            h4Bias: 'BULLISH',
            direction: 'BULLISH',
            liquidityType: null,
            liquidityPrice: null,
            status: 'WAITING',
            changedAt: '2026-07-30T00:00:00.000Z',
          },
        ],
      },
    },
  };
  const before = JSON.stringify(legacy);
  const normalized = History.normalizeHistory(legacy);
  const entry = normalized.symbols.BTCUSDT.current;

  assert.strictEqual(entry.biasSourceVersion, 'htf_bias_v3');
  assert.strictEqual(entry.marketBias, 'BULLISH');
  assert.strictEqual(entry.opportunityDirection, 'BULLISH');
  assert.strictEqual(JSON.stringify(legacy), before);
});

test('No mixed bias fields when Daily Bias and legacy bias disagree', async () => {
  const store = History.createMemoryStore();
  const recorded = await History.recordResults({
    results: [result('BTCUSDT', {
      bias: 'BULLISH',
      dailyBias: { marketBias: 'BEARISH' },
      opportunity: {
        status: 'CONFIRMING',
        direction: 'BEARISH',
        liquidityType: 'PDH',
        price: 101,
      },
    })],
    store,
    recordedAt: BASE_TIME,
  });

  const entry = recorded.state.symbols.BTCUSDT.current;
  // 同一记录内所有 bias 方向字段必须来自同一来源（daily_bias_v1）
  assert.strictEqual(entry.biasSourceVersion, 'daily_bias_v1');
  assert.strictEqual(entry.h4Bias, 'BEARISH');
  assert.strictEqual(entry.marketBias, 'BEARISH');
  assert.strictEqual(entry.direction, 'BEARISH');
  assert.strictEqual(entry.opportunityDirection, 'BEARISH');
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
