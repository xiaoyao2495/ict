'use strict';

var Statistics = require(
  './ictGoldenCaseStatisticsAnalyzer'
);

var FIXED_LIQUIDITY_LABELS = [
  'PDL',
  'PWH',
  'Equal High',
  'Equal Low',
  'Swing High',
  'Swing Low',
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function valueAt(item, keys) {
  var current = item;
  var index;
  for (index = 0; index < keys.length; index += 1) {
    if (!isObject(current)) return Statistics.UNKNOWN_VALUE;
    current = current[keys[index]];
  }
  if (
    current === undefined ||
    current === null ||
    current === ''
  ) {
    return Statistics.UNKNOWN_VALUE;
  }
  return String(current);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function emptyMetrics() {
  return {
    sampleCount: 0,
    completedCount: 0,
    failedCount: 0,
  };
}

function addStatus(metrics, status) {
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

function metricsBy(cases, statuses, valueFunction) {
  var groups = {};
  var index;
  var value;
  for (index = 0; index < cases.length; index += 1) {
    value = valueFunction(cases[index]);
    if (!groups[value]) groups[value] = emptyMetrics();
    addStatus(groups[value], statuses[index]);
  }
  return Object.keys(groups).map(function (groupValue) {
    var metrics = finalizeMetrics(groups[groupValue]);
    metrics.value = groupValue;
    return metrics;
  }).sort(function (left, right) {
    if (right.sampleCount !== left.sampleCount) {
      return right.sampleCount - left.sampleCount;
    }
    return left.value.localeCompare(right.value);
  });
}

function htfCombination(item) {
  return [
    valueAt(item, ['htfBias', 'bias']),
    valueAt(item, ['structurePhase', 'state']),
    valueAt(item, ['htfAlignment', 'status']),
  ].join(' | ');
}

function structureDirection(item) {
  var explicit = valueAt(
    item,
    ['structurePhase', 'direction']
  );
  var state;
  if (
    explicit === 'BULLISH' ||
    explicit === 'BEARISH'
  ) {
    return explicit;
  }
  state = valueAt(item, ['structurePhase', 'state']);
  if (state.indexOf('BULLISH') === 0) return 'BULLISH';
  if (state.indexOf('BEARISH') === 0) return 'BEARISH';
  return null;
}

function biasDirection(item) {
  var bias = valueAt(item, ['htfBias', 'bias']);
  return bias === 'BULLISH' || bias === 'BEARISH'
    ? bias
    : null;
}

function conflictStudy(cases, statuses) {
  var conflictCases = [];
  var conflictStatuses = [];
  var overall = emptyMetrics();
  var index;

  for (index = 0; index < cases.length; index += 1) {
    var bias = biasDirection(cases[index]);
    var structure = structureDirection(cases[index]);
    if (!bias || !structure || bias === structure) continue;
    conflictCases.push({
      caseData: cases[index],
      biasDirection: bias,
      structureDirection: structure,
    });
    conflictStatuses.push(statuses[index]);
    addStatus(overall, statuses[index]);
  }

  return {
    sampleCount: overall.sampleCount,
    completedCount: overall.completedCount,
    failedCount: overall.failedCount,
    completionRate: ratio(
      overall.completedCount,
      overall.sampleCount
    ),
    failureRate: ratio(
      overall.failedCount,
      overall.sampleCount
    ),
    groups: metricsBy(
      conflictCases,
      conflictStatuses,
      function (entry) {
        return entry.biasDirection + ' vs ' +
          entry.structureDirection + ' | ' +
          valueAt(
            entry.caseData,
            ['structurePhase', 'state']
          );
      }
    ),
  };
}

function normalizedLiquidityType(item) {
  var type = valueAt(
    item,
    ['opportunity', 'liquidityType']
  );
  if (type === 'EQUAL_HIGH') return 'Equal High';
  if (type === 'EQUAL_LOW') return 'Equal Low';
  if (
    type === 'H4_SWING_HIGH' ||
    type === 'SWING_HIGH' ||
    type === 'LTF_SWING_HIGH'
  ) {
    return 'Swing High';
  }
  if (
    type === 'H4_SWING_LOW' ||
    type === 'SWING_LOW' ||
    type === 'LTF_SWING_LOW'
  ) {
    return 'Swing Low';
  }
  return type;
}

function opportunityStudy(cases, statuses) {
  var discovered = metricsBy(
    cases,
    statuses,
    normalizedLiquidityType
  );
  var byValue = {};
  var ordered = [];

  discovered.forEach(function (item) {
    byValue[item.value] = item;
  });
  FIXED_LIQUIDITY_LABELS.forEach(function (label) {
    var empty = finalizeMetrics(emptyMetrics());
    empty.value = label;
    ordered.push(byValue[label] || empty);
    delete byValue[label];
  });
  Object.keys(byValue).sort().forEach(function (label) {
    ordered.push(byValue[label]);
  });
  return ordered;
}

function beijingHour(value) {
  var timestamp = Date.parse(value);
  if (!isFinite(timestamp)) return null;
  return (new Date(timestamp).getUTCHours() + 8) % 24;
}

function hourLabel(hour) {
  var prefix = hour < 10 ? '0' : '';
  return prefix + hour + ':00-' + prefix + hour + ':59';
}

function selectBusiest(hours) {
  var active = hours.filter(function (item) {
    return item.sampleCount > 0;
  });
  active.sort(function (left, right) {
    if (right.sampleCount !== left.sampleCount) {
      return right.sampleCount - left.sampleCount;
    }
    return left.hour - right.hour;
  });
  return active.length > 0 ? active[0] : null;
}

function selectHighestCompletion(hours) {
  var active = hours.filter(function (item) {
    return item.sampleCount > 0;
  });
  active.sort(function (left, right) {
    if (right.completionRate !== left.completionRate) {
      return right.completionRate - left.completionRate;
    }
    if (right.sampleCount !== left.sampleCount) {
      return right.sampleCount - left.sampleCount;
    }
    return left.hour - right.hour;
  });
  return active.length > 0 ? active[0] : null;
}

function timeStudy(cases, statuses) {
  var raw = [];
  var hours = [];
  var index;
  for (index = 0; index < 24; index += 1) {
    raw.push(emptyMetrics());
  }
  for (index = 0; index < cases.length; index += 1) {
    var hour = beijingHour(cases[index].createdAt);
    if (hour === null) continue;
    addStatus(raw[hour], statuses[index]);
  }
  for (index = 0; index < 24; index += 1) {
    var metrics = finalizeMetrics(raw[index]);
    metrics.hour = index;
    metrics.label = hourLabel(index);
    hours.push(metrics);
  }
  return {
    hours: hours,
    busiestHour: selectBusiest(hours),
    highestCompletionHour: selectHighestCompletion(hours),
  };
}

function analyze(input) {
  var cases = Statistics.normalizeCases(input);
  var statuses = cases.map(Statistics.outcomeStatus);
  var statistics = Statistics.analyze(cases);
  var outcome = statistics.outcomeStatus;
  var total = statistics.totalCases;

  return {
    overview: {
      totalCases: total,
      completedCount: outcome.COMPLETED,
      failedCount: outcome.FAILED,
      trackingCount: outcome.TRACKING,
      emptyCount: outcome.EMPTY,
      completionRate: ratio(outcome.COMPLETED, total),
      failureRate: ratio(outcome.FAILED, total),
    },
    htfAnalysis: {
      h4Bias: statistics.dimensions.h4Bias,
      structurePhase: statistics.dimensions.structurePhase,
      htfAlignment: statistics.dimensions.htfAlignment,
      combined: metricsBy(cases, statuses, htfCombination),
    },
    conflictStudy: conflictStudy(cases, statuses),
    opportunityStudy: opportunityStudy(cases, statuses),
    timeStudy: timeStudy(cases, statuses),
    bestConditions: statistics.topCombinations,
  };
}

module.exports = {
  FIXED_LIQUIDITY_LABELS: FIXED_LIQUIDITY_LABELS,
  analyze: analyze,
  beijingHour: beijingHour,
  biasDirection: biasDirection,
  conflictStudy: conflictStudy,
  htfCombination: htfCombination,
  normalizedLiquidityType: normalizedLiquidityType,
  opportunityStudy: opportunityStudy,
  structureDirection: structureDirection,
  timeStudy: timeStudy,
};
