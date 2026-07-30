'use strict';

const BeijingTime = require('./beijingTime');

function percent(value) {
  return (value * 100).toFixed(2) + '%';
}

function transitionLine(label, transition) {
  return (
    label + '：' +
    percent(transition.ratio) +
    '（' + transition.convertedCount +
    '/' + transition.sourceCount + '）'
  );
}

function cohortLine(cohort) {
  return (
    '- ' + cohort.label +
    '：次数 ' + cohort.count +
    '，CONFIRMED数量 ' + cohort.confirmedCount +
    '，转化率 ' + percent(cohort.conversionRate)
  );
}

function format(statistics, options) {
  options = options || {};
  const generatedAt = options.generatedAt === undefined
    ? Date.now()
    : options.generatedAt;
  const lines = [
    'ICT Opportunity Statistics',
    '',
    '生成时间（UTC+8）：' +
      BeijingTime.formatBeijingTime(generatedAt),
    '',
    '1. 总机会数量：' +
      statistics.totalOpportunities,
    '',
    '2. ' + transitionLine(
      'WAITING → WATCH_ZONE比例',
      statistics.transitions.waitingToWatchZone
    ),
    '',
    '3. ' + transitionLine(
      'WATCH_ZONE → CONFIRMING比例',
      statistics.transitions.watchZoneToConfirming
    ),
    '',
    '4. ' + transitionLine(
      'WATCH_ZONE → CONFIRMED比例',
      statistics.transitions.watchZoneToConfirmed
    ),
    '',
    '5. 不同流动性类型',
  ];

  for (const cohort of statistics.liquidityTypes) {
    lines.push(cohortLine(cohort));
  }

  lines.push(
    '',
    '6. 按交易时间UTC+8统计'
  );
  for (const cohort of statistics.timeBuckets) {
    lines.push(cohortLine(cohort));
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  cohortLine,
  format,
  percent,
  transitionLine,
};
