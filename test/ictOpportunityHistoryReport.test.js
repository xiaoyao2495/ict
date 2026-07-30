'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Formatter = require(
  '../formatters/ictOpportunityHistoryFormatter'
);
const Report = require(
  '../scripts/generateOpportunityHistoryReport'
);

const AS_OF = '2026-07-30T01:00:00.000Z';
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function entry(symbol, status, time, options) {
  options = options || {};
  return {
    symbol,
    h4Bias: options.h4Bias || 'BULLISH',
    direction: options.direction || 'BULLISH',
    liquidityType: options.liquidityType === undefined
      ? 'PDL'
      : options.liquidityType,
    liquidityPrice: options.liquidityPrice === undefined
      ? 100
      : options.liquidityPrice,
    status,
    changedAt: time,
  };
}

function fixture() {
  const btc = [
    entry(
      'BTCUSDT',
      'WAITING',
      '2026-07-29T23:50:00.000Z',
      {
        liquidityType: null,
        liquidityPrice: null,
      }
    ),
    entry(
      'BTCUSDT',
      'WATCH_ZONE',
      '2026-07-30T00:00:00.000Z'
    ),
    entry(
      'BTCUSDT',
      'CONFIRMING',
      '2026-07-30T00:15:00.000Z'
    ),
    entry(
      'BTCUSDT',
      'CONFIRMED',
      '2026-07-30T00:30:00.000Z'
    ),
  ];
  const eth = [
    entry(
      'ETHUSDT',
      'WAITING',
      '2026-07-30T00:10:00.000Z',
      {
        h4Bias: 'BEARISH',
        direction: 'BEARISH',
        liquidityType: null,
        liquidityPrice: null,
      }
    ),
    entry(
      'ETHUSDT',
      'WATCH_ZONE',
      '2026-07-30T00:40:00.000Z',
      {
        h4Bias: 'BEARISH',
        direction: 'BEARISH',
        liquidityType: 'PDH',
        liquidityPrice: 200,
      }
    ),
  ];
  return {
    version: 1,
    symbols: {
      BTCUSDT: {
        current: btc[3],
        transitions: btc,
      },
      ETHUSDT: {
        current: eth[1],
        transitions: eth,
      },
    },
  };
}

test('summarizes each symbol latest opportunity', () => {
  const summary = Formatter.summarize(fixture(), {
    asOf: AS_OF,
  });
  const btc = summary.symbols.find(
    (item) => item.symbol === 'BTCUSDT'
  );
  const eth = summary.symbols.find(
    (item) => item.symbol === 'ETHUSDT'
  );

  assert.strictEqual(btc.current.status, 'CONFIRMED');
  assert.strictEqual(btc.reachedConfirmed, true);
  assert.deepStrictEqual(
    btc.lifecycle.map((item) => item.status),
    [
      'WAITING',
      'WATCH_ZONE',
      'CONFIRMING',
      'CONFIRMED',
    ]
  );
  assert.strictEqual(eth.current.status, 'WATCH_ZONE');
  assert.strictEqual(eth.reachedConfirmed, false);
});

test('calculates latest WATCH_ZONE duration', () => {
  const summary = Formatter.summarize(fixture(), {
    asOf: AS_OF,
  });
  const btc = summary.symbols.find(
    (item) => item.symbol === 'BTCUSDT'
  );
  const eth = summary.symbols.find(
    (item) => item.symbol === 'ETHUSDT'
  );

  assert.strictEqual(btc.watchZoneDurationMs, 15 * 60000);
  assert.strictEqual(eth.watchZoneDurationMs, 20 * 60000);
  assert.strictEqual(
    Formatter.formatDuration(btc.watchZoneDurationMs),
    '15分钟'
  );
});

test('liquidity statistics count one lifecycle once', () => {
  const summary = Formatter.summarize(fixture(), {
    asOf: AS_OF,
  });

  assert.deepStrictEqual(summary.liquidityStatistics, [
    { type: 'PDH', count: 1 },
    { type: 'PDL', count: 1 },
  ]);
});

test('formatter includes required report sections', () => {
  const input = fixture();
  const snapshot = JSON.stringify(input);
  const text = Formatter.formatHistory(input, {
    asOf: AS_OF,
  });

  assert(text.includes('===== BTCUSDT ====='));
  assert(text.includes('1. 最近机会'));
  assert(text.includes('2. 生命周期'));
  assert(text.includes('3. WATCH_ZONE持续时间：15分钟'));
  assert(text.includes('4. 是否达到CONFIRMED：是'));
  assert(text.includes('5. 流动性类型统计'));
  assert(text.includes('2026-07-30 08:00:00'));
  assert.strictEqual(JSON.stringify(input), snapshot);
});

test('report generator reads JSON and writes summary text', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-opportunity-report-')
  );
  const inputPath = path.join(directory, 'history.json');
  const outputPath = path.join(directory, 'summary.txt');

  try {
    await fs.writeFile(
      inputPath,
      JSON.stringify(fixture()),
      'utf8'
    );
    const result =
      await Report.generateOpportunityHistoryReport({
        inputPath,
        outputPath,
        asOf: AS_OF,
      });
    const saved = await fs.readFile(outputPath, 'utf8');

    assert.strictEqual(result.outputPath, outputPath);
    assert.strictEqual(saved, result.text);
    assert(saved.includes('BTCUSDT'));
    assert(saved.includes('PDL：1次'));
  } finally {
    await fs.rm(directory, {
      recursive: true,
      force: true,
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
