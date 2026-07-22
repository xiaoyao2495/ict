'use strict';

const BaselineV1 = require('../config/baselineV1');
const RunBacktest = require('../scripts/runBacktest');

const SUPPORTED_SYMBOLS = Object.freeze([
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
]);

const BASELINE_KEYS = Object.freeze([
  'entryMode',
  'stop',
  'target',
  'maxWaitBars',
  'execution',
]);

function assertSupportedSymbol(symbol) {
  if (SUPPORTED_SYMBOLS.indexOf(symbol) === -1) {
    throw new Error('Unsupported symbol: ' + symbol);
  }
}

function assertKlines(klines) {
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error('A non-empty 5m Kline array is required.');
  }

  for (let index = 0; index < klines.length; index += 1) {
    if (!Number.isFinite(klines[index].openTime)) {
      throw new Error('Kline openTime must be finite at index ' + index);
    }
    if (
      index > 0 &&
      klines[index].openTime <= klines[index - 1].openTime
    ) {
      throw new Error('Klines must be strictly chronological.');
    }
  }
}

function assertBaselineConfiguration(configuration) {
  for (const key of BASELINE_KEYS) {
    if (!configuration || configuration[key] !== BaselineV1[key]) {
      throw new Error(
        'Multi-symbol experiment must use Baseline V1: ' + key
      );
    }
  }
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function calculateMaxDrawdown(values) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return maxDrawdown;
}

function calculateSharpe(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;

  const mean = finite.reduce((sum, value) => sum + value, 0) /
    finite.length;
  const variance = finite.reduce(
    (sum, value) => sum + Math.pow(value - mean, 2),
    0
  ) / (finite.length - 1);
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) return null;
  return mean / standardDeviation * Math.sqrt(finite.length);
}

function summarizeTrades(trades) {
  const chronological = trades
    .filter((trade) => (
      (trade.status === 'WIN' || trade.status === 'LOSS') &&
      Number.isFinite(trade.r)
    ))
    .slice()
    .sort((left, right) => left.entryIndex - right.entryIndex);
  const rValues = chronological.map((trade) => trade.r);
  const wins = chronological.filter(
    (trade) => trade.status === 'WIN'
  ).length;
  const losses = chronological.filter(
    (trade) => trade.status === 'LOSS'
  ).length;
  const totalR = rValues.reduce((sum, value) => sum + value, 0);
  const grossProfit = rValues.reduce(
    (sum, value) => sum + (value > 0 ? value : 0),
    0
  );
  const grossLoss = rValues.reduce(
    (sum, value) => sum + (value < 0 ? Math.abs(value) : 0),
    0
  );

  return {
    trades: chronological.length,
    wins,
    losses,
    winRate: chronological.length > 0
      ? wins / chronological.length
      : 0,
    totalR,
    averageR: chronological.length > 0
      ? totalR / chronological.length
      : null,
    medianR: median(rValues),
    maxDrawdown: calculateMaxDrawdown(rValues),
    sharpe: calculateSharpe(rValues),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
  };
}

function countTriggeredEntries(entries) {
  return entries.filter(
    (entry) => entry.status === 'ENTRY_TRIGGERED'
  ).length;
}

function analyzeSymbol(input, options) {
  const symbol = input && input.symbol;
  const klines = input && input.klines;
  const settings = options || {};
  const pipeline = settings.pipeline || RunBacktest;

  assertSupportedSymbol(symbol);
  assertKlines(klines);

  const analysis = pipeline.analyzeHistoricalKlines(klines);
  const execution = pipeline.executeBacktest(analysis, klines);

  assertBaselineConfiguration(execution.configuration);

  const trades = execution.backtest.trades || [];
  const statistics = summarizeTrades(trades);
  const report = {
    symbol,
    timeframe: '5m',
    klineCount: klines.length,
    startTime: new Date(klines[0].openTime).toISOString(),
    endTime: new Date(
      klines[klines.length - 1].openTime
    ).toISOString(),
    setupCount: analysis.setups.length,
    entryCount: countTriggeredEntries(execution.entries),
    ...statistics,
  };

  if (settings.includeDetails === true) {
    report.analysis = analysis;
    report.entries = execution.entries;
    report.tradeList = trades;
  }

  return report;
}

function normalizeInputs(inputs) {
  if (Array.isArray(inputs)) return inputs.slice();
  if (!inputs || typeof inputs !== 'object') {
    throw new Error('Symbol inputs must be an array or symbol map.');
  }

  return Object.keys(inputs).map((symbol) => ({
    symbol,
    klines: inputs[symbol],
  }));
}

function createComparison(reports) {
  return reports.map((report) => ({
    symbol: report.symbol,
    trades: report.trades,
    winRate: report.winRate,
    totalR: report.totalR,
    averageR: report.averageR,
    maxDrawdown: report.maxDrawdown,
  }));
}

function analyzeMultiSymbol(inputs, options) {
  const reports = normalizeInputs(inputs).map(
    (input) => analyzeSymbol(input, options)
  );

  return {
    protocol: {
      experimentOnly: true,
      productionEntryChanged: false,
      strategyLogicChanged: false,
      pipeline: 'scripts/runBacktest.js',
      htfContext: '1H, 4H and Daily PDH/PDL from the existing pipeline',
      maxDrawdownDefinition:
        'Peak-to-trough drawdown of cumulative closed-trade R',
      sharpeDefinition:
        'Mean closed-trade R / sample standard deviation * sqrt(trades)',
      profitFactorDefinition:
        'Gross positive R / absolute gross negative R',
    },
    configuration: { ...BaselineV1 },
    symbols: reports,
    comparison: createComparison(reports),
  };
}

module.exports = {
  BASELINE_V1: BaselineV1,
  DEFAULT_PIPELINE: RunBacktest,
  SUPPORTED_SYMBOLS,
  analyzeMultiSymbol,
  analyzeSymbol,
  assertBaselineConfiguration,
  calculateMaxDrawdown,
  calculateSharpe,
  createComparison,
  median,
  summarizeTrades,
};
