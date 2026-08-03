'use strict';

/*
 * Daily Bias Backtest Audit V1 — 多符号运行器（D.1.2）
 *
 * 用法:
 *   node scripts/runDailyBiasBacktestAudit.js [START_ISO] [END_ISO] [SYMBOL...]
 *
 * 默认:
 *   SYMBOLS = BTCUSDT ETHUSDT BNBUSDT SOLUSDT
 *   START   = 2025-07-21T00:00:00.000Z
 *   END     = 2026-07-21T23:59:59.999Z
 *
 * 示例:
 *   全年 4 市场:  node scripts/runDailyBiasBacktestAudit.js
 *   指定市场:    node scripts/runDailyBiasBacktestAudit.js BTCUSDT ETHUSDT
 *   指定区间:    node scripts/runDailyBiasBacktestAudit.js \
 *                 2026-01-01T00:00:00.000Z 2026-03-01T00:00:00.000Z BTCUSDT
 *
 * 流程（每个符号独立）:
 *   1. 经 7890 代理拉 5m K 线（复用 runBacktest 拉取逻辑）
 *   2. 独立拉真实 4H K 线（与生产同源）
 *   3. 5m 链: AnalysisEngine -> setups -> entries -> 2R/-1R trades
 *   4. 对每个 trade 打 Daily Bias V1 标签 + htfLocationReadiness
 *   5. 输出总体三向 + Direction/Location/TRANSITION 分组 + 各符号明细
 *
 * 只读审计：不修改任何交易判断、不写入 Gate State。
 */

process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';

var fs = require('fs');
var path = require('path');
var RunBacktest = require('./runBacktest');
var DailyBiasAudit = require(
  '../backtest/dailyBiasBacktestAudit'
);

var DEFAULT_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
];
var DEFAULT_START = '2025-07-21T00:00:00.000Z';
var DEFAULT_END = '2026-07-21T23:59:59.999Z';

function parseArgs(argv) {
  var start = null;
  var end = null;
  var symbols = [];
  argv.forEach(function (raw) {
    var time = Date.parse(raw);
    if (isFinite(time)) {
      if (start === null) start = time;
      else if (end === null) end = time;
      return;
    }
    symbols.push(raw.toUpperCase());
  });
  return {
    start: start === null
      ? Date.parse(DEFAULT_START)
      : start,
    end: end === null
      ? Date.parse(DEFAULT_END)
      : end,
    symbols: symbols.length > 0
      ? symbols
      : DEFAULT_SYMBOLS.slice(),
  };
}

function fetchKlines(symbol, interval, start, end) {
  return RunBacktest.fetchHistoricalKlines(
    symbol,
    interval,
    start,
    end
  );
}

function runSymbol(symbol, start, end) {
  console.log('\n----- ' + symbol + ' -----');
  console.log('Fetching 5m klines...');
  return fetchKlines(symbol, '5m', start, end)
    .then(function (klines5m) {
      console.log('5m klines:', klines5m.length);
      console.log('Fetching 4H klines...');
      return fetchKlines(symbol, '4h', start, end)
        .then(function (h4Klines) {
          console.log('4H klines:', h4Klines.length);
          console.log('Running backtest + tagging...');
          var analysis = RunBacktest.analyzeHistoricalKlines(
            klines5m
          );
          var execution = RunBacktest.executeBacktest(
            analysis,
            klines5m,
            {}
          );
          console.log(
            'Trades:',
            execution.backtest.trades.length
          );
          return DailyBiasAudit.analyze({
            symbol: symbol,
            trades: execution.backtest.trades,
            klines5m: klines5m,
            h4Klines: h4Klines,
          });
        });
    });
}

function runAll(symbols, start, end) {
  var results = [];
  var chain = Promise.resolve();
  symbols.forEach(function (symbol) {
    chain = chain.then(function () {
      return runSymbol(symbol, start, end).then(function (result) {
        results.push(result);
      });
    });
  });
  return chain.then(function () {
    return DailyBiasAudit.combine(results);
  });
}

function main() {
  var config = parseArgs(process.argv.slice(2));

  if (!isFinite(config.start) || !isFinite(config.end)) {
    throw new Error('Invalid period arguments.');
  }

  console.log('=====================');
  console.log('Daily Bias Backtest Audit V1 - Multi Symbol');
  console.log('=====================');
  console.log('Symbols:', config.symbols.join(', '));
  console.log('Period:', new Date(config.start).toISOString(),
    '~', new Date(config.end).toISOString());
  console.log('Proxy: http://127.0.0.1:7890');

  return runAll(config.symbols, config.start, config.end)
    .then(function (combined) {
      var text = DailyBiasAudit.formatMultiReport(combined);
      var outputPath = path.resolve(
        __dirname,
        '..',
        'reports',
        'ict-daily-bias-backtest-audit.txt'
      );
      fs.writeFileSync(outputPath, text, 'utf8');

      console.log('\n===== Report =====');
      console.log(text);
      console.log('Saved:', outputPath);
    });
}

main().catch(function (error) {
  console.error(
    error && error.stack
      ? error.stack
      : String(error)
  );
  process.exitCode = 1;
});
