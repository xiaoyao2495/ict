'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Linker = require(
  '../history/ictGoldenCaseOutcomeLinker'
);

var BASE_TIME = Date.UTC(2026, 6, 31, 0, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function iso(offsetMs) {
  return new Date(BASE_TIME + (offsetMs || 0)).toISOString();
}

function goldenCase(symbol, offsetMs) {
  return {
    symbol: symbol,
    createdAt: iso(offsetMs),
    htfBias: {
      bias: 'BULLISH',
      structure: 'BULLISH',
      premiumDiscount: 'DISCOUNT',
    },
    structurePhase: {
      state: 'BULLISH_CONFIRMED',
      direction: 'BULLISH',
      context: 'context retained',
      sourceEvent: { type: 'BULLISH_MSS' },
      mssEvent: { direction: 'BULLISH' },
      confirmationBos: { direction: 'BULLISH' },
    },
    htfAlignment: {
      status: 'ALIGNED',
      biasDirection: 'BULLISH',
      structureDirection: 'BULLISH',
      reason: 'retained reason',
    },
    opportunity: {
      status: 'CONFIRMED',
      direction: 'BULLISH',
      liquidityType: 'PDL',
      liquidityPrice: 99,
    },
    confirmation: {
      status: 'CONFIRMED',
      direction: 'BULLISH',
    },
    outcome: {},
  };
}

function outcome(symbol, offsetMs, options) {
  options = options || {};
  var has = Object.prototype.hasOwnProperty;
  return {
    id: symbol + '|' + iso(offsetMs),
    symbol: symbol,
    confirmedAt: iso(offsetMs),
    direction: options.direction || 'BULLISH',
    trackingStatus: options.trackingStatus || 'COMPLETED',
    oneRAt: has.call(options, 'oneRAt')
      ? options.oneRAt
      : iso(offsetMs + 300000),
    twoRAt: has.call(options, 'twoRAt')
      ? options.twoRAt
      : iso(offsetMs + 600000),
    threeRAt: has.call(options, 'threeRAt')
      ? options.threeRAt
      : iso(offsetMs + 900000),
    failed: options.failed === true,
    failedAt: options.failedAt || null,
    lastEvaluatedAt: iso(offsetMs + 900000),
  };
}

function createWorkspace() {
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-linker-'
  )).then(function (root) {
    var casesDirectory = path.join(root, 'cases');
    return fs.mkdir(casesDirectory, { recursive: true })
      .then(function () {
        return {
          root: root,
          casesDirectory: casesDirectory,
          outcomeFilePath: path.join(root, 'outcomes.json'),
        };
      });
  });
}

function removeWorkspace(workspace) {
  if (!workspace) return Promise.resolve();
  return fs.rm(workspace.root, {
    recursive: true,
    force: true,
  });
}

function writeJson(filePath, value) {
  return fs.writeFile(
    filePath,
    JSON.stringify(value, null, 2) + '\n',
    'utf8'
  );
}

function writeCase(workspace, fileName, value) {
  return writeJson(
    path.join(workspace.casesDirectory, fileName),
    value
  );
}

function readCase(workspace, fileName) {
  return fs.readFile(
    path.join(workspace.casesDirectory, fileName),
    'utf8'
  ).then(function (content) {
    return JSON.parse(content);
  });
}

test('matches a nearby confirmed outcome and preserves the case', function () {
  var workspace;
  var fileName = '2026-07-31-BTCUSDT.json';
  var caseData = goldenCase('BTCUSDT', 6 * 60 * 1000);
  var tracked = outcome('BTCUSDT', 5 * 60 * 1000);
  var trackerState = { version: 1, outcomes: [tracked] };
  var trackerBefore = JSON.stringify(trackerState);

  return createWorkspace().then(function (created) {
    workspace = created;
    return Promise.all([
      writeCase(workspace, fileName, caseData),
      writeJson(workspace.outcomeFilePath, trackerState),
    ]);
  }).then(function () {
    return Linker.updateGoldenCaseOutcomes({
      casesDirectory: workspace.casesDirectory,
      outcomeFilePath: workspace.outcomeFilePath,
    });
  }).then(function (result) {
    assert.strictEqual(result.casesScanned, 1);
    assert.strictEqual(result.matchedCases, 1);
    assert.strictEqual(result.updatedCases, 1);
    return Promise.all([
      readCase(workspace, fileName),
      fs.readFile(workspace.outcomeFilePath, 'utf8'),
    ]);
  }).then(function (loaded) {
    var updatedCase = loaded[0];
    var outcomeStateAfter = JSON.parse(loaded[1]);
    assert.deepStrictEqual(updatedCase.outcome, {
      trackingStatus: 'COMPLETED',
      oneRAt: iso(10 * 60 * 1000),
      twoRAt: iso(15 * 60 * 1000),
      threeRAt: iso(20 * 60 * 1000),
      failed: false,
      failedAt: null,
      completedAt: iso(20 * 60 * 1000),
    });
    assert.deepStrictEqual(updatedCase.htfBias, caseData.htfBias);
    assert.deepStrictEqual(
      updatedCase.structurePhase,
      caseData.structurePhase
    );
    assert.strictEqual(
      JSON.stringify(outcomeStateAfter),
      trackerBefore
    );
  }).finally(function () {
    return removeWorkspace(workspace);
  });
});

test('an unmatched case remains empty and is not rewritten', function () {
  var workspace;
  var fileName = '2026-07-31-BTCUSDT.json';
  var caseData = goldenCase('BTCUSDT', 0);
  var originalBody = JSON.stringify(caseData, null, 2) + '\n';

  return createWorkspace().then(function (created) {
    workspace = created;
    return Promise.all([
      fs.writeFile(
        path.join(workspace.casesDirectory, fileName),
        originalBody,
        'utf8'
      ),
      writeJson(workspace.outcomeFilePath, {
        version: 1,
        outcomes: [
          outcome('ETHUSDT', 0),
          outcome('BTCUSDT', 24 * 60 * 60 * 1000),
        ],
      }),
    ]);
  }).then(function () {
    return Linker.updateGoldenCaseOutcomes({
      casesDirectory: workspace.casesDirectory,
      outcomeFilePath: workspace.outcomeFilePath,
    });
  }).then(function (result) {
    assert.strictEqual(result.matchedCases, 0);
    assert.strictEqual(result.updatedCases, 0);
    assert.deepStrictEqual(result.updatedFiles, []);
    return fs.readFile(
      path.join(workspace.casesDirectory, fileName),
      'utf8'
    );
  }).then(function (body) {
    assert.strictEqual(body, originalBody);
    assert.deepStrictEqual(JSON.parse(body).outcome, {});
  }).finally(function () {
    return removeWorkspace(workspace);
  });
});

test('multiple cases link only to their nearest symbol outcome', function () {
  var workspace;
  var btcFile = '2026-07-31-BTCUSDT.json';
  var ethFile = '2026-07-31-ETHUSDT.json';
  var solFile = '2026-07-31-SOLUSDT.json';
  var btcOutcome = outcome('BTCUSDT', 5 * 60 * 1000);
  var ethOutcome = outcome('ETHUSDT', 35 * 60 * 1000, {
    direction: 'BEARISH',
    trackingStatus: 'FAILED',
    oneRAt: null,
    twoRAt: null,
    threeRAt: null,
    failed: true,
    failedAt: iso(40 * 60 * 1000),
  });

  return createWorkspace().then(function (created) {
    workspace = created;
    return Promise.all([
      writeCase(
        workspace,
        btcFile,
        goldenCase('BTCUSDT', 6 * 60 * 1000)
      ),
      writeCase(
        workspace,
        ethFile,
        goldenCase('ETHUSDT', 34 * 60 * 1000)
      ),
      writeCase(
        workspace,
        solFile,
        goldenCase('SOLUSDT', 34 * 60 * 1000)
      ),
      writeJson(workspace.outcomeFilePath, {
        version: 1,
        outcomes: [btcOutcome, ethOutcome],
      }),
    ]);
  }).then(function () {
    return Linker.updateGoldenCaseOutcomes({
      casesDirectory: workspace.casesDirectory,
      outcomeFilePath: workspace.outcomeFilePath,
    });
  }).then(function (result) {
    assert.strictEqual(result.casesScanned, 3);
    assert.strictEqual(result.matchedCases, 2);
    assert.strictEqual(result.updatedCases, 2);
    return Promise.all([
      readCase(workspace, btcFile),
      readCase(workspace, ethFile),
      readCase(workspace, solFile),
    ]);
  }).then(function (cases) {
    assert.strictEqual(
      cases[0].outcome.trackingStatus,
      'COMPLETED'
    );
    assert.deepStrictEqual(cases[1].outcome, {
      trackingStatus: 'FAILED',
      oneRAt: null,
      twoRAt: null,
      threeRAt: null,
      failed: true,
      failedAt: iso(40 * 60 * 1000),
      completedAt: iso(40 * 60 * 1000),
    });
    assert.deepStrictEqual(cases[2].outcome, {});
  }).finally(function () {
    return removeWorkspace(workspace);
  });
});

test('repeated execution is idempotent and performs no second update', function () {
  var workspace;
  var fileName = '2026-07-31-BTCUSDT.json';
  var firstBody;

  return createWorkspace().then(function (created) {
    workspace = created;
    return Promise.all([
      writeCase(
        workspace,
        fileName,
        goldenCase('BTCUSDT', 6 * 60 * 1000)
      ),
      writeJson(workspace.outcomeFilePath, {
        version: 1,
        outcomes: [outcome('BTCUSDT', 5 * 60 * 1000)],
      }),
    ]);
  }).then(function () {
    return Linker.updateGoldenCaseOutcomes({
      casesDirectory: workspace.casesDirectory,
      outcomeFilePath: workspace.outcomeFilePath,
    });
  }).then(function (first) {
    assert.strictEqual(first.updatedCases, 1);
    return fs.readFile(
      path.join(workspace.casesDirectory, fileName),
      'utf8'
    );
  }).then(function (body) {
    firstBody = body;
    return Linker.updateGoldenCaseOutcomes({
      casesDirectory: workspace.casesDirectory,
      outcomeFilePath: workspace.outcomeFilePath,
    });
  }).then(function (second) {
    assert.strictEqual(second.matchedCases, 1);
    assert.strictEqual(second.updatedCases, 0);
    assert.strictEqual(second.changed, false);
    assert.deepStrictEqual(second.updatedFiles, []);
    return fs.readFile(
      path.join(workspace.casesDirectory, fileName),
      'utf8'
    );
  }).then(function (secondBody) {
    assert.strictEqual(secondBody, firstBody);
  }).finally(function () {
    return removeWorkspace(workspace);
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
