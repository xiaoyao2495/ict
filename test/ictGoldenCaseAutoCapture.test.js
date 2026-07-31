'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var AutoCapture = require(
  '../history/ictGoldenCaseAutoCapture'
);
var Recorder = require(
  '../history/ictGoldenCaseRecorder'
);
var Runner = require(
  '../scripts/runGoldenCaseAutoCapture'
);

var TIMESTAMP = Date.UTC(2026, 6, 31, 0, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function report(symbol, options) {
  options = options || {};
  return {
    symbol: symbol,
    current: {
      asOf: TIMESTAMP,
      fourHourAnalysis: {
        bias: options.h4Bias || 'BULLISH',
        currentStructure: options.h4Bias || 'BULLISH',
        premiumDiscount: 'DISCOUNT',
      },
      structurePhase: {
        state: 'BULLISH_CONFIRMED',
        direction: 'BULLISH',
        context: 'retained context',
        sourceEvent: null,
        mssEvent: null,
        confirmationBos: null,
      },
      htfAlignment: {
        status: options.alignmentStatus || 'ALIGNED',
        biasDirection: options.h4Bias || 'BULLISH',
        structureDirection: options.h4Bias || 'BULLISH',
        reason: 'retained reason',
      },
      opportunity: {
        status: options.opportunityStatus || 'WATCH_ZONE',
        direction: options.h4Bias || 'BULLISH',
        liquidityType: 'PDL',
        price: 100,
      },
      fiveMinuteObservation: {
        currentConfirmed: {
          confirmation: null,
        },
      },
    },
  };
}

function workspace() {
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-auto-'
  ));
}

function removeWorkspace(directory) {
  if (!directory) return Promise.resolve();
  return fs.rm(directory, { recursive: true, force: true });
}

function jsonFiles(directory) {
  return fs.readdir(directory).then(function (files) {
    return files.filter(function (fileName) {
      return /\.json$/i.test(fileName);
    }).sort();
  }).catch(function (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

test('eligible Watchlist report is captured automatically', function () {
  var directory;
  var source = report('BTCUSDT');
  var before = JSON.stringify(source);

  return workspace().then(function (created) {
    directory = created;
    return AutoCapture.captureReports({
      reports: [source],
      timestamp: TIMESTAMP,
      casesDirectory: directory,
    });
  }).then(function (result) {
    assert.strictEqual(result.capturedCount, 1);
    assert.strictEqual(result.failedCount, 0);
    return fs.readFile(
      path.join(directory, '2026-07-31-BTCUSDT.json'),
      'utf8'
    );
  }).then(function (content) {
    var saved = JSON.parse(content);
    assert.deepStrictEqual(saved.captureReason, {
      opportunityStatus: 'WATCH_ZONE',
      htfBias: 'BULLISH',
      alignmentStatus: 'ALIGNED',
    });
    assert.strictEqual(saved.opportunity.status, 'WATCH_ZONE');
    assert.strictEqual(saved.outcome instanceof Object, true);
    assert.strictEqual(JSON.stringify(source), before);
  }).finally(function () {
    return removeWorkspace(directory);
  });
});

test('reports failing any capture condition are skipped', function () {
  var directory;
  return workspace().then(function (created) {
    directory = created;
    return AutoCapture.captureReports({
      reports: [
        report('BTCUSDT', { opportunityStatus: 'WAITING' }),
        report('ETHUSDT', { h4Bias: 'NEUTRAL' }),
        report('SOLUSDT', { alignmentStatus: 'CONFLICT' }),
      ],
      timestamp: TIMESTAMP,
      casesDirectory: directory,
    });
  }).then(function (result) {
    assert.strictEqual(result.capturedCount, 0);
    assert.strictEqual(result.skippedCount, 3);
    assert.strictEqual(result.failedCount, 0);
    return jsonFiles(directory);
  }).then(function (files) {
    assert.deepStrictEqual(files, []);
  }).finally(function () {
    return removeWorkspace(directory);
  });
});

test('repeated execution does not capture the same daily case', function () {
  var directory;
  var input = report('BTCUSDT', {
    opportunityStatus: 'CONFIRMING',
  });

  return workspace().then(function (created) {
    directory = created;
    return AutoCapture.captureReports({
      reports: [input],
      timestamp: TIMESTAMP,
      casesDirectory: directory,
    });
  }).then(function (first) {
    assert.strictEqual(first.capturedCount, 1);
    return AutoCapture.captureReports({
      reports: [input],
      timestamp: TIMESTAMP + 5 * 60 * 1000,
      casesDirectory: directory,
    });
  }).then(function (second) {
    assert.strictEqual(second.capturedCount, 0);
    assert.strictEqual(second.skippedCount, 1);
    assert.strictEqual(
      second.skipped[0].reason,
      'ALREADY_CAPTURED_TODAY'
    );
    return jsonFiles(directory);
  }).then(function (files) {
    assert.deepStrictEqual(files, [
      '2026-07-31-BTCUSDT.json',
    ]);
  }).finally(function () {
    return removeWorkspace(directory);
  });
});

test('one symbol save failure does not affect other symbols', function () {
  var directory;
  function isolatedRecorder(options) {
    if (options.symbol === 'ETHUSDT') {
      return Promise.reject(new Error('simulated write failure'));
    }
    return Recorder.recordCase(options);
  }

  return workspace().then(function (created) {
    directory = created;
    return AutoCapture.captureReports({
      results: [
        {
          symbol: 'BTCUSDT',
          status: 'SUCCESS',
          report: report('BTCUSDT'),
        },
        {
          symbol: 'ETHUSDT',
          status: 'SUCCESS',
          report: report('ETHUSDT'),
        },
        {
          symbol: 'SOLUSDT',
          status: 'SUCCESS',
          report: report('SOLUSDT'),
        },
      ],
      timestamp: TIMESTAMP,
      casesDirectory: directory,
      recorder: isolatedRecorder,
    });
  }).then(function (result) {
    assert.strictEqual(result.capturedCount, 2);
    assert.strictEqual(result.failedCount, 1);
    assert.strictEqual(result.failed[0].symbol, 'ETHUSDT');
    return jsonFiles(directory);
  }).then(function (files) {
    assert.deepStrictEqual(files, [
      '2026-07-31-BTCUSDT.json',
      '2026-07-31-SOLUSDT.json',
    ]);
  }).finally(function () {
    return removeWorkspace(directory);
  });
});

test('standalone runner passes Watchlist reports to auto capture', function () {
  var received;
  var messages = [];
  var analysis = {
    currentTime: TIMESTAMP,
    results: [{
      symbol: 'BTCUSDT',
      status: 'SUCCESS',
      report: report('BTCUSDT'),
    }],
  };
  return Runner.run({
    watchlistAnalyst: {
      run: function () {
        return Promise.resolve(analysis);
      },
    },
    autoCapture: {
      captureReports: function (options) {
        received = options;
        return Promise.resolve({
          capturedCount: 1,
          skippedCount: 0,
          failedCount: 0,
          results: [{
            symbol: 'BTCUSDT',
            status: 'CAPTURED',
            reason: {
              opportunityStatus: 'WATCH_ZONE',
            },
          }],
        });
      },
    },
    output: function (message) {
      messages.push(message);
    },
  }).then(function (result) {
    assert.strictEqual(received.results, analysis.results);
    assert.strictEqual(received.timestamp, TIMESTAMP);
    assert.strictEqual(result.capturedCount, 1);
    assert.ok(messages[0].indexOf('Captured: 1') >= 0);
  });
});

function runTests(index) {
  if (index >= tests.length) {
    console.log('\n' + testsPassed + ' tests passed.');
    return Promise.resolve();
  }
  return Promise.resolve(tests[index].callback())
    .then(function () {
      testsPassed += 1;
      console.log('PASS:', tests[index].name);
      return runTests(index + 1);
    })
    .catch(function (error) {
      console.error('FAIL:', tests[index].name);
      throw error;
    });
}

runTests(0).catch(function (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
