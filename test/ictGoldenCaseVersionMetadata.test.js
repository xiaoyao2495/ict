'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Recorder = require(
  '../history/ictGoldenCaseRecorder'
);

var TIMESTAMP = Date.UTC(2026, 6, 31, 0, 0, 0);
var EXPECTED_VERSION = {
  bias: 'V3',
  structurePhase: 'V1',
  alignment: 'V1',
  opportunity: 'V1',
  confirmation: 'V1',
};
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function report() {
  return {
    protocol: { version: 'ANALYST_REPORT_V1' },
    symbol: 'BTCUSDT',
    current: {
      price: 100,
      fourHourAnalysis: {
        bias: 'BULLISH',
        currentStructure: 'BULLISH',
        premiumDiscount: 'DISCOUNT',
        externalLiquidity: {
          buySideLiquidity: [],
          sellSideLiquidity: [],
        },
      },
      structurePhase: {
        state: 'BULLISH_CONFIRMED',
        direction: 'BULLISH',
      },
      htfAlignment: {
        status: 'ALIGNED',
        biasDirection: 'BULLISH',
        structureDirection: 'BULLISH',
      },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        liquidityPrice: 99,
      },
      fiveMinuteObservation: {
        currentConfirmed: {
          confirmation: {
            status: 'WAITING',
            direction: null,
          },
        },
      },
      liquidityRoadmap: [{
        type: 'PDL',
        side: 'SELL_SIDE',
        price: 99,
        distanceValue: 1,
      }],
    },
  };
}

function temporaryDirectory() {
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-version-'
  ));
}

function removeDirectory(directory) {
  if (!directory) return Promise.resolve();
  return fs.rm(directory, { recursive: true, force: true });
}

test('new Golden Case contains fixed analysis versions', function () {
  var directory;
  return temporaryDirectory().then(function (created) {
    directory = created;
    return Recorder.recordCase({
      symbol: 'BTCUSDT',
      report: report(),
      timestamp: TIMESTAMP,
      outputDirectory: directory,
    });
  }).then(function (saved) {
    return Recorder.readCase(saved.filePath);
  }).then(function (caseData) {
    assert.deepStrictEqual(
      caseData.analysisVersion,
      EXPECTED_VERSION
    );
    assert.deepStrictEqual(
      Recorder.ANALYSIS_VERSION,
      EXPECTED_VERSION
    );
  }).finally(function () {
    return removeDirectory(directory);
  });
});

test('legacy Golden Case without versions reads null safely', function () {
  var legacy = {
    symbol: 'ETHUSDT',
    createdAt: '2026-07-30T00:00:00.000Z',
    snapshot: null,
    outcome: {},
    review: null,
  };
  var before = JSON.stringify(legacy);
  var normalized = Recorder.normalizeCase(legacy);
  assert.strictEqual(normalized.analysisVersion, null);
  assert.strictEqual(JSON.stringify(legacy), before);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      legacy,
      'analysisVersion'
    ),
    false
  );
});

test('analysis metadata leaves snapshot outcome and review unchanged', function () {
  var source = report();
  var caseData = Recorder.buildCase({
    symbol: 'BTCUSDT',
    report: source,
    timestamp: TIMESTAMP,
  });
  assert.deepStrictEqual(caseData.analysisVersion, EXPECTED_VERSION);
  assert.deepStrictEqual(caseData.snapshot, {
    capturedAt: '2026-07-31T00:00:00.000Z',
    symbol: 'BTCUSDT',
    price: 100,
    h4Bias: source.current.fourHourAnalysis,
    structurePhase: source.current.structurePhase,
    htfAlignment: source.current.htfAlignment,
    opportunity: source.current.opportunity,
    confirmation: source.current.fiveMinuteObservation
      .currentConfirmed.confirmation,
    liquidity: source.current.liquidityRoadmap,
    reportVersion: 'ANALYST_REPORT_V1',
  });
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      caseData.snapshot,
      'analysisVersion'
    ),
    false
  );
  assert.deepStrictEqual(caseData.outcome, {});
  assert.strictEqual(caseData.review, null);
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
