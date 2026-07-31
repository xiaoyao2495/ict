'use strict';

var Analyzer = require(
  '../history/ictGoldenCaseStatisticsAnalyzer'
);

function percent(value) {
  var number = typeof value === 'number' && isFinite(value)
    ? value
    : 0;
  return (number * 100).toFixed(2) + '%';
}

function metricLine(item) {
  return [
    '- ' + item.value,
    '样本 ' + item.sampleCount,
    '完成 ' + item.completedCount,
    '失败 ' + item.failedCount,
    '完成率 ' + percent(item.completionRate),
    '失败率 ' + percent(item.failureRate),
  ].join('｜');
}

function combinationLine(item, index) {
  return [
    (index + 1) + '. ',
    '4H=' + item.h4Bias,
    '结构阶段=' + item.structurePhase,
    '一致性=' + item.htfAlignment,
    '机会方向=' + item.opportunityDirection,
    '流动性=' + item.liquidityType,
    '样本=' + item.sampleCount,
    '完成=' + item.completedCount,
    '失败=' + item.failedCount,
    '完成率=' + percent(item.completionRate),
    '失败率=' + percent(item.failureRate),
  ].join('｜');
}

function format(statistics) {
  var data = statistics || {};
  var totalCases = data.totalCases || 0;
  var outcome = data.outcomeStatus || {};
  var dimensions = data.dimensions || {};
  var combinations = Array.isArray(data.topCombinations)
    ? data.topCombinations
    : [];
  var lines;

  if (totalCases === 0) {
    return '暂无Golden Case统计数据\n';
  }
  lines = [
    'ICT Golden Case 统计报告',
    '',
    '1. 总案例数量：' + totalCases,
    '',
    '2. Outcome状态',
    '- COMPLETED：' + (outcome.COMPLETED || 0),
    '- FAILED：' + (outcome.FAILED || 0),
    '- TRACKING：' + (outcome.TRACKING || 0),
    '- EMPTY：' + (outcome.EMPTY || 0),
    '',
    '3. 多维度统计',
  ];

  Analyzer.DIMENSIONS.forEach(function (descriptor) {
    var groups = Array.isArray(dimensions[descriptor.key])
      ? dimensions[descriptor.key]
      : [];
    lines.push('', '【' + descriptor.label + '】');
    if (groups.length === 0) {
      lines.push('- 暂无数据');
      return;
    }
    groups.forEach(function (item) {
      lines.push(metricLine(item));
    });
  });

  lines.push(
    '',
    '4. 最佳联合组合 Top 5',
    '筛选条件：样本数 >= ' +
      Analyzer.MIN_COMBINATION_SAMPLE
  );
  if (combinations.length === 0) {
    lines.push('暂无满足样本数要求的组合。');
  } else {
    combinations.forEach(function (item, index) {
      lines.push(combinationLine(item, index));
    });
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  combinationLine: combinationLine,
  format: format,
  metricLine: metricLine,
  percent: percent,
};
