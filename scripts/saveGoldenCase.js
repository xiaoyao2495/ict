'use strict';

var WatchlistAnalyst = require('./runWatchlistAnalyst');
var GoldenCaseRecorder = require(
  '../history/ictGoldenCaseRecorder'
);

function normalizeSymbol(value) {
  var symbol = typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
  if (!/^[A-Z0-9]{5,30}$/.test(symbol)) {
    throw new Error(
      'Usage: node scripts/saveGoldenCase.js SYMBOL'
    );
  }
  return symbol;
}

function requestedSymbolLoader(symbol) {
  return {
    loadWatchlist: function () {
      return { symbols: [symbol] };
    },
  };
}

function findReport(results, symbol) {
  var list = Array.isArray(results) ? results : [];
  var index;
  for (index = 0; index < list.length; index += 1) {
    if (
      list[index] &&
      list[index].symbol === symbol &&
      list[index].status === 'SUCCESS' &&
      list[index].report
    ) {
      return list[index].report;
    }
  }
  throw new Error(
    'No successful Watchlist Analyst Report for ' + symbol + '.'
  );
}

function formatSavedMessage(saved) {
  return [
    'Golden Case Saved:',
    '',
    saved.symbol,
    '',
    'File:',
    saved.relativePath,
  ].join('\n');
}

function saveGoldenCase(symbolValue, options) {
  options = options || {};
  var symbol = normalizeSymbol(symbolValue);
  var runner = options.watchlistAnalyst || WatchlistAnalyst;
  var recorder = options.recorder || GoldenCaseRecorder;
  var output = typeof options.output === 'function'
    ? options.output
    : console.log;
  var runOptions = {
    currentTime: options.currentTime,
    limit: options.limit,
    marketData: options.marketData,
    watchlistPath: options.watchlistPath,
    watchlistLoader: options.watchlistLoader ||
      requestedSymbolLoader(symbol),
    symbolAvailabilityChecker:
      options.symbolAvailabilityChecker,
    exchangeInfoApi: options.exchangeInfoApi,
    output: function () {},
  };

  return Promise.resolve(runner.run(runOptions))
    .then(function (analysis) {
      var timestamp = options.timestamp;
      if (timestamp === undefined) {
        timestamp = analysis.currentTime;
      }
      return recorder.recordCase({
        symbol: symbol,
        report: findReport(analysis.results, symbol),
        timestamp: timestamp,
        outputDirectory: options.outputDirectory,
      });
    })
    .then(function (saved) {
      output(formatSavedMessage(saved));
      return saved;
    });
}

if (require.main === module) {
  saveGoldenCase(process.argv[2]).catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  findReport: findReport,
  formatSavedMessage: formatSavedMessage,
  requestedSymbolLoader: requestedSymbolLoader,
  saveGoldenCase: saveGoldenCase,
};
