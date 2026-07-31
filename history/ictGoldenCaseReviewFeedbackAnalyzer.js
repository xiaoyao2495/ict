'use strict';

var Statistics = require(
  './ictGoldenCaseStatisticsAnalyzer'
);

var HIGH_SCORE_THRESHOLD = 4;
var SCORE_FIELDS = [
  'htfClarity',
  'structureClarity',
  'liquidityQuality',
  'alignmentQuality',
  'executionQuality',
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function finiteScore(value) {
  var number;
  if (value === undefined || value === null || value === '') {
    return null;
  }
  number = Number(value);
  return isFinite(number) ? number : null;
}

function reviewScores(item) {
  var review = isObject(item && item.review)
    ? item.review
    : {};
  var score = isObject(review.score) ? review.score : {};
  var values = {};
  SCORE_FIELDS.forEach(function (field) {
    values[field] = finiteScore(score[field]);
  });
  return values;
}

function scoreValues(item) {
  var scores = reviewScores(item);
  return SCORE_FIELDS.map(function (field) {
    return scores[field];
  }).filter(function (value) {
    return value !== null;
  });
}

function average(values) {
  var total;
  if (!Array.isArray(values) || values.length === 0) return null;
  total = values.reduce(function (sum, value) {
    return sum + value;
  }, 0);
  return total / values.length;
}

function caseAverageScore(item) {
  return average(scoreValues(item));
}

function dimensionStatistics(cases) {
  var result = {};
  SCORE_FIELDS.forEach(function (field) {
    var values = cases.map(function (item) {
      return reviewScores(item)[field];
    }).filter(function (value) {
      return value !== null;
    });
    result[field] = {
      averageScore: average(values),
      sampleCount: values.length,
    };
  });
  return result;
}

function emptyOutcomeMetrics() {
  return {
    sampleCount: 0,
    completedCount: 0,
    failedCount: 0,
    completionRate: 0,
    failureRate: 0,
  };
}

function addOutcome(metrics, status) {
  metrics.sampleCount += 1;
  if (status === 'COMPLETED') metrics.completedCount += 1;
  if (status === 'FAILED') metrics.failedCount += 1;
}

function finalizeOutcome(metrics) {
  var sampleCount = metrics.sampleCount;
  return {
    sampleCount: sampleCount,
    completedCount: metrics.completedCount,
    failedCount: metrics.failedCount,
    completionRate: sampleCount > 0
      ? metrics.completedCount / sampleCount
      : 0,
    failureRate: sampleCount > 0
      ? metrics.failedCount / sampleCount
      : 0,
  };
}

function outcomeCorrelation(cases) {
  var high = emptyOutcomeMetrics();
  var low = emptyOutcomeMetrics();
  cases.forEach(function (item) {
    var score = caseAverageScore(item);
    var status;
    if (score === null) return;
    status = Statistics.outcomeStatus(item);
    addOutcome(
      score >= HIGH_SCORE_THRESHOLD ? high : low,
      status
    );
  });
  return {
    threshold: HIGH_SCORE_THRESHOLD,
    highScore: finalizeOutcome(high),
    lowScore: finalizeOutcome(low),
  };
}

function outcomeAverageScores(cases) {
  var completed = [];
  var failed = [];
  cases.forEach(function (item) {
    var score = caseAverageScore(item);
    var status;
    if (score === null) return;
    status = Statistics.outcomeStatus(item);
    if (status === 'COMPLETED') completed.push(score);
    if (status === 'FAILED') failed.push(score);
  });
  return {
    completed: {
      sampleCount: completed.length,
      averageScore: average(completed),
    },
    failed: {
      sampleCount: failed.length,
      averageScore: average(failed),
    },
  };
}

function analyze(input) {
  var cases = Statistics.normalizeCases(input);
  var reviewedCases = cases.filter(function (item) {
    return caseAverageScore(item) !== null;
  });
  return {
    coverage: {
      totalCases: cases.length,
      reviewedCases: reviewedCases.length,
      unreviewedCases: cases.length - reviewedCases.length,
    },
    dimensions: dimensionStatistics(cases),
    outcomeCorrelation: outcomeCorrelation(cases),
    outcomeAverageScore: outcomeAverageScores(cases),
  };
}

module.exports = {
  HIGH_SCORE_THRESHOLD: HIGH_SCORE_THRESHOLD,
  SCORE_FIELDS: SCORE_FIELDS,
  analyze: analyze,
  average: average,
  caseAverageScore: caseAverageScore,
  dimensionStatistics: dimensionStatistics,
  finiteScore: finiteScore,
  outcomeAverageScores: outcomeAverageScores,
  outcomeCorrelation: outcomeCorrelation,
  reviewScores: reviewScores,
  scoreValues: scoreValues,
};
