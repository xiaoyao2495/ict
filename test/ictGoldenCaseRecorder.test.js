'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Recorder = require(
  '../history/ictGoldenCaseRecorder'
);
var SaveGoldenCase = require(
  '../scripts/saveGoldenCase'
);

var TIMESTAMP = Date.UTC(2026, 6, 31, 0, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function completeReport() {
  return {
    symbol: 'BTCUSDT',
    current: {
      fourHourAnalysis: {
        bias: 'BULLISH',
        currentStructure: 'BULLISH',
        premiumDiscount: 'DISCOUNT',
        dailyBias: {
          marketBias: 'BULLISH',
          legacyBias: 'NEUTRAL',
          transitionDirection: null,
          structureState: 'BULLISH_CONFIRMED',
          drawOnLiquidity: 'BELOW',
          htfLocationReadiness: 'READY',
          reasons: ['MARKET_BIAS_FROM_STRUCTURE_BULLISH'],
        },
      },
      structurePhase: {
        state: 'BULLISH_CONFIRMED',
        direction: 'BULLISH',
        context: 'Post bullish MSS',
        sourceEvent: {
          type: 'BULLISH_MSS',
          availableIndex: 10,
        },
        mssEvent: {
          direction: 'BULLISH',
          availableIndex: 10,
        },
        confirmationBos: {
          direction: 'BULLISH',
          availableIndex: 13,
        },
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
        price: 117500,
      },
      decisionGate: {
        state: 'WATCH_ZONE',
        direction: 'BULLISH',
        activeOpportunity: {
          id: 'BULLISH|PDL|117500',
          direction: 'BULLISH',
          liquidityType: 'PDL',
          price: 117500,
        },
        progress: {
          sweepCompleted: false,
          mssCompleted: false,
          displacementCompleted: false,
          strictConfirmationCompleted: false,
        },
        sourceState: {
          h4Bias: 'BULLISH',
          htfAlignment: 'ALIGNED',
          opportunityStatus: 'WATCH_ZONE',
        },
        blockers: ['WAITING_LTF_CONFIRMATION'],
        reasonCode: 'OPPORTUNITY_ACTIVE',
        transition: {
          changed: true,
          from: 'WAITING_OPPORTUNITY',
          to: 'WATCH_ZONE',
          occurredAt: TIMESTAMP,
        },
        informationalOnly: true,
      },
      fiveMinuteObservation: {
        currentConfirmed: {
          confirmation: {
            status: 'CONFIRMED',
            direction: 'BULLISH',
          },
        },
      },
    },
  };
}

function temporaryDirectory() {
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-case-'
  ));
}

function removeDirectory(directory) {
  return fs.rm(directory, { recursive: true, force: true });
}

test('recordCase saves a complete regression case', function () {
  var directory;
  return temporaryDirectory().then(function (created) {
    directory = created;
    return Recorder.recordCase({
      symbol: 'BTCUSDT',
      report: completeReport(),
      timestamp: TIMESTAMP,
      outputDirectory: directory,
    });
  }).then(function (saved) {
    assert.strictEqual(
      path.basename(saved.filePath),
      '2026-07-31-BTCUSDT.json'
    );
    return fs.readFile(saved.filePath, 'utf8');
  }).then(function (body) {
    var data = JSON.parse(body);
    assert.strictEqual(data.symbol, 'BTCUSDT');
    assert.strictEqual(
      data.createdAt,
      '2026-07-31T00:00:00.000Z'
    );
    assert.deepStrictEqual(data.htfBias, {
      bias: 'BULLISH',
      structure: 'BULLISH',
      premiumDiscount: 'DISCOUNT',
    });
    assert.strictEqual(
      data.structurePhase.confirmationBos.availableIndex,
      13
    );
    assert.strictEqual(data.htfAlignment.status, 'ALIGNED');
    assert.deepStrictEqual(data.opportunity, {
      status: 'WATCH_ZONE',
      direction: 'BULLISH',
      liquidityType: 'PDL',
      liquidityPrice: 117500,
    });
    assert.deepStrictEqual(data.confirmation, {
      status: 'CONFIRMED',
      direction: 'BULLISH',
    });
    assert.deepStrictEqual(
      data.decisionGate,
      Recorder.decisionGateFrom(completeReport().current)
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        data.decisionGate,
        'informationalOnly'
      ),
      false
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        data.snapshot,
        'decisionGate'
      ),
      false
    );
    assert.strictEqual(data.biasSourceVersion, 'daily_bias_v1');
    assert.deepStrictEqual(data.dailyBias, {
      marketBias: 'BULLISH',
      structurePhase: 'BULLISH_CONFIRMED',
      transitionDirection: null,
    });
    assert.deepStrictEqual(data.outcome, {});
  }).finally(function () {
    return removeDirectory(directory);
  });
});

test('recordCase safely fills missing report fields', function () {
  var directory;
  return temporaryDirectory().then(function (created) {
    directory = created;
    return Recorder.recordCase({
      symbol: 'ETHUSDT',
      report: { current: {} },
      timestamp: TIMESTAMP,
      outputDirectory: directory,
    });
  }).then(function (saved) {
    return fs.readFile(saved.filePath, 'utf8');
  }).then(function (body) {
    var data = JSON.parse(body);
    assert.deepStrictEqual(data.htfBias, {
      bias: null,
      structure: null,
      premiumDiscount: null,
    });
    assert.deepStrictEqual(data.structurePhase, {
      state: null,
      direction: null,
      context: null,
      sourceEvent: null,
      mssEvent: null,
      confirmationBos: null,
    });
    assert.deepStrictEqual(data.htfAlignment, {
      status: null,
      biasDirection: null,
      structureDirection: null,
      reason: null,
    });
    assert.deepStrictEqual(data.opportunity, {
      status: null,
      direction: null,
      liquidityType: null,
      liquidityPrice: null,
    });
    assert.deepStrictEqual(data.confirmation, {
      status: null,
      direction: null,
    });
    assert.strictEqual(data.decisionGate, null);
  }).finally(function () {
    return removeDirectory(directory);
  });
});

test('recordCase does not mutate the source report', function () {
  var directory;
  var report = completeReport();
  var before = JSON.stringify(report);
  return temporaryDirectory().then(function (created) {
    directory = created;
    return Recorder.recordCase({
      symbol: 'BTCUSDT',
      report: report,
      timestamp: TIMESTAMP,
      outputDirectory: directory,
    });
  }).then(function () {
    assert.strictEqual(JSON.stringify(report), before);
  }).finally(function () {
    return removeDirectory(directory);
  });
});

test('Decision Gate is a deep copied creation-time snapshot', function () {
  var report = completeReport();
  var caseData = Recorder.buildCase({
    symbol: 'BTCUSDT',
    report: report,
    timestamp: TIMESTAMP,
  });
  var before = JSON.stringify(caseData.decisionGate);

  report.current.decisionGate.state = 'INVALIDATED';
  report.current.decisionGate.activeOpportunity.price = 1;
  report.current.decisionGate.progress.sweepCompleted = true;
  report.current.decisionGate.blockers.push('FUTURE_BLOCKER');
  report.current.decisionGate.transition.to = 'INVALIDATED';

  assert.strictEqual(JSON.stringify(caseData.decisionGate), before);
  assert.strictEqual(caseData.decisionGate.state, 'WATCH_ZONE');
  assert.strictEqual(
    caseData.decisionGate.activeOpportunity.price,
    117500
  );
  assert.strictEqual(
    caseData.decisionGate.progress.sweepCompleted,
    false
  );
});

test('same-day symbol cases never overwrite an old file', function () {
  var directory;
  var first;
  return temporaryDirectory().then(function (created) {
    directory = created;
    return Recorder.recordCase({
      symbol: 'BTCUSDT',
      report: completeReport(),
      timestamp: TIMESTAMP,
      outputDirectory: directory,
    });
  }).then(function (saved) {
    first = saved;
    return Recorder.recordCase({
      symbol: 'BTCUSDT',
      report: completeReport(),
      timestamp: TIMESTAMP + 300000,
      outputDirectory: directory,
    });
  }).then(function (second) {
    assert.notStrictEqual(second.filePath, first.filePath);
    assert.strictEqual(
      path.basename(first.filePath),
      '2026-07-31-BTCUSDT.json'
    );
    assert.ok(
      /^2026-07-31-BTCUSDT-080500000(?:-\d+)?\.json$/
        .test(path.basename(second.filePath))
    );
    return Promise.all([
      fs.readFile(first.filePath, 'utf8'),
      fs.readFile(second.filePath, 'utf8'),
    ]);
  }).then(function (bodies) {
    assert.strictEqual(
      JSON.parse(bodies[0]).createdAt,
      '2026-07-31T00:00:00.000Z'
    );
    assert.strictEqual(
      JSON.parse(bodies[1]).createdAt,
      '2026-07-31T00:05:00.000Z'
    );
  }).finally(function () {
    return removeDirectory(directory);
  });
});

test('saveGoldenCase selects the requested latest watchlist report', function () {
  var directory;
  var messages = [];
  var btcReport = completeReport();
  var runner = {
    run: function () {
      return Promise.resolve({
        currentTime: TIMESTAMP,
        results: [
          {
            symbol: 'ETHUSDT',
            status: 'SUCCESS',
            report: { symbol: 'ETHUSDT', current: {} },
          },
          {
            symbol: 'BTCUSDT',
            status: 'SUCCESS',
            report: btcReport,
          },
        ],
      });
    },
  };

  return temporaryDirectory().then(function (created) {
    directory = created;
    return SaveGoldenCase.saveGoldenCase('btcusdt', {
      watchlistAnalyst: runner,
      outputDirectory: directory,
      output: function (message) {
        messages.push(message);
      },
    });
  }).then(function (saved) {
    assert.strictEqual(saved.symbol, 'BTCUSDT');
    assert.strictEqual(messages.length, 1);
    assert.ok(messages[0].indexOf('Golden Case Saved:') >= 0);
    assert.ok(messages[0].indexOf('BTCUSDT') >= 0);
    assert.ok(messages[0].indexOf(
      '2026-07-31-BTCUSDT.json'
    ) >= 0);
  }).finally(function () {
    return removeDirectory(directory);
  });
});

test('legacy report without dailyBias records htf_bias_v3 source', function () {
  var report = completeReport();
  delete report.current.fourHourAnalysis.dailyBias;
  var caseData = Recorder.buildCase({
    symbol: 'BTCUSDT',
    report: report,
    timestamp: TIMESTAMP,
  });
  assert.strictEqual(caseData.biasSourceVersion, 'htf_bias_v3');
  assert.deepStrictEqual(caseData.dailyBias, {
    marketBias: null,
    structurePhase: null,
    transitionDirection: null,
  });
});

test('normalizeCase defaults missing biasSourceVersion to htf_bias_v3', function () {
  var legacy = Recorder.normalizeCase({
    symbol: 'BTCUSDT',
    createdAt: '2026-07-30T00:00:00.000Z',
  });
  assert.strictEqual(legacy.biasSourceVersion, 'htf_bias_v3');
  assert.strictEqual(legacy.symbol, 'BTCUSDT');
});

test('readCase keeps legacy files unmodified', function () {
  var directory;
  var casePath;
  var legacyBody = JSON.stringify({
    symbol: 'BTCUSDT',
    createdAt: '2026-07-30T00:00:00.000Z',
    htfBias: { bias: 'BULLISH' },
    outcome: {},
  }, null, 2) + '\n';
  return temporaryDirectory().then(function (created) {
    directory = created;
    casePath = path.join(directory, 'legacy.json');
    return fs.writeFile(casePath, legacyBody, 'utf8');
  }).then(function () {
    return Recorder.readCase(casePath);
  }).then(function (normalized) {
    assert.strictEqual(
      normalized.biasSourceVersion,
      'htf_bias_v3'
    );
    return fs.readFile(casePath, 'utf8');
  }).then(function (body) {
    assert.strictEqual(body, legacyBody);
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
