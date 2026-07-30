'use strict';

const HumanSummary = require('./ictAnalystHumanSummary');
const BeijingTime = require('./beijingTime');

const DIRECTION_TEXT = Object.freeze({
  BULLISH: '偏多',
  BEARISH: '偏空',
  NEUTRAL: '中性',
  TRANSITION: '过渡',
  UNAVAILABLE: '不可用',
});

const STRUCTURE_TEXT = Object.freeze({
  BULLISH: '多头结构',
  BEARISH: '空头结构',
  NEUTRAL: '中性结构',
  UNAVAILABLE: '结构不可用',
});

const LOCATION_TEXT = Object.freeze({
  PREMIUM: '溢价区',
  DISCOUNT: '折价区',
  EQUILIBRIUM: '均衡区',
  UNKNOWN: '位置不明确',
  UNAVAILABLE: '位置不可用',
});

const RELATION_TEXT = Object.freeze({
  ALIGNED: '与4H方向一致',
  RETRACEMENT: '相对4H处于回撤',
  COUNTER_TREND: '逆4H结构交付',
  UNCLEAR: '与4H关系不明确',
});

const LIQUIDITY_TYPE_TEXT = Object.freeze({
  PWH: '上周高点',
  PWL: '上周低点',
  PDH: '昨日高点',
  PDL: '昨日低点',
  H4_SWING_HIGH: '4小时摆动高点',
  H4_SWING_LOW: '4小时摆动低点',
  EQUAL_HIGH: '等高',
  EQUAL_LOW: '等低',
  H1_SWING_HIGH: '1小时摆动高点',
  H1_SWING_LOW: '1小时摆动低点',
  M15_SWING_HIGH: '15分钟摆动高点',
  M15_SWING_LOW: '15分钟摆动低点',
  LTF_SWING_HIGH: '5分钟摆动高点',
  LTF_SWING_LOW: '5分钟摆动低点',
});

function deliveryAnalysisOf(current) {
  return current.fifteenMinuteAnalysis ||
    current.oneHourAnalysis ||
    null;
}

function deliveryTimeframeText(delivery) {
  return delivery && delivery.timeframe === '15m'
    ? '15m'
    : '1H';
}

function currentOf(report) {
  const current = report && report.current
    ? report.current
    : report;
  if (
    !current ||
    !current.fourHourAnalysis ||
    !deliveryAnalysisOf(current) ||
    !current.fiveMinuteObservation
  ) {
    throw new Error(
      'A current ICT HTF Analyst Report JSON is required.'
    );
  }
  return current;
}

function directionText(value) {
  return DIRECTION_TEXT[value] || '不明确';
}

function structureText(analysis) {
  const state = STRUCTURE_TEXT[analysis.currentStructure] ||
    '结构不明确';
  const labels = (analysis.confirmedSwingSequence || [])
    .map((item) => item.label)
    .filter((label) => (
      label === 'HH' ||
      label === 'HL' ||
      label === 'LH' ||
      label === 'LL'
    ))
    .slice(-4);
  return labels.length > 0
    ? state + '（最近确认：' + labels.join(' → ') + '）'
    : state + '（暂无完整摆动序列）';
}

function primaryDrawText(draw) {
  if (!draw) return '暂无明确主要流动性目标';
  const type = LIQUIDITY_TYPE_TEXT[draw.type] ||
    '其他外部流动性';
  const side = draw.side === 'BUY_SIDE'
    ? '买方侧'
    : draw.side === 'SELL_SIDE'
      ? '卖方侧'
      : '方向未明';
  return type + '（' + side + '）';
}

function deliveryStageText(delivery) {
  const timeframe = deliveryTimeframeText(delivery);
  if (delivery.deliveryState === 'ALIGNED_BULLISH') {
    return timeframe + '正在顺应4H方向向上交付';
  }
  if (delivery.deliveryState === 'ALIGNED_BEARISH') {
    return timeframe + '正在顺应4H方向向下交付';
  }
  if (delivery.deliveryState === 'RETRACEMENT') {
    return timeframe + '处于相对4H方向的回撤阶段';
  }
  if (delivery.deliveryState === 'COUNTER_TREND') {
    return timeframe + '处于逆4H结构的交付阶段';
  }
  return timeframe + '尚未形成清晰的交付阶段';
}

function fifteenMinuteStatusText(delivery) {
  if (delivery.deliveryState === 'RETRACEMENT') {
    return '回调中';
  }
  if (
    delivery.deliveryState === 'ALIGNED_BULLISH' ||
    delivery.deliveryDirection === 'BULLISH'
  ) {
    return '开始顺势上涨';
  }
  if (
    delivery.deliveryState === 'ALIGNED_BEARISH' ||
    delivery.deliveryDirection === 'BEARISH'
  ) {
    return '开始顺势下跌';
  }
  return '方向不明确';
}

function sweepTypeText(type) {
  return LIQUIDITY_TYPE_TEXT[type] || type || '内部流动性';
}

function sweepSideText(side) {
  if (side === 'BUY_SIDE') return '买方';
  if (side === 'SELL_SIDE') return '卖方';
  return '未知方向';
}

function eventTimeText(time) {
  return BeijingTime.formatBeijingTime(time);
}

function sweepFormationTime(sweep) {
  for (const field of [
    'pivotTime',
    'formedTime',
    'formationTime',
    'createdAt',
  ]) {
    if (
      sweep[field] !== undefined &&
      sweep[field] !== null
    ) {
      return sweep[field];
    }
  }
  return null;
}

function sweepTakenTime(sweep) {
  for (const field of ['sweepTime', 'sweptAt', 'time']) {
    if (
      sweep[field] !== undefined &&
      sweep[field] !== null
    ) {
      return sweep[field];
    }
  }
  return null;
}

function sweepDetailLines(sweep, indent) {
  const prefix = indent || '';
  const type = sweep.targetType || sweep.type;
  const lines = [
    prefix + '类型：' + sweepTypeText(type),
  ];
  if (Number.isFinite(sweep.price)) {
    lines.push(prefix + '价格：' + sweep.price);
  }
  const formationTime = sweepFormationTime(sweep);
  if (formationTime !== null) {
    lines.push(
      prefix + '形成时间：' +
      eventTimeText(formationTime)
    );
  }
  const takenTime = sweepTakenTime(sweep);
  if (takenTime !== null) {
    lines.push(
      prefix + '扫取时间：' + eventTimeText(takenTime)
    );
  }
  return lines;
}

function latestSweep(sweeps) {
  return sweeps.reduce((latest, sweep) => {
    if (!latest) return sweep;
    const sweepTime = Number.isFinite(sweep.time)
      ? sweep.time
      : -Infinity;
    const latestTime = Number.isFinite(latest.time)
      ? latest.time
      : -Infinity;
    if (sweepTime !== latestTime) {
      return sweepTime > latestTime ? sweep : latest;
    }
    const sweepIndex = Number.isInteger(sweep.availableIndex)
      ? sweep.availableIndex
      : -Infinity;
    const latestIndex = Number.isInteger(latest.availableIndex)
      ? latest.availableIndex
      : -Infinity;
    return sweepIndex >= latestIndex ? sweep : latest;
  }, null);
}

function sweepText(sweeps) {
  if (!Array.isArray(sweeps) || sweeps.length === 0) {
    return '□ 等待流动性扫取';
  }

  const newest = latestSweep(sweeps);
  if (sweeps.length === 1) {
    return [
      '✓ 已扫流动性',
      ...sweepDetailLines(newest, '  '),
    ].join('\n');
  }

  const groups = new Map();
  for (const sweep of sweeps) {
    const key = sweep.side + '|' + sweep.type;
    if (!groups.has(key)) {
      groups.set(key, {
        side: sweep.side,
        type: sweep.type,
        count: 0,
      });
    }
    groups.get(key).count += 1;
  }
  const groupLines = Array.from(groups.values()).map(
    (group) => (
      '  - 类型：' + sweepTypeText(group.type) +
      ' ×' + group.count
    )
  );

  return [
    '✓ 已扫流动性，共' + sweeps.length + '项',
    ...groupLines,
    '  最新扫取：',
    ...sweepDetailLines(newest, '  '),
  ].join('\n');
}

function displacementText(displacement) {
  if (!displacement) {
    return '□ 等待位移确认';
  }
  const direction = displacement.direction === 'BULLISH'
    ? '向上'
    : displacement.direction === 'BEARISH'
      ? '向下'
      : '方向不明';
  const strength = Number.isFinite(displacement.strength)
    ? '，强度 ' + displacement.strength.toFixed(2)
    : '';
  return '✓ 已确认' + direction + '位移' + strength;
}

function mssText(mss) {
  if (!mss) return '□ 等待市场结构转换';
  return mss.direction === 'BULLISH'
    ? '✓ 已确认市场结构向上转换'
    : mss.direction === 'BEARISH'
      ? '✓ 已确认市场结构向下转换'
      : '□ 市场结构转换方向不明确';
}

function potentialText(observation) {
  if (!observation) return '暂无';
  if (observation.state === 'POTENTIAL_LONG_OBSERVATION') {
    return '潜在偏多观察';
  }
  if (observation.state === 'POTENTIAL_SHORT_OBSERVATION') {
    return '潜在偏空观察';
  }
  return '暂无';
}

function roadmapNumber(index) {
  const symbols = [
    '①', '②', '③', '④', '⑤',
    '⑥', '⑦', '⑧', '⑨', '⑩',
  ];
  return symbols[index] || (index + 1) + '.';
}

function liquidityRoadmapLines(roadmap) {
  if (!Array.isArray(roadmap) || roadmap.length === 0) {
    return ['暂无明确流动性路线。'];
  }
  return roadmap.map((item, index) => {
    const type = LIQUIDITY_TYPE_TEXT[item.type] ||
      item.type ||
      '其他流动性';
    const distance = Number.isFinite(item.distancePercent)
      ? item.distancePercent.toFixed(2)
      : '--';
    return roadmapNumber(index) + ' ' + type +
      '（距离' + distance + '%）';
  });
}

function manualView(h4, delivery, observation) {
  const timeframe = deliveryTimeframeText(delivery);
  if (
    observation &&
    observation.state === 'POTENTIAL_LONG_OBSERVATION'
  ) {
    return {
      view: '偏多',
      reason:
        '4H方向偏多，5m已完成卖方流动性扫取、' +
        '向上位移与向上市场结构转换；' +
        (RELATION_TEXT[delivery.relationToH4] ||
          timeframe + '关系不明确') +
        '。',
    };
  }
  if (
    observation &&
    observation.state === 'POTENTIAL_SHORT_OBSERVATION'
  ) {
    return {
      view: '偏空',
      reason:
        '4H方向偏空，5m已完成买方流动性扫取、' +
        '向下位移与向下市场结构转换；' +
        (RELATION_TEXT[delivery.relationToH4] ||
          timeframe + '关系不明确') +
        '。',
    };
  }
  if (h4.bias === 'NEUTRAL' || h4.bias === 'UNAVAILABLE') {
    return {
      view: '等待',
      reason:
        '4H方向尚未明确，5m局部事件暂不足以形成可执行叙事。',
    };
  }
  return {
    view: '等待',
    reason:
      '4H当前' + directionText(h4.bias) +
      '，但当前5m尚未形成新的同向完整确认；' +
      (RELATION_TEXT[delivery.relationToH4] ||
        timeframe + '关系不明确') +
      '。',
  };
}

function format(report) {
  const current = currentOf(report);
  const h4 = current.fourHourAnalysis;
  const delivery = deliveryAnalysisOf(current);
  const timeframe = deliveryTimeframeText(delivery);
  const fiveMinute = current.fiveMinuteObservation;
  const confirmed = fiveMinute.currentConfirmed || {};
  const observation = fiveMinute.potentialObservation;
  const judgment = manualView(h4, delivery, observation);
  const humanSummary = current.humanSummary ||
    HumanSummary.summarize(h4, delivery, fiveMinute);
  const relation = RELATION_TEXT[delivery.relationToH4] ||
    '与4H关系不明确';
  const location = LOCATION_TEXT[h4.premiumDiscount] ||
    '位置不明确';
  const deliveryLines = timeframe === '15m'
    ? [
      '2. 15分钟状态',
      '- 状态：' + fifteenMinuteStatusText(delivery),
      '- 与4H关系：' + relation,
    ]
    : [
      '2. ' + timeframe + ' Delivery',
      '- 当前方向：' +
        directionText(delivery.deliveryDirection),
      '- 与4H关系：' + relation,
      '- 当前阶段解释：' + deliveryStageText(delivery),
    ];

  return [
    '【ICT市场分析】',
    '',
    '时间：' + BeijingTime.formatBeijingTime(current.asOf),
    '',
    '1. 4H HTF Bias',
    '- 结构：' + structureText(h4),
    '- Bias：' + directionText(h4.bias),
    '- 主要流动性目标：' +
      primaryDrawText(h4.primaryDraw),
    '- Premium/Discount：' + location,
    '',
    ...deliveryLines,
    '',
    '3. 【5分钟确认】',
    sweepText(confirmed.liquiditySweeps),
    mssText(confirmed.mss),
    displacementText(confirmed.displacement),
    '- 当前观察：' + potentialText(observation),
    '',
    '【流动性路线】',
    ...liquidityRoadmapLines(current.liquidityRoadmap),
    '',
    '4. 当前人工判断',
    '- 市场状态解读：' + humanSummary,
    '- 偏多/偏空/等待：' + judgment.view,
    '- 关注原因：' + judgment.reason,
  ].join('\n');
}

module.exports = {
  DIRECTION_TEXT,
  LIQUIDITY_TYPE_TEXT,
  LOCATION_TEXT,
  RELATION_TEXT,
  STRUCTURE_TEXT,
  currentOf,
  deliveryAnalysisOf,
  deliveryStageText,
  deliveryTimeframeText,
  directionText,
  displacementText,
  fifteenMinuteStatusText,
  format,
  manualView,
  mssText,
  potentialText,
  primaryDrawText,
  eventTimeText,
  latestSweep,
  liquidityRoadmapLines,
  roadmapNumber,
  sweepDetailLines,
  sweepFormationTime,
  structureText,
  sweepSideText,
  sweepText,
  sweepTypeText,
};
