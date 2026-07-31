'use strict';

var Statistics = require(
  '../history/ictGoldenCaseStatisticsAnalyzer'
);

function percent(value) {
  var number = typeof value === 'number' && isFinite(value)
    ? value
    : 0;
  return (number * 100).toFixed(2) + '%';
}

function metricsLine(label, metrics) {
  return [
    '- ' + label,
    '样本 ' + metrics.sampleCount,
    '完成率 ' + percent(metrics.completionRate),
    '失败率 ' + percent(metrics.failureRate),
  ].join('｜');
}

function appendMetricGroup(lines, title, items) {
  lines.push('', '【' + title + '】');
  if (!Array.isArray(items) || items.length === 0) {
    lines.push('- 暂无数据');
    return;
  }
  items.forEach(function (item) {
    lines.push(metricsLine(item.value, item));
  });
}

function bestConditionLine(item, index) {
  return [
    (index + 1) + '. 4H=' + item.h4Bias,
    '结构阶段=' + item.structurePhase,
    '一致性=' + item.htfAlignment,
    '机会方向=' + item.opportunityDirection,
    '流动性=' + item.liquidityType,
    '样本=' + item.sampleCount,
    '完成率=' + percent(item.completionRate),
    '失败率=' + percent(item.failureRate),
  ].join('｜');
}

function formatHour(item) {
  if (!item) return '暂无有效时间数据';
  return item.label +
    '（样本 ' + item.sampleCount +
    '，完成率 ' + percent(item.completionRate) +
    '，失败率 ' + percent(item.failureRate) + '）';
}

function format(research) {
  var data = research || {};
  var overview = data.overview || {};
  var htf = data.htfAnalysis || {};
  var conflict = data.conflictStudy || {};
  var opportunities = Array.isArray(data.opportunityStudy)
    ? data.opportunityStudy
    : [];
  var time = data.timeStudy || {};
  var hours = Array.isArray(time.hours)
    ? time.hours.filter(function (item) {
      return item.sampleCount > 0;
    })
    : [];
  var best = Array.isArray(data.bestConditions)
    ? data.bestConditions
    : [];
  var lines;

  if (!overview.totalCases) {
    return '暂无Golden Case研究数据\n';
  }

  lines = [
    'ICT Golden Case Research Dashboard',
    '',
    '1. 总览',
    '案例数量：' + overview.totalCases,
    '完成数量：' + overview.completedCount,
    '失败数量：' + overview.failedCount,
    '追踪中数量：' + overview.trackingCount,
    '尚未关联Outcome：' + overview.emptyCount,
    '完成率：' + percent(overview.completionRate),
    '失败率：' + percent(overview.failureRate),
    '',
    '2. HTF分析',
  ];

  appendMetricGroup(lines, '4H Bias', htf.h4Bias);
  appendMetricGroup(
    lines,
    'Structure Phase',
    htf.structurePhase
  );
  appendMetricGroup(
    lines,
    'HTF Alignment',
    htf.htfAlignment
  );
  appendMetricGroup(lines, 'HTF联合环境', htf.combined);

  lines.push(
    '',
    '3. 冲突研究',
    '冲突样本数量：' + (conflict.sampleCount || 0),
    '完成率：' + percent(conflict.completionRate),
    '失败率：' + percent(conflict.failureRate)
  );
  appendMetricGroup(lines, 'Bias / Structure冲突', conflict.groups);

  lines.push('', '4. Opportunity研究');
  opportunities.forEach(function (item) {
    lines.push(metricsLine(item.value, item));
  });

  lines.push('', '5. 时间研究');
  hours.forEach(function (item) {
    lines.push(metricsLine(item.label, item));
  });
  lines.push(
    '机会最多时段：' + formatHour(time.busiestHour),
    '完成率最高时段：' +
      formatHour(time.highestCompletionHour),
    '',
    '6. 最佳案例条件',
    '筛选条件：样本数 >= ' +
      Statistics.MIN_COMBINATION_SAMPLE
  );
  if (best.length === 0) {
    lines.push('暂无满足样本数要求的组合。');
  } else {
    best.forEach(function (item, index) {
      lines.push(bestConditionLine(item, index));
    });
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  appendMetricGroup: appendMetricGroup,
  bestConditionLine: bestConditionLine,
  format: format,
  formatHour: formatHour,
  metricsLine: metricsLine,
  percent: percent,
};
