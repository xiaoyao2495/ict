'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const RunBacktest = require('./runBacktest');
const TradingCostExperiment = require(
  '../backtest/tradingCostExperiment'
);

function parseCsv(text) {
  const result = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const values = line.split(',');
    const openTime = Number(values[0]);
    if (!Number.isFinite(openTime)) continue;
    result.push({
      openTime,
      open: Number(values[1]),
      high: Number(values[2]),
      low: Number(values[3]),
      close: Number(values[4]),
      volume: Number(values[5]),
      closeTime: Number(values[6]),
    });
  }
  return result;
}

function loadArchives(directory) {
  const byOpenTime = new Map();
  const names = fs.readdirSync(directory).filter(
    (name) => name.endsWith('.zip')
  ).sort();

  for (const name of names) {
    const csv = childProcess.execFileSync(
      'tar',
      ['-xOf', path.join(directory, name)],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    for (const kline of parseCsv(csv)) {
      byOpenTime.set(kline.openTime, kline);
    }
  }

  return [...byOpenTime.values()].sort(
    (left, right) => left.openTime - right.openTime
  );
}

function withoutProgressLogs(callback) {
  const originalLog = console.log;
  console.log = function () {};
  try {
    return callback();
  } finally {
    console.log = originalLog;
  }
}

function number(value, digits = 2) {
  return value === null || value === undefined
    ? '—'
    : Number(value).toFixed(digits);
}

function percent(value) {
  return `${number(value)}%`;
}

function slippage(value) {
  return `${number(value * 100)}%`;
}

function formatReport(result) {
  const costNames = {
    A: 'A No cost',
    B: 'B Taker 0.05%/side',
    C: 'C Maker 0.02%/side',
  };
  const lines = [
    '# Trading Cost Experiment',
    '',
    '样本：Baseline V1 已成交交易 78 笔',
    '',
    '## 计算口径',
    '',
    '- Baseline：所有交易按入场前账户权益的 1% 风险。',
    '- Quality Risk C：保持现有固定 Score 风险和低质量连续2亏保护。',
    '- 滑点均为不利方向；双边手续费按调整后的 Entry/Exit 名义价格收取。',
    '- 净 R 分母为原计划 Entry 到 Stop 的绝对距离。',
    '- Risk C 连亏状态仍按原始交易胜负更新。',
    '',
    '## 全周期比较',
    '',
    '| Portfolio | Cost | Slip | Net R | Ending | Return | Max DD | Sharpe | PF | Recovery |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const scenarios of Object.values(result.scenarios)) {
    for (const scenario of scenarios) {
      const row = scenario.overall;
      lines.push(
        `| ${scenario.portfolioName} | ${costNames[scenario.costScheme]} | ` +
        `${slippage(scenario.slippageRate)} | ${number(row.totalR, 4)} | ` +
        `${number(row.endingBalance)} | ${percent(row.returnPercent)} | ` +
        `${number(row.maxDrawdown)} / ${percent(row.maxDrawdownPercent)} | ` +
        `${number(row.sharpe, 3)} | ${number(row.profitFactor, 3)} | ` +
        `${number(row.recoveryFactor, 3)} |`
      );
    }
  }

  for (const [model, scenarios] of Object.entries(result.scenarios)) {
    lines.push(
      '',
      `## ${model === 'BASELINE' ? 'Baseline' : 'Quality Risk C'} 年度明细`,
      '',
      '| Cost | Slip | Year | Net R | Ending | Return | Max DD | Sharpe | PF | Recovery |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
    );
    for (const scenario of scenarios) {
      for (const row of scenario.yearly) {
        lines.push(
          `| ${costNames[scenario.costScheme]} | ` +
          `${slippage(scenario.slippageRate)} | ${row.year} | ` +
          `${number(row.totalR, 4)} | ${number(row.endingBalance)} | ` +
          `${percent(row.returnPercent)} | ${number(row.maxDrawdown)} / ` +
          `${percent(row.maxDrawdownPercent)} | ${number(row.sharpe, 3)} | ` +
          `${number(row.profitFactor, 3)} | ${number(row.recoveryFactor, 3)} |`
        );
      }
    }
  }

  return lines.join('\n');
}

function run(directory) {
  const klines = loadArchives(directory);
  return withoutProgressLogs(function () {
    const analysis = RunBacktest.analyzeHistoricalKlines(klines);
    const execution = RunBacktest.executeBacktest(analysis, klines);
    return TradingCostExperiment.analyzeTradingCosts({
      setups: analysis.setups,
      entries: execution.entries,
      trades: execution.backtest.trades,
      klines,
    });
  });
}

if (require.main === module) {
  try {
    const directory = process.argv[2];
    if (!directory) throw new Error('Archive directory is required.');
    console.log(formatReport(run(directory)));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  formatReport,
  loadArchives,
  parseCsv,
  run,
};
