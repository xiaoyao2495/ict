'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Analyzer = require(
  '../history/ictOpportunityStatisticsAnalyzer'
);
const Formatter = require(
  '../formatters/ictOpportunityStatisticsFormatter'
);
const Report = require(
  '../scripts/generateOpportunityStatisticsReport'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function entry(symbol, status, changedAt, options) {
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
    changedAt,
  };
}

function fixture() {
  const btc = [
    entry('BTCUSDT', 'WAITING', '2026-07-30T00:00:00Z', {
      liquidityType: null,
      liquidityPrice: null,
    }),
    entry('BTCUSDT', 'WATCH_ZONE', '2026-07-30T00:05:00Z'),
    entry('BTCUSDT', 'CONFIRMING', '2026-07-30T00:10:00Z'),
    entry('BTCUSDT', 'CONFIRMED', '2026-07-30T00:15:00Z'),
    entry('BTCUSDT', 'WAITING', '2026-07-30T15:55:00Z', {
      h4Bias: 'BEARISH',
      direction: 'BEARISH',
      liquidityType: null,
      liquidityPrice: null,
    }),
    entry('BTCUSDT', 'WATCH_ZONE', '2026-07-30T16:00:00Z', {
      h4Bias: 'BEARISH',
      direction: 'BEARISH',
      liquidityType: 'PWH',
      liquidityPrice: 110,
    }),
  ];
  const eth = [
    entry('ETHUSDT', 'WATCH_ZONE', '2026-07-30T09:00:00Z', {
      liquidityType: 'EQUAL_LOW',
      liquidityPrice: 200,
    }),
    entry('ETHUSDT', 'CONFIRMED', '2026-07-30T09:10:00Z', {
      liquidityType: 'EQUAL_LOW',
      liquidityPrice: 200,
    }),
  ];
  return {
    version: 1,
    symbols: {
      BTCUSDT: {
        current: btc[btc.length - 1],
        transitions: btc,
      },
      ETHUSDT: {
        current: eth[eth.length - 1],
        transitions: eth,
      },
    },
  };
}

function cohort(items, label) {
  return items.find((item) => item.label === label);
}

test('counts distinct WATCH_ZONE opportunities', () => {
  const input = fixture();
  const snapshot = JSON.stringify(input);
  const statistics = Analyzer.analyze(input);

  assert.strictEqual(statistics.totalOpportunities, 3);
  assert.strictEqual(JSON.stringify(input), snapshot);
});

test('calculates lifecycle conversion ratios', () => {
  const statistics = Analyzer.analyze(fixture());

  assert.deepStrictEqual(
    statistics.transitions.waitingToWatchZone,
    { sourceCount: 2, convertedCount: 2, ratio: 1 }
  );
  assert.deepStrictEqual(
    statistics.transitions.watchZoneToConfirming,
    {
      sourceCount: 3,
      convertedCount: 1,
      ratio: 1 / 3,
    }
  );
  assert.deepStrictEqual(
    statistics.transitions.watchZoneToConfirmed,
    {
      sourceCount: 3,
      convertedCount: 2,
      ratio: 2 / 3,
    }
  );
});

test('reports every fixed liquidity type including zero groups', () => {
  const statistics = Analyzer.analyze(fixture());

  assert.deepStrictEqual(
    statistics.liquidityTypes.map((item) => item.label),
    Analyzer.LIQUIDITY_TYPES
  );
  assert.deepStrictEqual(
    cohort(statistics.liquidityTypes, 'PDL'),
    {
      label: 'PDL',
      count: 1,
      confirmedCount: 1,
      conversionRate: 1,
    }
  );
  assert.deepStrictEqual(
    cohort(statistics.liquidityTypes, 'PWH'),
    {
      label: 'PWH',
      count: 1,
      confirmedCount: 0,
      conversionRate: 0,
    }
  );
  assert.strictEqual(
    cohort(
      statistics.liquidityTypes,
      'H4_SWING_HIGH'
    ).count,
    0
  );
});

test('groups WATCH_ZONE time by UTC+8 session', () => {
  const statistics = Analyzer.analyze(fixture());

  assert.deepStrictEqual(
    statistics.timeBuckets.map((item) => ({
      label: item.label,
      count: item.count,
      confirmedCount: item.confirmedCount,
    })),
    [
      { label: '0-8', count: 1, confirmedCount: 0 },
      { label: '8-16', count: 1, confirmedCount: 1 },
      { label: '16-24', count: 1, confirmedCount: 1 },
    ]
  );
});

test('formatter includes all requested statistics', () => {
  const statistics = Analyzer.analyze(fixture());
  const text = Formatter.format(statistics, {
    generatedAt: '2026-07-30T00:00:00Z',
  });

  assert(text.includes('1. 总机会数量：3'));
  assert(text.includes(
    '2. WAITING → WATCH_ZONE比例：100.00%（2/2）'
  ));
  assert(text.includes(
    'WATCH_ZONE → CONFIRMED比例：66.67%（2/3）'
  ));
  assert(text.includes(
    'PDL：次数 1，CONFIRMED数量 1，转化率 100.00%'
  ));
  assert(text.includes(
    '0-8：次数 1，CONFIRMED数量 0，转化率 0.00%'
  ));
  assert(text.includes('2026-07-30 08:00:00'));
});

test('generator reads history JSON and writes statistics TXT', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ict-opportunity-statistics-')
  );
  const inputPath = path.join(directory, 'history.json');
  const outputPath = path.join(directory, 'statistics.txt');

  try {
    await fs.writeFile(
      inputPath,
      JSON.stringify(fixture()),
      'utf8'
    );
    const result =
      await Report.generateOpportunityStatisticsReport({
        inputPath,
        outputPath,
        generatedAt: '2026-07-30T00:00:00Z',
      });
    const saved = await fs.readFile(outputPath, 'utf8');

    assert.strictEqual(result.outputPath, outputPath);
    assert.strictEqual(saved, result.text);
    assert.strictEqual(
      result.statistics.totalOpportunities,
      3
    );
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
