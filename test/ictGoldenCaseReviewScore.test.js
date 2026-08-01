'use strict';

var assert = require('assert');
var fs = require('fs').promises;
var os = require('os');
var path = require('path');
var ReviewScore = require(
  '../history/ictGoldenCaseReviewScore'
);

var FIRST_REVIEW_TIME = Date.UTC(2026, 6, 31, 1, 0, 0);
var SECOND_REVIEW_TIME = Date.UTC(2026, 6, 31, 2, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function goldenCase() {
  return {
    symbol: 'BTCUSDT',
    createdAt: '2026-07-31T00:00:00.000Z',
    snapshotVersion: '1',
    snapshot: {
      capturedAt: '2026-07-31T00:00:00.000Z',
      symbol: 'BTCUSDT',
      h4Bias: { bias: 'BULLISH' },
    },
    decisionGate: {
      state: 'READY_OBSERVATION',
      direction: 'BULLISH',
      activeOpportunity: {
        id: 'BULLISH|PDL|99',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99,
      },
      progress: {
        sweepCompleted: true,
        mssCompleted: true,
        displacementCompleted: true,
        strictConfirmationCompleted: true,
      },
      sourceState: { h4Bias: 'BULLISH' },
      blockers: [],
      reasonCode: 'STRICT_CONFIRMATION_COMPLETED',
      transition: {
        changed: true,
        from: 'CONFIRMING',
        to: 'READY_OBSERVATION',
      },
    },
    outcome: {
      trackingStatus: 'TRACKING',
      oneRAt: null,
    },
  };
}

function review(options) {
  options = options || {};
  return {
    reviewedAt: options.reviewedAt,
    reviewer: options.reviewer || 'manual-reviewer',
    score: {
      htfClarity: options.htfClarity || 4,
      structureClarity: 5,
      liquidityQuality: 4,
      alignmentQuality: 5,
      executionQuality: 3,
    },
    notes: options.notes || '结构与流动性叙事清晰。',
  };
}

function workspace() {
  var root;
  var filePath;
  return fs.mkdtemp(path.join(
    os.tmpdir(),
    'ict-golden-review-'
  )).then(function (created) {
    root = created;
    filePath = path.join(root, '2026-07-31-BTCUSDT.json');
    return fs.writeFile(
      filePath,
      JSON.stringify(goldenCase(), null, 2) + '\n',
      'utf8'
    );
  }).then(function () {
    return { root: root, filePath: filePath };
  });
}

function removeWorkspace(value) {
  if (!value) return Promise.resolve();
  return fs.rm(value.root, { recursive: true, force: true });
}

test('adds a review to an existing Golden Case', function () {
  var value;
  return workspace().then(function (created) {
    value = created;
    return ReviewScore.updateGoldenCaseReviewScore({
      caseFilePath: value.filePath,
      review: review(),
      currentTime: FIRST_REVIEW_TIME,
    });
  }).then(function (result) {
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.review, {
      reviewedAt: '2026-07-31T01:00:00.000Z',
      reviewer: 'manual-reviewer',
      score: {
        htfClarity: 4,
        structureClarity: 5,
        liquidityQuality: 4,
        alignmentQuality: 5,
        executionQuality: 3,
      },
      notes: '结构与流动性叙事清晰。',
    });
    return ReviewScore.readCase(value.filePath);
  }).then(function (loaded) {
    assert.deepStrictEqual(loaded.review, {
      reviewedAt: '2026-07-31T01:00:00.000Z',
      reviewer: 'manual-reviewer',
      score: {
        htfClarity: 4,
        structureClarity: 5,
        liquidityQuality: 4,
        alignmentQuality: 5,
        executionQuality: 3,
      },
      notes: '结构与流动性叙事清晰。',
    });
  }).finally(function () {
    return removeWorkspace(value);
  });
});

test('updates an existing review and repeats idempotently', function () {
  var value;
  var updatedReview = review({
    reviewer: 'second-reviewer',
    htfClarity: 5,
    notes: '复盘结论已更新。',
  });
  var firstBody;
  return workspace().then(function (created) {
    value = created;
    return ReviewScore.updateGoldenCaseReviewScore({
      caseFilePath: value.filePath,
      review: review(),
      currentTime: FIRST_REVIEW_TIME,
    });
  }).then(function () {
    return ReviewScore.updateGoldenCaseReviewScore({
      caseFilePath: value.filePath,
      review: updatedReview,
      currentTime: SECOND_REVIEW_TIME,
    });
  }).then(function (result) {
    assert.strictEqual(result.changed, true);
    assert.strictEqual(
      result.review.reviewedAt,
      '2026-07-31T02:00:00.000Z'
    );
    assert.strictEqual(result.review.reviewer, 'second-reviewer');
    assert.strictEqual(result.review.score.htfClarity, 5);
    return fs.readFile(value.filePath, 'utf8');
  }).then(function (body) {
    firstBody = body;
    return ReviewScore.updateGoldenCaseReviewScore({
      caseFilePath: value.filePath,
      review: updatedReview,
      currentTime: SECOND_REVIEW_TIME + 60000,
    });
  }).then(function (result) {
    assert.strictEqual(result.changed, false);
    assert.strictEqual(
      result.review.reviewedAt,
      '2026-07-31T02:00:00.000Z'
    );
    return fs.readFile(value.filePath, 'utf8');
  }).then(function (secondBody) {
    assert.strictEqual(secondBody, firstBody);
  }).finally(function () {
    return removeWorkspace(value);
  });
});

test('legacy case without review reads review as null', function () {
  var source = goldenCase();
  var before = JSON.stringify(source);
  var normalized = ReviewScore.normalizeCase(source);
  assert.strictEqual(normalized.review, null);
  assert.strictEqual(JSON.stringify(source), before);
  assert.strictEqual(hasOwn(source, 'review'), false);
});

test('review update preserves snapshot and outcome exactly', function () {
  var source = goldenCase();
  var snapshotBefore = JSON.stringify(source.snapshot);
  var outcomeBefore = JSON.stringify(source.outcome);
  var gateBefore = JSON.stringify(source.decisionGate);
  var result = ReviewScore.applyReview(source, review(), {
    currentTime: FIRST_REVIEW_TIME,
  });
  assert.strictEqual(result.changed, true);
  assert.strictEqual(
    JSON.stringify(result.caseData.snapshot),
    snapshotBefore
  );
  assert.strictEqual(
    JSON.stringify(result.caseData.outcome),
    outcomeBefore
  );
  assert.strictEqual(
    JSON.stringify(result.caseData.decisionGate),
    gateBefore
  );
  assert.strictEqual(JSON.stringify(source.snapshot), snapshotBefore);
  assert.strictEqual(JSON.stringify(source.outcome), outcomeBefore);
  assert.strictEqual(
    JSON.stringify(source.decisionGate),
    gateBefore
  );
  assert.strictEqual(hasOwn(source, 'review'), false);
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

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
