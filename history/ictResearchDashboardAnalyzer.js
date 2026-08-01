'use strict';

var SOURCE_KEYS = [
  'goldenCaseStatistics',
  'goldenCaseResearch',
  'lifecycleResearch',
  'reviewFeedback',
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback) {
  var number = Number(value);
  return value !== null && value !== '' && isFinite(number)
    ? number
    : fallback;
}

function nonNegative(value) {
  return Math.max(0, finiteNumber(value, 0));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function firstNumber(values) {
  var index;
  var number;
  for (index = 0; index < values.length; index += 1) {
    number = finiteNumber(values[index], null);
    if (number !== null) return number;
  }
  return 0;
}

function normalizeInputs(input) {
  input = isObject(input) ? input : {};
  return {
    goldenCaseStatistics:
      input.goldenCaseStatistics || input.statistics || null,
    goldenCaseResearch:
      input.goldenCaseResearch || input.research || null,
    lifecycleResearch:
      input.lifecycleResearch || input.lifecycle || null,
    reviewFeedback:
      input.reviewFeedback || input.review || null,
  };
}

function sourceStatus(inputs) {
  var sources = {};
  var missing = [];
  SOURCE_KEYS.forEach(function (key) {
    sources[key] = isObject(inputs[key]);
    if (!sources[key]) missing.push(key);
  });
  return { sources: sources, missingReports: missing };
}

function totalCases(inputs) {
  var statistics = inputs.goldenCaseStatistics || {};
  var research = inputs.goldenCaseResearch || {};
  var feedback = inputs.reviewFeedback || {};
  return firstNumber([
    statistics.totalCases,
    research.overview && research.overview.totalCases,
    feedback.coverage && feedback.coverage.totalCases,
  ]);
}

function funnelFrom(lifecycle) {
  var overview = isObject(lifecycle && lifecycle.overview)
    ? lifecycle.overview
    : {};
  return {
    WATCH_ZONE: nonNegative(overview.watchZoneCount),
    CONFIRMING: nonNegative(overview.confirmingCount),
    READY_OBSERVATION: nonNegative(overview.readyCount),
    OUTCOME: nonNegative(overview.completedOutcomeCount),
  };
}

function normalizeConversion(value, fromCount, toCount) {
  value = isObject(value) ? value : {};
  var eligibleCount = firstNumber([
    value.eligibleCount,
    fromCount,
  ]);
  var convertedCount = firstNumber([
    value.convertedCount,
    toCount,
  ]);
  return {
    eligibleCount: nonNegative(eligibleCount),
    convertedCount: nonNegative(convertedCount),
    rate: finiteNumber(
      value.rate,
      ratio(convertedCount, eligibleCount)
    ),
  };
}

function conversionsFrom(lifecycle, funnel) {
  var conversions = isObject(
    lifecycle && lifecycle.conversionRates
  ) ? lifecycle.conversionRates : {};
  return {
    watchZoneToConfirming: normalizeConversion(
      conversions.watchZoneToConfirming,
      funnel.WATCH_ZONE,
      funnel.CONFIRMING
    ),
    confirmingToReady: normalizeConversion(
      conversions.confirmingToReady,
      funnel.CONFIRMING,
      funnel.READY_OBSERVATION
    ),
    readyToOutcome: normalizeConversion(
      conversions.readyToCompletedOutcome ||
        conversions.readyToOutcome,
      funnel.READY_OBSERVATION,
      funnel.OUTCOME
    ),
  };
}

function combinationSource(inputs) {
  var research = inputs.goldenCaseResearch || {};
  var statistics = inputs.goldenCaseStatistics || {};
  if (Array.isArray(research.bestConditions)) {
    return research.bestConditions;
  }
  return Array.isArray(statistics.topCombinations)
    ? statistics.topCombinations
    : [];
}

function bestCombinations(inputs) {
  return combinationSource(inputs).map(function (item) {
    item = isObject(item) ? item : {};
    return {
      h4Bias: item.h4Bias || 'UNAVAILABLE',
      structurePhase: item.structurePhase || 'UNAVAILABLE',
      alignment:
        item.htfAlignment || item.alignment || 'UNAVAILABLE',
      liquidityType: item.liquidityType || 'UNAVAILABLE',
      direction:
        item.opportunityDirection ||
        item.direction ||
        'UNAVAILABLE',
      sampleCount: nonNegative(item.sampleCount),
      completedCount: nonNegative(item.completedCount),
      failedCount: nonNegative(item.failedCount),
      completionRate: nonNegative(item.completionRate),
      failureRate: nonNegative(item.failureRate),
    };
  }).sort(function (left, right) {
    if (right.completionRate !== left.completionRate) {
      return right.completionRate - left.completionRate;
    }
    if (right.sampleCount !== left.sampleCount) {
      return right.sampleCount - left.sampleCount;
    }
    return [
      left.h4Bias,
      left.structurePhase,
      left.alignment,
      left.liquidityType,
      left.direction,
    ].join('|').localeCompare([
      right.h4Bias,
      right.structurePhase,
      right.alignment,
      right.liquidityType,
      right.direction,
    ].join('|'));
  }).map(function (item, index) {
    item.rank = index + 1;
    return item;
  });
}

function failedOutcomeCount(statistics, research) {
  var status = isObject(statistics && statistics.outcomeStatus)
    ? statistics.outcomeStatus
    : {};
  var overview = isObject(research && research.overview)
    ? research.overview
    : {};
  return firstNumber([status.FAILED, overview.failedCount]);
}

function invalidatedCount(lifecycle) {
  var counts = isObject(lifecycle && lifecycle.transitionCounts)
    ? lifecycle.transitionCounts
    : {};
  var overview = isObject(lifecycle && lifecycle.overview)
    ? lifecycle.overview
    : {};
  return firstNumber([
    counts.readyObservationToInvalidated,
    overview.invalidatedCount,
  ]);
}

function failureStages(inputs, funnel, conversions) {
  var items = [
    {
      stage: 'WATCH_ZONE',
      reason: 'NOT_CONVERTED_TO_CONFIRMING',
      count: Math.max(
        0,
        funnel.WATCH_ZONE -
          conversions.watchZoneToConfirming.convertedCount
      ),
    },
    {
      stage: 'CONFIRMING',
      reason: 'NOT_CONVERTED_TO_READY_OBSERVATION',
      count: Math.max(
        0,
        funnel.CONFIRMING -
          conversions.confirmingToReady.convertedCount
      ),
    },
    {
      stage: 'READY_OBSERVATION',
      reason: 'INVALIDATED',
      count: invalidatedCount(inputs.lifecycleResearch),
    },
    {
      stage: 'OUTCOME',
      reason: 'FAILED',
      count: failedOutcomeCount(
        inputs.goldenCaseStatistics,
        inputs.goldenCaseResearch
      ),
    },
  ];
  return {
    watchZoneNotConfirming: items[0].count,
    confirmingNotReady: items[1].count,
    readyInvalidated: items[2].count,
    failedOutcomes: items[3].count,
    items: items,
  };
}

function normalizeOutcomeMetrics(value) {
  value = isObject(value) ? value : {};
  return {
    sampleCount: nonNegative(value.sampleCount),
    completedCount: nonNegative(value.completedCount),
    failedCount: nonNegative(value.failedCount),
    completionRate: nonNegative(value.completionRate),
    failureRate: nonNegative(value.failureRate),
  };
}

function normalizeAverage(value) {
  value = isObject(value) ? value : {};
  return {
    sampleCount: nonNegative(value.sampleCount),
    averageScore: finiteNumber(value.averageScore, null),
  };
}

function reviewOutcome(reviewFeedback) {
  var feedback = isObject(reviewFeedback) ? reviewFeedback : {};
  var coverage = isObject(feedback.coverage)
    ? feedback.coverage
    : {};
  var correlation = isObject(feedback.outcomeCorrelation)
    ? feedback.outcomeCorrelation
    : {};
  var average = isObject(feedback.outcomeAverageScore)
    ? feedback.outcomeAverageScore
    : {};
  return {
    coverage: {
      totalCases: nonNegative(coverage.totalCases),
      reviewedCases: nonNegative(coverage.reviewedCases),
      unreviewedCases: nonNegative(coverage.unreviewedCases),
    },
    threshold: finiteNumber(correlation.threshold, null),
    highScore: normalizeOutcomeMetrics(correlation.highScore),
    lowScore: normalizeOutcomeMetrics(correlation.lowScore),
    completed: normalizeAverage(average.completed),
    failed: normalizeAverage(average.failed),
  };
}

function analyze(input) {
  var inputs = normalizeInputs(input);
  var status = sourceStatus(inputs);
  var lifecycle = inputs.lifecycleResearch || {};
  var funnel = funnelFrom(lifecycle);
  var conversions = conversionsFrom(lifecycle, funnel);
  var total = totalCases(inputs);
  var totalOpportunities = firstNumber([
    lifecycle.totalOpportunities,
    lifecycle.overview &&
      lifecycle.overview.totalOpportunities,
  ]);
  return {
    version: '2',
    sourceStatus: status.sources,
    missingReports: status.missingReports,
    totalCases: total,
    totalOpportunities: totalOpportunities,
    lifecycleFunnel: funnel,
    funnel: clone(funnel),
    conversionRates: conversions,
    bestCombinations: bestCombinations(inputs),
    failureStages: failureStages(inputs, funnel, conversions),
    reviewOutcome: reviewOutcome(inputs.reviewFeedback),
  };
}

module.exports = {
  SOURCE_KEYS: SOURCE_KEYS.slice(),
  analyze: analyze,
  bestCombinations: bestCombinations,
  conversionsFrom: conversionsFrom,
  failureStages: failureStages,
  funnelFrom: funnelFrom,
  normalizeInputs: normalizeInputs,
  normalizeOutcomeMetrics: normalizeOutcomeMetrics,
  ratio: ratio,
  reviewOutcome: reviewOutcome,
  sourceStatus: sourceStatus,
  totalCases: totalCases,
};
