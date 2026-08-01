'use strict';

function percent(value) {
  var number = typeof value === 'number' && isFinite(value)
    ? value
    : 0;
  return (number * 100).toFixed(2) + '%';
}

function score(value, sampleCount) {
  return sampleCount > 0 &&
    typeof value === 'number' &&
    isFinite(value)
    ? value.toFixed(2)
    : '暂无';
}

function conversionLine(label, conversion) {
  conversion = conversion || {};
  return label + '：' +
    Number(conversion.convertedCount || 0) + '/' +
    Number(conversion.eligibleCount || 0) +
    '（' + percent(conversion.rate) + '）';
}

function combinationLine(item) {
  return [
    item.rank + '.',
    'Bias=' + item.h4Bias,
    'Structure=' + item.structurePhase,
    'Alignment=' + item.alignment,
    'Liquidity=' + item.liquidityType,
    'Direction=' + item.direction,
    '样本=' + item.sampleCount,
    '完成率=' + percent(item.completionRate),
  ].join('｜');
}

function reviewGroupLine(label, metrics) {
  metrics = metrics || {};
  return label + '：样本 ' + Number(metrics.sampleCount || 0) +
    '｜完成率 ' + percent(metrics.completionRate) +
    '｜失败率 ' + percent(metrics.failureRate);
}

function format(dashboard) {
  var data = dashboard || {};
  var funnel = data.lifecycleFunnel || data.funnel || {};
  var conversions = data.conversionRates || {};
  var combinations = Array.isArray(data.bestCombinations)
    ? data.bestCombinations
    : [];
  var failure = data.failureStages || {};
  var failureItems = Array.isArray(failure.items)
    ? failure.items
    : [];
  var review = data.reviewOutcome || {};
  var coverage = review.coverage || {};
  var missing = Array.isArray(data.missingReports)
    ? data.missingReports
    : [];
  var lines = [
    'ICT Research Dashboard V2',
    '',
    '1. 总览',
    '总案例数量：' + Number(data.totalCases || 0),
    '总 Opportunity 数量：' +
      Number(data.totalOpportunities || 0),
    '缺失研究报告：' + (
      missing.length > 0 ? missing.join(', ') : '无'
    ),
    '',
    '2. Lifecycle Funnel',
    'WATCH_ZONE：' + Number(funnel.WATCH_ZONE || 0),
    '↓',
    'CONFIRMING：' + Number(funnel.CONFIRMING || 0),
    '↓',
    'READY_OBSERVATION：' +
      Number(funnel.READY_OBSERVATION || 0),
    '↓',
    'Outcome：' + Number(funnel.OUTCOME || 0),
    '',
    '3. 阶段转化率',
    conversionLine(
      'WATCH_ZONE → CONFIRMING',
      conversions.watchZoneToConfirming
    ),
    conversionLine(
      'CONFIRMING → READY_OBSERVATION',
      conversions.confirmingToReady
    ),
    conversionLine(
      'READY_OBSERVATION → Outcome',
      conversions.readyToOutcome
    ),
    '',
    '4. 最佳组合排名',
  ];

  if (combinations.length === 0) {
    lines.push('暂无满足条件的组合。');
  } else {
    combinations.forEach(function (item) {
      lines.push(combinationLine(item));
    });
  }

  lines.push('', '5. 失败阶段统计');
  if (failureItems.length === 0) {
    lines.push('暂无失败阶段数据。');
  } else {
    failureItems.forEach(function (item) {
      lines.push(
        item.stage + '｜' + item.reason +
        '：' + Number(item.count || 0)
      );
    });
  }

  lines.push(
    '',
    '6. Review Score 与 Outcome',
    '已评分案例：' + Number(coverage.reviewedCases || 0) +
      '/' + Number(coverage.totalCases || 0),
    reviewGroupLine('高评分组', review.highScore),
    reviewGroupLine('低评分组', review.lowScore),
    'COMPLETED 平均评分：' + score(
      review.completed && review.completed.averageScore,
      review.completed && review.completed.sampleCount
    ),
    'FAILED 平均评分：' + score(
      review.failed && review.failed.averageScore,
      review.failed && review.failed.sampleCount
    )
  );
  return lines.join('\n') + '\n';
}

module.exports = {
  combinationLine: combinationLine,
  conversionLine: conversionLine,
  format: format,
  percent: percent,
  reviewGroupLine: reviewGroupLine,
  score: score,
};
