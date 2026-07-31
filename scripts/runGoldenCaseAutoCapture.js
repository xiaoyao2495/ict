'use strict';

var WatchlistAnalyst = require('./runWatchlistAnalyst');
var AutoCapture = require(
  '../history/ictGoldenCaseAutoCapture'
);

function formatResult(result) {
  var lines = [
    'Golden Case Auto Capture:',
    '',
    'Captured: ' + result.capturedCount,
    'Skipped: ' + result.skippedCount,
    'Failed: ' + result.failedCount,
  ];
  result.results.forEach(function (item) {
    lines.push(
      '- ' + item.symbol + ': ' + item.status +
      (typeof item.reason === 'string'
        ? ' (' + item.reason + ')'
        : '')
    );
  });
  return lines.join('\n');
}

function run(options) {
  options = options || {};
  var runner = options.watchlistAnalyst || WatchlistAnalyst;
  var capture = options.autoCapture || AutoCapture;
  var output = typeof options.output === 'function'
    ? options.output
    : console.log;
  var runOptions = {
    currentTime: options.currentTime,
    limit: options.limit,
    marketData: options.marketData,
    watchlistPath: options.watchlistPath,
    watchlistLoader: options.watchlistLoader,
    symbolAvailabilityChecker:
      options.symbolAvailabilityChecker,
    exchangeInfoApi: options.exchangeInfoApi,
    output: function () {},
  };

  return Promise.resolve(runner.run(runOptions))
    .then(function (analysis) {
      return capture.captureReports({
        results: analysis.results,
        timestamp: analysis.currentTime,
        casesDirectory: options.casesDirectory,
        recorder: options.recorder,
      });
    })
    .then(function (result) {
      output(formatResult(result));
      return result;
    });
}

if (require.main === module) {
  run().catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  formatResult: formatResult,
  run: run,
};
