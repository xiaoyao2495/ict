'use strict';

const assert = require('assert');
const BaselineV1 = require('../config/baselineV1');
const MultiSymbolExperiment = require(
  '../backtest/multiSymbolExperiment'
);
const RunBacktest = require('../scripts/runBacktest');

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

function createKlines(count) {
  return Array.from({ length: count }, (_, index) => ({
    openTime: Date.UTC(2024, 0, 1) + index * 5 * 60 * 1000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  }));
}

function createPipeline(trades, entries, setupCount) {
  return {
    analyzeHistoricalKlines(klines) {
      return {
        setups: Array.from({ length: setupCount }, () => ({})),
        sourceKlines: klines,
      };
    },
    executeBacktest(analysis, klines) {
      assert.strictEqual(analysis.sourceKlines, klines);
      return {
        configuration: { ...BaselineV1 },
        entries,
        backtest: { trades },
      };
    },
  };
}

test('supports only the requested BTC ETH and SOL symbols', () => {
  assert.deepStrictEqual(
    MultiSymbolExperiment.SUPPORTED_SYMBOLS,
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  );
  assert.throws(
    () => MultiSymbolExperiment.analyzeSymbol({
      symbol: 'XRPUSDT',
      klines: createKlines(2),
    }),
    /Unsupported symbol/
  );
});

test('uses the existing Baseline V1 production pipeline by default', () => {
  assert.strictEqual(
    MultiSymbolExperiment.DEFAULT_PIPELINE,
    RunBacktest
  );
  assert.deepStrictEqual(
    MultiSymbolExperiment.BASELINE_V1,
    BaselineV1
  );
});

test('summarizes closed trades in chronological order', () => {
  const summary = MultiSymbolExperiment.summarizeTrades([
    { entryIndex: 2, status: 'WIN', r: 2 },
    { entryIndex: 1, status: 'LOSS', r: -1 },
    { entryIndex: 3, status: 'LOSS', r: -1 },
    { entryIndex: 4, status: 'OPEN', r: null },
  ]);

  assert.strictEqual(summary.trades, 3);
  assert.strictEqual(summary.wins, 1);
  assert.strictEqual(summary.losses, 2);
  assert.strictEqual(summary.winRate, 1 / 3);
  assert.strictEqual(summary.totalR, 0);
  assert.strictEqual(summary.averageR, 0);
  assert.strictEqual(summary.medianR, -1);
  assert.strictEqual(summary.maxDrawdown, 1);
  assert.strictEqual(summary.sharpe, 0);
  assert.strictEqual(summary.profitFactor, 1);
});

test('analyzes a symbol without mutating Klines or overriding baseline', () => {
  const klines = createKlines(3);
  const before = JSON.stringify(klines);
  const entries = [
    { status: 'ENTRY_TRIGGERED' },
    { status: 'EXPIRED' },
  ];
  const pipeline = createPipeline(
    [{ entryIndex: 1, status: 'WIN', r: 1.5 }],
    entries,
    2
  );
  const result = MultiSymbolExperiment.analyzeSymbol(
    { symbol: 'ETHUSDT', klines },
    { pipeline }
  );

  assert.strictEqual(result.symbol, 'ETHUSDT');
  assert.strictEqual(result.timeframe, '5m');
  assert.strictEqual(result.klineCount, 3);
  assert.strictEqual(result.setupCount, 2);
  assert.strictEqual(result.entryCount, 1);
  assert.strictEqual(result.trades, 1);
  assert.strictEqual(JSON.stringify(klines), before);
});

test('rejects a pipeline result that is not the frozen baseline', () => {
  const pipeline = createPipeline([], [], 0);
  const originalExecute = pipeline.executeBacktest;
  pipeline.executeBacktest = (analysis, klines) => {
    const result = originalExecute(analysis, klines);
    result.configuration.maxWaitBars = 8;
    return result;
  };

  assert.throws(
    () => MultiSymbolExperiment.analyzeSymbol(
      { symbol: 'SOLUSDT', klines: createKlines(2) },
      { pipeline }
    ),
    /must use Baseline V1: maxWaitBars/
  );
});

test('creates the requested cross-symbol comparison', () => {
  const pipeline = createPipeline(
    [
      { entryIndex: 1, status: 'LOSS', r: -1 },
      { entryIndex: 2, status: 'WIN', r: 2 },
    ],
    [
      { status: 'ENTRY_TRIGGERED' },
      { status: 'ENTRY_TRIGGERED' },
    ],
    1
  );
  const result = MultiSymbolExperiment.analyzeMultiSymbol(
    {
      BTCUSDT: createKlines(4),
      SOLUSDT: createKlines(5),
    },
    { pipeline }
  );

  assert.strictEqual(result.symbols.length, 2);
  assert.deepStrictEqual(result.comparison[0], {
    symbol: 'BTCUSDT',
    trades: 2,
    winRate: 0.5,
    totalR: 1,
    averageR: 0.5,
    maxDrawdown: 1,
  });
  assert.strictEqual(result.protocol.productionEntryChanged, false);
  assert.deepStrictEqual(result.configuration, BaselineV1);
});

console.log('\n' + testsPassed + ' tests passed.');
