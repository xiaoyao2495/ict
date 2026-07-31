'use strict';

var Analyzer = require(
  '../history/ictGoldenCaseReviewFeedbackAnalyzer'
);

function score(value, sampleCount) {
  return sampleCount > 0 &&
    typeof value === 'number' &&
    isFinite(value)
    ? value.toFixed(2)
    : '暂无';
}

function percent(value) {
  var number = typeof value === 'number' && isFinite(value)
    ? value
    : 0;
  return (number * 100).toFixed(2) + '%';
}

function appendOutcomeGroup(lines, title, metrics) {
  var data = metrics || {};
  lines.push(
    '',
    '【' + title + '】',
    '样本数量：' + (data.sampleCount || 0),
    'COMPLETED率：' + percent(data.completionRate),
    'FAILED率：' + percent(data.failureRate)
  );
}

function format(feedback) {
  var data = feedback || {};
  var coverage = data.coverage || {};
  var dimensions = data.dimensions || {};
  var correlation = data.outcomeCorrelation || {};
  var outcomeAverage = data.outcomeAverageScore || {};
  var lines;

  if (!coverage.totalCases) {
    return '暂无Review Feedback数据\n';
  }

  lines = [
    'ICT Golden Case Review Feedback',
    '',
    '1. Review 覆盖情况',
    '总案例：' + coverage.totalCases,
    '已评分案例：' + (coverage.reviewedCases || 0),
    '未评分案例：' + (coverage.unreviewedCases || 0),
    '',
    '2. 评分维度统计',
  ];

  Analyzer.SCORE_FIELDS.forEach(function (field) {
    var metrics = dimensions[field] || {};
    lines.push(
      '',
      '【' + field + '】',
      '平均分：' + score(
        metrics.averageScore,
        metrics.sampleCount
      ),
      '样本数量：' + (metrics.sampleCount || 0)
    );
  });

  lines.push(
    '',
    '3. Outcome关联',
    '分组依据：案例有效评分平均值'
  );
  appendOutcomeGroup(
    lines,
    '高评分案例（score >= ' +
      Analyzer.HIGH_SCORE_THRESHOLD + '）',
    correlation.highScore
  );
  appendOutcomeGroup(
    lines,
    '低评分案例（score < ' +
      Analyzer.HIGH_SCORE_THRESHOLD + '）',
    correlation.lowScore
  );

  lines.push(
    '',
    '4. Outcome平均评分',
    '成功案例平均评分：' + score(
      outcomeAverage.completed &&
        outcomeAverage.completed.averageScore,
      outcomeAverage.completed &&
        outcomeAverage.completed.sampleCount
    ),
    '成功案例评分样本：' + (
      outcomeAverage.completed &&
      outcomeAverage.completed.sampleCount || 0
    ),
    '失败案例平均评分：' + score(
      outcomeAverage.failed &&
        outcomeAverage.failed.averageScore,
      outcomeAverage.failed &&
        outcomeAverage.failed.sampleCount
    ),
    '失败案例评分样本：' + (
      outcomeAverage.failed &&
      outcomeAverage.failed.sampleCount || 0
    )
  );

  return lines.join('\n') + '\n';
}

module.exports = {
  appendOutcomeGroup: appendOutcomeGroup,
  format: format,
  percent: percent,
  score: score,
};
