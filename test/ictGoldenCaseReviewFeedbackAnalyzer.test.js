'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var Analyzer = require(
  '../history/ictGoldenCaseReviewFeedbackAnalyzer'
);
var Formatter = require(
  '../formatters/ictGoldenCaseReviewFeedbackFormatter'
);
var Generator = require(
  '../scripts/generateGoldenCaseReviewFeedback'
);

var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function outcome(status) {
  if (status === 'COMPLETED') {
    return { trackingStatus: 'COMPLETED', threeRAt: 'done' };
  }
  if (status === 'FAILED') {
    return { trackingStatus: 'FAILED', failed: true };
  }
  if (status === 'TRACKING') {
    return { trackingStatus: 'TRACKING', failed: false };
  }
  return {};
}

function goldenCase(options) {
  options = options || {};
  var item = {
    symbol: options.symbol || 'BTCUSDT',
    outcome: outcome(options.outcomeStatus || 'EMPTY'),
  };
  if (options.scores) {
    item.review = {
      reviewedAt: '2026-07-31T00:00:00.000Z',
      reviewer: 'reviewer',
      score: options.scores,
      notes: 'notes',
    };
  }
  return item;
}

function scores(value, overrides) {
  var result = {
    htfClarity: value,
    structureClarity: value,
    liquidityQuality: value,
    alignmentQuality: value,
    executionQuality: value,
  };
  var key;
  overrides = overrides || {};
  for (key in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      result[key] = overrides[key];
    }
  }
  return result;
}

test('empty input returns the required safe output', function () {
  var input = [];
  var before = JSON.stringify(input);
  var feedback = Analyzer.analyze(input);
  assert.deepStrictEqual(feedback.coverage, {
    totalCases: 0,
    reviewedCases: 0,
    unreviewedCases: 0,
  });
  assert.strictEqual(
    Formatter.format(feedback),
    '暂无Review Feedback数据\n'
  );
  assert.strictEqual(JSON.stringify(input), before);
});

test('review coverage and dimension samples use rated cases', function () {
  var input = [
    goldenCase({ scores: scores(4) }),
    goldenCase({ symbol: 'ETHUSDT' }),
    goldenCase({
      symbol: 'SOLUSDT',
      scores: scores(null, { htfClarity: 5 }),
    }),
  ];
  var before = JSON.stringify(input);
  var feedback = Analyzer.analyze(input);
  assert.deepStrictEqual(feedback.coverage, {
    totalCases: 3,
    reviewedCases: 2,
    unreviewedCases: 1,
  });
  assert.deepStrictEqual(feedback.dimensions.htfClarity, {
    averageScore: 4.5,
    sampleCount: 2,
  });
  assert.deepStrictEqual(
    feedback.dimensions.structureClarity,
    { averageScore: 4, sampleCount: 1 }
  );
  assert.strictEqual(JSON.stringify(input), before);
});

test('high and low score cohorts correlate with outcomes', function () {
  var feedback = Analyzer.analyze([
    goldenCase({
      scores: scores(5),
      outcomeStatus: 'COMPLETED',
    }),
    goldenCase({
      scores: scores(4),
      outcomeStatus: 'TRACKING',
    }),
    goldenCase({
      scores: scores(3),
      outcomeStatus: 'FAILED',
    }),
    goldenCase({
      scores: scores(2),
      outcomeStatus: 'COMPLETED',
    }),
  ]);
  assert.deepStrictEqual(
    feedback.outcomeCorrelation.highScore,
    {
      sampleCount: 2,
      completedCount: 1,
      failedCount: 0,
      completionRate: 0.5,
      failureRate: 0,
    }
  );
  assert.deepStrictEqual(
    feedback.outcomeCorrelation.lowScore,
    {
      sampleCount: 2,
      completedCount: 1,
      failedCount: 1,
      completionRate: 0.5,
      failureRate: 0.5,
    }
  );
});

test('case and outcome average scores use all valid dimensions', function () {
  var completed = goldenCase({
    scores: scores(4, { executionQuality: 5 }),
    outcomeStatus: 'COMPLETED',
  });
  var failed = goldenCase({
    scores: scores(2, { htfClarity: 4 }),
    outcomeStatus: 'FAILED',
  });
  var feedback = Analyzer.analyze([completed, failed]);
  assert.strictEqual(Analyzer.caseAverageScore(completed), 4.2);
  assert.strictEqual(Analyzer.caseAverageScore(failed), 2.4);
  assert.deepStrictEqual(feedback.outcomeAverageScore.completed, {
    sampleCount: 1,
    averageScore: 4.2,
  });
  assert.deepStrictEqual(feedback.outcomeAverageScore.failed, {
    sampleCount: 1,
    averageScore: 2.4,
  });
  assert.ok(Formatter.format(feedback).indexOf(
    '成功案例平均评分：4.20'
  ) >= 0);
});

test('missing and null review values remain compatible', function () {
  var feedback = Analyzer.analyze({ cases: [
    { data: goldenCase({ symbol: 'BTCUSDT' }) },
    { data: { symbol: 'ETHUSDT', review: null, outcome: {} } },
    {
      data: {
        symbol: 'SOLUSDT',
        review: { score: {} },
        outcome: {},
      },
    },
  ] });
  assert.deepStrictEqual(feedback.coverage, {
    totalCases: 3,
    reviewedCases: 0,
    unreviewedCases: 3,
  });
  assert.strictEqual(
    feedback.dimensions.executionQuality.sampleCount,
    0
  );
  assert.strictEqual(
    feedback.outcomeAverageScore.completed.averageScore,
    null
  );
});

test('generator writes feedback without modifying case JSON', function () {
  var root;
  var inputDirectory;
  var outputPath;
  var inputPath;
  var item = goldenCase({
    scores: scores(5),
    outcomeStatus: 'COMPLETED',
  });
  var originalBody = JSON.stringify(item, null, 2) + '\n';

  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-review-feedback-'
  )).then(function (created) {
    root = created;
    inputDirectory = path.join(root, 'cases');
    outputPath = path.join(root, 'feedback.txt');
    inputPath = path.join(inputDirectory, 'case.json');
    return fs.mkdir(inputDirectory, { recursive: true });
  }).then(function () {
    return fs.writeFile(inputPath, originalBody, 'utf8');
  }).then(function () {
    return Generator.generateGoldenCaseReviewFeedback({
      inputDirectory: inputDirectory,
      outputPath: outputPath,
    });
  }).then(function (result) {
    assert.strictEqual(result.feedback.coverage.totalCases, 1);
    return Promise.all([
      fs.readFile(outputPath, 'utf8'),
      fs.readFile(inputPath, 'utf8'),
    ]);
  }).then(function (contents) {
    assert.ok(contents[0].indexOf(
      'ICT Golden Case Review Feedback'
    ) >= 0);
    assert.strictEqual(contents[1], originalBody);
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
