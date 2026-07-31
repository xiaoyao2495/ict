'use strict';

var MIN_COMBINATION_SAMPLE = 10;
var TOP_COMBINATION_LIMIT = 5;
var UNKNOWN_VALUE = 'UNAVAILABLE';
var OUTCOME_STATUSES = [
  'COMPLETED',
  'FAILED',
  'TRACKING',
  'EMPTY',
];
var DIMENSIONS = [
  {
    key: 'h4Bias',
    label: 'h4Bias',
    value: function (item) {
      return nestedValue(item, ['htfBias', 'bias']);
    },
  },
  {
    key: 'structurePhase',
    label: 'structurePhase.state',
    value: function (item) {
      return nestedValue(item, ['structurePhase', 'state']);
    },
  },
  {
    key: 'htfAlignment',
    label: 'htfAlignment.status',
    value: function (item) {
      return nestedValue(item, ['htfAlignment', 'status']);
    },
  },
  {
    key: 'opportunityDirection',
    label: 'opportunity.direction',
    value: function (item) {
      return nestedValue(item, ['opportunity', 'direction']);
    },
  },
  {
    key: 'liquidityType',
    label: 'opportunity.liquidityType',
    value: function (item) {
      return nestedValue(item, ['opportunity', 'liquidityType']);
    },
  },
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function nestedValue(item, keys) {
  var current = item;
  var index;
  for (index = 0; index < keys.length; index += 1) {
    if (!isObject(current)) return UNKNOWN_VALUE;
    current = current[keys[index]];
  }
  if (
    current === undefined ||
    current === null ||
    current === ''
  ) {
    return UNKNOWN_VALUE;
  }
  return String(current);
}

function normalizeCases(input) {
  var items;
  if (Array.isArray(input)) {
    items = input;
  } else if (isObject(input) && Array.isArray(input.cases)) {
    items = input.cases;
  } else {
    items = [];
  }
  return items.map(function (item) {
    return isObject(item) && isObject(item.data)
      ? item.data
      : item;
  }).filter(function (item) {
    return isObject(item);
  });
}

function outcomeStatus(item) {
  var outcome = isObject(item && item.outcome)
    ? item.outcome
    : {};
  var keys = Object.keys(outcome);
  if (keys.length === 0) return 'EMPTY';
  if (
    outcome.failed === true ||
    outcome.trackingStatus === 'FAILED'
  ) {
    return 'FAILED';
  }
  if (
    outcome.trackingStatus === 'COMPLETED' ||
    outcome.threeRAt
  ) {
    return 'COMPLETED';
  }
  return 'TRACKING';
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function emptyMetrics() {
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

function finalizeMetrics(metrics) {
  return {
    sampleCount: metrics.sampleCount,
    completedCount: metrics.completedCount,
    failedCount: metrics.failedCount,
    completionRate: ratio(
      metrics.completedCount,
      metrics.sampleCount
    ),
    failureRate: ratio(
      metrics.failedCount,
      metrics.sampleCount
    ),
  };
}

function metricSort(left, right) {
  if (right.sampleCount !== left.sampleCount) {
    return right.sampleCount - left.sampleCount;
  }
  return left.value.localeCompare(right.value);
}

function dimensionStatistics(cases, descriptor, statuses) {
  var groups = {};
  var index;
  var value;
  for (index = 0; index < cases.length; index += 1) {
    value = descriptor.value(cases[index]);
    if (!groups[value]) groups[value] = emptyMetrics();
    addOutcome(groups[value], statuses[index]);
  }
  return Object.keys(groups).map(function (groupValue) {
    var metrics = finalizeMetrics(groups[groupValue]);
    metrics.value = groupValue;
    return metrics;
  }).sort(metricSort);
}

function combinationValues(item) {
  var values = {};
  DIMENSIONS.forEach(function (descriptor) {
    values[descriptor.key] = descriptor.value(item);
  });
  return values;
}

function combinationKey(values) {
  return DIMENSIONS.map(function (descriptor) {
    return values[descriptor.key];
  }).join('|');
}

function combinationSort(left, right) {
  if (right.completionRate !== left.completionRate) {
    return right.completionRate - left.completionRate;
  }
  if (right.sampleCount !== left.sampleCount) {
    return right.sampleCount - left.sampleCount;
  }
  return left.key.localeCompare(right.key);
}

function topCombinations(cases, statuses) {
  var groups = {};
  var index;
  var values;
  var key;
  for (index = 0; index < cases.length; index += 1) {
    values = combinationValues(cases[index]);
    key = combinationKey(values);
    if (!groups[key]) {
      groups[key] = {
        key: key,
        values: values,
        metrics: emptyMetrics(),
      };
    }
    addOutcome(groups[key].metrics, statuses[index]);
  }
  return Object.keys(groups).map(function (groupKey) {
    var group = groups[groupKey];
    var metrics = finalizeMetrics(group.metrics);
    return {
      key: group.key,
      h4Bias: group.values.h4Bias,
      structurePhase: group.values.structurePhase,
      htfAlignment: group.values.htfAlignment,
      opportunityDirection:
        group.values.opportunityDirection,
      liquidityType: group.values.liquidityType,
      sampleCount: metrics.sampleCount,
      completedCount: metrics.completedCount,
      failedCount: metrics.failedCount,
      completionRate: metrics.completionRate,
      failureRate: metrics.failureRate,
    };
  }).filter(function (group) {
    return group.sampleCount >= MIN_COMBINATION_SAMPLE;
  }).sort(combinationSort).slice(0, TOP_COMBINATION_LIMIT);
}

function analyze(input) {
  var cases = normalizeCases(input);
  var statuses = cases.map(outcomeStatus);
  var outcomeCounts = {
    COMPLETED: 0,
    FAILED: 0,
    TRACKING: 0,
    EMPTY: 0,
  };
  var dimensions = {};

  statuses.forEach(function (status) {
    outcomeCounts[status] += 1;
  });
  DIMENSIONS.forEach(function (descriptor) {
    dimensions[descriptor.key] = dimensionStatistics(
      cases,
      descriptor,
      statuses
    );
  });

  return {
    totalCases: cases.length,
    outcomeStatus: outcomeCounts,
    dimensions: dimensions,
    topCombinations: topCombinations(cases, statuses),
  };
}

module.exports = {
  DIMENSIONS: DIMENSIONS,
  MIN_COMBINATION_SAMPLE: MIN_COMBINATION_SAMPLE,
  OUTCOME_STATUSES: OUTCOME_STATUSES,
  TOP_COMBINATION_LIMIT: TOP_COMBINATION_LIMIT,
  UNKNOWN_VALUE: UNKNOWN_VALUE,
  analyze: analyze,
  combinationValues: combinationValues,
  dimensionStatistics: dimensionStatistics,
  normalizeCases: normalizeCases,
  outcomeStatus: outcomeStatus,
  topCombinations: topCombinations,
};
