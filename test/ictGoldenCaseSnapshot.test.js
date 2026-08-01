'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Recorder = require(
  '../history/ictGoldenCaseRecorder'
);

var TIMESTAMP = Date.UTC(2026, 6, 31, 0, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function analystReport() {
  return {
    protocol: {
      version: 'ICT_WATCHLIST_ANALYST_REPORT_H4_5M_V1',
    },
    symbol: 'BTCUSDT',
    current: {
      asOf: TIMESTAMP,
      price: 118250.5,
      fourHourAnalysis: {
        bias: 'BULLISH',
        currentStructure: 'BULLISH',
        premiumDiscount: 'DISCOUNT',
        externalLiquidity: {
          buySideLiquidity: [{
            type: 'PDH',
            price: 119000,
          }],
          sellSideLiquidity: [],
        },
      },
      structurePhase: {
        state: 'BULLISH_CONFIRMED',
        direction: 'BULLISH',
        context: 'Post bullish MSS',
        sourceEvent: { type: 'BULLISH_MSS' },
        mssEvent: { direction: 'BULLISH' },
        confirmationBos: { direction: 'BULLISH' },
      },
      htfAlignment: {
        status: 'ALIGNED',
        biasDirection: 'BULLISH',
        structureDirection: 'BULLISH',
        reason: 'Bias and structure agree.',
      },
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 118000,
      },
      fiveMinuteObservation: {
        currentConfirmed: {
          confirmation: {
            status: 'CONFIRMED',
            direction: 'BULLISH',
            availableIndex: 42,
          },
        },
      },
      liquidityRoadmap: [{
        type: 'PDL',
        side: 'SELL_SIDE',
        price: 118000,
        distanceValue: 250.5,
      }],
    },
  };
}

function temporaryDirectory() {
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-snapshot-'
  ));
}

function removeDirectory(directory) {
  if (!directory) return Promise.resolve();
  return fs.rm(directory, { recursive: true, force: true });
}

test('saved Golden Case contains snapshot version and snapshot', function () {
  var directory;
  return temporaryDirectory().then(function (created) {
    directory = created;
    return Recorder.recordCase({
      symbol: 'BTCUSDT',
      report: analystReport(),
      timestamp: TIMESTAMP,
      outputDirectory: directory,
    });
  }).then(function (saved) {
    return Recorder.readCase(saved.filePath);
  }).then(function (caseData) {
    assert.strictEqual(caseData.snapshotVersion, '1');
    assert.ok(caseData.snapshot);
    assert.strictEqual(caseData.snapshot.symbol, 'BTCUSDT');
    assert.strictEqual(
      caseData.snapshot.capturedAt,
      '2026-07-31T00:00:00.000Z'
    );
  }).finally(function () {
    return removeDirectory(directory);
  });
});

test('snapshot fields equal the Analyst Report at capture time', function () {
  var report = analystReport();
  var caseData = Recorder.buildCase({
    symbol: 'BTCUSDT',
    report: report,
    timestamp: TIMESTAMP,
  });
  assert.deepStrictEqual(caseData.snapshot, {
    capturedAt: '2026-07-31T00:00:00.000Z',
    symbol: 'BTCUSDT',
    price: 118250.5,
    h4Bias: report.current.fourHourAnalysis,
    structurePhase: report.current.structurePhase,
    htfAlignment: report.current.htfAlignment,
    opportunity: report.current.opportunity,
    confirmation: report.current.fiveMinuteObservation
      .currentConfirmed.confirmation,
    liquidity: report.current.liquidityRoadmap,
    reportVersion:
      'ICT_WATCHLIST_ANALYST_REPORT_H4_5M_V1',
  });
});

test('mutating the source report cannot change the snapshot', function () {
  var report = analystReport();
  var caseData = Recorder.buildCase({
    symbol: 'BTCUSDT',
    report: report,
    timestamp: TIMESTAMP,
  });
  var before = JSON.stringify(caseData.snapshot);

  report.current.price = 1;
  report.current.fourHourAnalysis.bias = 'BEARISH';
  report.current.structurePhase.state = 'BEARISH_CONFIRMED';
  report.current.htfAlignment.status = 'CONFLICT';
  report.current.opportunity.status = 'WAITING';
  report.current.fiveMinuteObservation
    .currentConfirmed.confirmation.direction = 'BEARISH';
  report.current.liquidityRoadmap[0].price = 1;
  report.protocol.version = 'FUTURE_VERSION';

  assert.strictEqual(JSON.stringify(caseData.snapshot), before);
  assert.strictEqual(caseData.snapshot.h4Bias.bias, 'BULLISH');
  assert.strictEqual(caseData.snapshot.liquidity[0].price, 118000);
});

test('legacy Golden Case without snapshot reads snapshot as null', function () {
  var directory;
  var filePath;
  var legacy = {
    symbol: 'ETHUSDT',
    createdAt: '2026-07-30T00:00:00.000Z',
    htfBias: { bias: 'BEARISH' },
    outcome: {},
  };

  return temporaryDirectory().then(function (created) {
    directory = created;
    filePath = path.join(directory, 'legacy.json');
    return fs.writeFile(
      filePath,
      JSON.stringify(legacy, null, 2) + '\n',
      'utf8'
    );
  }).then(function () {
    return Recorder.readCase(filePath);
  }).then(function (loaded) {
    assert.strictEqual(loaded.snapshot, null);
    assert.strictEqual(loaded.snapshotVersion, null);
    assert.strictEqual(loaded.decisionGate, null);
    assert.strictEqual(loaded.symbol, 'ETHUSDT');
    assert.deepStrictEqual(loaded.htfBias, { bias: 'BEARISH' });
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(legacy, 'snapshot'),
      false
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        legacy,
        'decisionGate'
      ),
      false
    );
  }).finally(function () {
    return removeDirectory(directory);
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
