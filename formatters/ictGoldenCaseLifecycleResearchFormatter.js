'use strict';

var Analyzer = require(
  '../history/ictGoldenCaseLifecycleResearchAnalyzer'
);

function percent(value) {
  var number = typeof value === 'number' && isFinite(value)
    ? value
    : 0;
  return (number * 100).toFixed(2) + '%';
}

function conversionLine(label, conversion) {
  conversion = conversion || {};
  return label + '：' +
    Number(conversion.convertedCount || 0) + '/' +
    Number(conversion.eligibleCount || 0) +
    '（' + percent(conversion.rate) + '）';
}

function dimensionLine(item) {
  return [
    '- ' + item.value,
    'Opportunity ' + item.totalOpportunities,
    'WATCH→CONFIRM ' + percent(
      item.watchZoneToConfirmingRate
    ),
    'CONFIRM→READY ' + percent(
      item.confirmingToReadyRate
    ),
    'READY Outcome ' + percent(
      item.readyOutcomeSuccessRate
    ),
  ].join('｜');
}

function appendDimension(lines, descriptor, items) {
  lines.push('', '【' + descriptor.label + '】');
  if (!Array.isArray(items) || items.length === 0) {
    lines.push('- 暂无数据');
    return;
  }
  items.forEach(function (item) {
    lines.push(dimensionLine(item));
  });
}

function format(research) {
  var data = research || {};
  var total = Number(data.totalOpportunities || 0);
  var transitions = Array.isArray(data.transitions)
    ? data.transitions
    : [];
  var conversions = data.conversionRates || {};
  var dimensions = data.dimensions || {};
  var lines;

  if (total === 0) {
    return '暂无Golden Case Lifecycle研究数据\n';
  }
  lines = [
    'ICT Golden Case Lifecycle Research V1',
    '',
    '1. 总览',
    'Opportunity 总数：' + total,
    '',
    '2. 状态转换',
  ];
  transitions.forEach(function (transition) {
    lines.push(
      transition.from + ' → ' + transition.to +
      '：' + transition.count
    );
  });
  lines.push(
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
      'READY_OBSERVATION → COMPLETED Outcome',
      conversions.readyToCompletedOutcome
    ),
    '',
    '4. 维度拆分'
  );
  Analyzer.DIMENSIONS.forEach(function (descriptor) {
    appendDimension(
      lines,
      descriptor,
      dimensions[descriptor.key]
    );
  });
  return lines.join('\n') + '\n';
}

module.exports = {
  appendDimension: appendDimension,
  conversionLine: conversionLine,
  dimensionLine: dimensionLine,
  format: format,
  percent: percent,
};
