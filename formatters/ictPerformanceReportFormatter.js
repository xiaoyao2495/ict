'use strict';

const BeijingTime = require('./beijingTime');

function percent(value) {
  return (value * 100).toFixed(2) + '%';
}

function number(value) {
  return Number.isFinite(value)
    ? value.toFixed(2)
    : '暂无';
}

function cohortLines(cohort) {
  return [
    '- ' + cohort.label,
    '  样本：' + cohort.outcomeCount +
      '，可评估：' + cohort.eligibleCount,
    '  +1R：' + cohort.oneRCount +
      '（' + percent(cohort.oneRRate) + '）',
    '  +2R：' + cohort.twoRCount +
      '（' + percent(cohort.twoRRate) + '）',
    '  +3R：' + cohort.threeRCount +
      '（' + percent(cohort.threeRRate) + '）',
    '  失败：' + cohort.failedCount +
      '（' + percent(cohort.failedRate) + '）',
  ];
}

function format(report, options) {
  options = options || {};
  const generatedAt = options.generatedAt === undefined
    ? Date.now()
    : options.generatedAt;
  const coverage = report.coverage;
  const overall = report.overall;
  const lines = [
    'ICT Performance Report',
    '',
    '生成时间（UTC+8）：' +
      BeijingTime.formatBeijingTime(generatedAt),
    '',
    '1. 数据覆盖',
    '- Symbol数量：' + coverage.symbolCount,
    '- 生命周期状态记录：' + coverage.transitionCount,
    '- WAITING：' + coverage.statusCounts.WAITING,
    '- WATCH_ZONE：' +
      coverage.statusCounts.WATCH_ZONE,
    '- CONFIRMING：' +
      coverage.statusCounts.CONFIRMING,
    '- CONFIRMED：' +
      coverage.statusCounts.CONFIRMED,
    '- 首次记录（UTC+8）：' + (
      coverage.firstChangedAt
        ? BeijingTime.formatBeijingTime(
          coverage.firstChangedAt
        )
        : '暂无'
    ),
    '- 最近记录（UTC+8）：' + (
      coverage.lastChangedAt
        ? BeijingTime.formatBeijingTime(
          coverage.lastChangedAt
        )
        : '暂无'
    ),
    '',
    '2. Opportunity Statistics',
    report.statisticsText || '暂无统计报告内容',
    '',
    '3. CONFIRMED后市场表现',
    '- 历史CONFIRMED事件：' +
      report.confirmedEventCount,
    '- Outcome记录：' + overall.outcomeCount,
    '- 可评估Outcome：' + overall.eligibleCount,
    '- +1R：' + overall.oneRCount +
      '（' + percent(overall.oneRRate) + '）',
    '- +2R：' + overall.twoRCount +
      '（' + percent(overall.twoRRate) + '）',
    '- +3R：' + overall.threeRCount +
      '（' + percent(overall.threeRRate) + '）',
    '- 失败：' + overall.failedCount +
      '（' + percent(overall.failedRate) + '）',
    '- 平均达到+1R时间：' +
      number(overall.averageMinutesToOneR) + '分钟',
    '- 平均达到+2R时间：' +
      number(overall.averageMinutesToTwoR) + '分钟',
    '- 平均达到+3R时间：' +
      number(overall.averageMinutesToThreeR) + '分钟',
    '',
    '4. Tracking状态',
  ];

  const trackingEntries = Object.entries(
    report.trackingStatusCounts
  );
  if (trackingEntries.length === 0) {
    lines.push('- 暂无');
  } else {
    for (const [status, count] of trackingEntries) {
      lines.push('- ' + status + '：' + count);
    }
  }

  lines.push('', '5. 按Symbol');
  if (report.bySymbol.length === 0) {
    lines.push('- 暂无');
  } else {
    for (const cohort of report.bySymbol) {
      lines.push(...cohortLines(cohort));
    }
  }

  lines.push('', '6. 按方向');
  for (const cohort of report.byDirection) {
    lines.push(...cohortLines(cohort));
  }

  lines.push('', '7. 按流动性类型');
  if (report.byLiquidityType.length === 0) {
    lines.push('- 暂无');
  } else {
    for (const cohort of report.byLiquidityType) {
      lines.push(...cohortLines(cohort));
    }
  }

  lines.push(
    '',
    '8. 数据一致性',
    '- 已匹配Outcome：' +
      report.consistency.matchedOutcomeCount,
    '- 缺少Outcome：' +
      report.consistency.missingOutcomeCount,
    '- 无对应历史事件Outcome：' +
      report.consistency.orphanOutcomeCount
  );
  return lines.join('\n') + '\n';
}

module.exports = {
  cohortLines,
  format,
  number,
  percent,
};
