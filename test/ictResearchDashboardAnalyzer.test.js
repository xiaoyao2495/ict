'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Analyzer = require(
  '../history/ictResearchDashboardAnalyzer'
);
var Formatter = require(
  '../formatters/ictResearchDashboardFormatter'
);
var Generator = require(
  '../scripts/generateIctResearchDashboard'
);

var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function moduleInputs() {
  return {
    goldenCaseStatistics: {
      totalCases: 6,
      outcomeStatus: {
        COMPLETED: 2,
        FAILED: 1,
        TRACKING: 2,
        EMPTY: 1,
      },
      topCombinations: [],
    },
    goldenCaseResearch: {
      overview: {
        totalCases: 6,
        completedCount: 2,
        failedCount: 1,
      },
      bestConditions: [
        {
          h4Bias: 'BEARISH',
          structurePhase: 'BEARISH_CONFIRMED',
          htfAlignment: 'ALIGNED',
          liquidityType: 'EQUAL_HIGH',
          opportunityDirection: 'BEARISH',
          sampleCount: 12,
          completedCount: 9,
          failedCount: 2,
          completionRate: 0.75,
          failureRate: 2 / 12,
        },
        {
          h4Bias: 'BULLISH',
          structurePhase: 'BULLISH_CONFIRMED',
          htfAlignment: 'ALIGNED',
          liquidityType: 'EQUAL_LOW',
          opportunityDirection: 'BULLISH',
          sampleCount: 10,
          completedCount: 9,
          failedCount: 1,
          completionRate: 0.9,
          failureRate: 0.1,
        },
      ],
    },
    lifecycleResearch: {
      totalOpportunities: 8,
      overview: {
        totalOpportunities: 8,
        watchZoneCount: 8,
        confirmingCount: 5,
        readyCount: 3,
        invalidatedCount: 1,
        watchToConfirmingCount: 5,
        confirmingToReadyCount: 3,
        completedOutcomeCount: 2,
      },
      transitionCounts: {
        waitingOpportunityToWatchZone: 8,
        watchZoneToConfirming: 5,
        confirmingToReadyObservation: 3,
        readyObservationToInvalidated: 1,
      },
      conversionRates: {
        watchZoneToConfirming: {
          eligibleCount: 8,
          convertedCount: 5,
          rate: 5 / 8,
        },
        confirmingToReady: {
          eligibleCount: 5,
          convertedCount: 3,
          rate: 3 / 5,
        },
        readyToCompletedOutcome: {
          eligibleCount: 3,
          convertedCount: 2,
          rate: 2 / 3,
        },
      },
    },
    reviewFeedback: {
      coverage: {
        totalCases: 6,
        reviewedCases: 4,
        unreviewedCases: 2,
      },
      outcomeCorrelation: {
        threshold: 4,
        highScore: {
          sampleCount: 2,
          completedCount: 2,
          failedCount: 0,
          completionRate: 1,
          failureRate: 0,
        },
        lowScore: {
          sampleCount: 2,
          completedCount: 0,
          failedCount: 1,
          completionRate: 0,
          failureRate: 0.5,
        },
      },
      outcomeAverageScore: {
        completed: { sampleCount: 2, averageScore: 4.5 },
        failed: { sampleCount: 1, averageScore: 2.5 },
      },
    },
  };
}

test('empty data produces a safe zero dashboard', function () {
  var dashboard = Analyzer.analyze({});
  var text = Formatter.format(dashboard);
  assert.strictEqual(dashboard.totalCases, 0);
  assert.strictEqual(dashboard.totalOpportunities, 0);
  assert.deepStrictEqual(dashboard.lifecycleFunnel, {
    WATCH_ZONE: 0,
    CONFIRMING: 0,
    READY_OBSERVATION: 0,
    OUTCOME: 0,
  });
  assert.strictEqual(dashboard.missingReports.length, 4);
  assert.ok(text.indexOf('总案例数量：0') >= 0);
  assert.ok(text.indexOf('暂无满足条件的组合') >= 0);
});

test('multiple module inputs build one unified dashboard', function () {
  var input = moduleInputs();
  var before = JSON.stringify(input);
  var dashboard = Analyzer.analyze(input);
  assert.strictEqual(dashboard.totalCases, 6);
  assert.strictEqual(dashboard.totalOpportunities, 8);
  assert.deepStrictEqual(dashboard.missingReports, []);
  assert.strictEqual(dashboard.bestCombinations.length, 2);
  assert.strictEqual(
    dashboard.bestCombinations[0].h4Bias,
    'BULLISH'
  );
  assert.strictEqual(dashboard.bestCombinations[0].rank, 1);
  assert.strictEqual(
    dashboard.bestCombinations[0].direction,
    'BULLISH'
  );
  assert.strictEqual(JSON.stringify(input), before);
});

test('missing reports do not block available statistics', function () {
  var dashboard = Analyzer.analyze({
    goldenCaseStatistics: {
      totalCases: 3,
      outcomeStatus: { FAILED: 1 },
      topCombinations: [],
    },
  });
  assert.strictEqual(dashboard.totalCases, 3);
  assert.deepStrictEqual(dashboard.missingReports, [
    'goldenCaseResearch',
    'lifecycleResearch',
    'reviewFeedback',
  ]);
  assert.strictEqual(dashboard.failureStages.failedOutcomes, 1);
  assert.strictEqual(dashboard.lifecycleFunnel.WATCH_ZONE, 0);
});

test('lifecycle funnel and stage conversion statistics are preserved', function () {
  var dashboard = Analyzer.analyze(moduleInputs());
  assert.deepStrictEqual(dashboard.lifecycleFunnel, {
    WATCH_ZONE: 8,
    CONFIRMING: 5,
    READY_OBSERVATION: 3,
    OUTCOME: 2,
  });
  assert.strictEqual(
    dashboard.conversionRates.watchZoneToConfirming.rate,
    5 / 8
  );
  assert.strictEqual(
    dashboard.conversionRates.confirmingToReady.rate,
    3 / 5
  );
  assert.strictEqual(
    dashboard.conversionRates.readyToOutcome.rate,
    2 / 3
  );
  assert.deepStrictEqual({
    watch: dashboard.failureStages.watchZoneNotConfirming,
    confirming: dashboard.failureStages.confirmingNotReady,
    ready: dashboard.failureStages.readyInvalidated,
    outcome: dashboard.failureStages.failedOutcomes,
  }, {
    watch: 3,
    confirming: 2,
    ready: 1,
    outcome: 1,
  });
});

test('Review Score and Outcome relationship remains compatible', function () {
  var dashboard = Analyzer.analyze({
    reviewFeedback: {
      coverage: { totalCases: 4, reviewedCases: 2 },
      outcomeCorrelation: {
        highScore: {
          sampleCount: 1,
          completionRate: 1,
        },
      },
      outcomeAverageScore: {
        completed: { sampleCount: 1, averageScore: 4.8 },
      },
    },
  });
  var text = Formatter.format(dashboard);
  assert.strictEqual(dashboard.reviewOutcome.coverage.totalCases, 4);
  assert.strictEqual(
    dashboard.reviewOutcome.highScore.completionRate,
    1
  );
  assert.strictEqual(
    dashboard.reviewOutcome.lowScore.sampleCount,
    0
  );
  assert.strictEqual(
    dashboard.reviewOutcome.failed.averageScore,
    null
  );
  assert.ok(text.indexOf('COMPLETED 平均评分：4.80') >= 0);
  assert.ok(text.indexOf('FAILED 平均评分：暂无') >= 0);
});

test('formatter includes every required dashboard section', function () {
  var text = Formatter.format(Analyzer.analyze(moduleInputs()));
  assert.ok(text.indexOf('ICT Research Dashboard V2') >= 0);
  assert.ok(text.indexOf('2. Lifecycle Funnel') >= 0);
  assert.ok(text.indexOf('3. 阶段转化率') >= 0);
  assert.ok(text.indexOf('4. 最佳组合排名') >= 0);
  assert.ok(text.indexOf('5. 失败阶段统计') >= 0);
  assert.ok(text.indexOf('6. Review Score 与 Outcome') >= 0);
  assert.ok(text.indexOf(
    'WATCH_ZONE → CONFIRMING：5/8（62.50%）'
  ) >= 0);
});

test('generator accepts existing module outputs and writes dashboard', function () {
  var root;
  var outputPath;
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-research-dashboard-'
  )).then(function (created) {
    root = created;
    outputPath = path.join(root, 'dashboard.txt');
    return Generator.generateIctResearchDashboard({
      inputs: moduleInputs(),
      outputPath: outputPath,
    });
  }).then(function (result) {
    assert.strictEqual(result.dashboard.totalCases, 6);
    assert.strictEqual(result.outputPath, outputPath);
    return fs.readFile(outputPath, 'utf8');
  }).then(function (text) {
    assert.ok(text.indexOf('总案例数量：6') >= 0);
    assert.ok(text.indexOf('Outcome：2') >= 0);
  }).finally(function () {
    if (!root) return Promise.resolve();
    return fs.rm(root, { recursive: true, force: true });
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
