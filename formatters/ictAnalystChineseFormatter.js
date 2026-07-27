'use strict';

const HumanSummary = require('./ictAnalystHumanSummary');

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
  PWH: '上周高点流动性',
  PWL: '上周低点流动性',
  PDH: '前日高点流动性',
  PDL: '前日低点流动性',
  H4_SWING_HIGH: '4H摆动高点流动性',
  H4_SWING_LOW: '4H摆动低点流动性',
  EQUAL_HIGH: '等高流动性',
  EQUAL_LOW: '等低流动性',
  H1_SWING_HIGH: '1H Swing High',
  H1_SWING_LOW: '1H Swing Low',
  LTF_SWING_HIGH: 'LTF Swing High',
  LTF_SWING_LOW: 'LTF Swing Low',
});

function currentOf(report) {
  const current = report && report.current
    ? report.current
    : report;
  if (
    !current ||
    !current.fourHourAnalysis ||
    !current.oneHourAnalysis ||
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

function deliveryStageText(h1) {
  if (h1.deliveryState === 'ALIGNED_BULLISH') {
    return '1H正在顺应4H方向向上交付';
  }
  if (h1.deliveryState === 'ALIGNED_BEARISH') {
    return '1H正在顺应4H方向向下交付';
  }
  if (h1.deliveryState === 'RETRACEMENT') {
    return '1H处于相对4H方向的回撤阶段';
  }
  if (h1.deliveryState === 'COUNTER_TREND') {
    return '1H处于逆4H结构的交付阶段';
  }
  return '1H尚未形成清晰的交付阶段';
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
  if (Number.isFinite(time)) {
    return new Date(time).toISOString();
  }
  if (typeof time === 'string' && time.length > 0) {
    return time;
  }
  return '不可用';
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
    return '当前5m收盘未确认新的流动性扫取';
  }

  const newest = latestSweep(sweeps);
  const newestDetails = (
    sweepTypeText(newest.type) +
    '，availableIndex：' +
    (
      Number.isInteger(newest.availableIndex)
        ? newest.availableIndex
        : '不可用'
    ) +
    '，时间：' + eventTimeText(newest.time)
  );
  if (sweeps.length === 1) {
    return (
      '已确认扫取' + sweepSideText(newest.side) +
      '流动性：' + newestDetails
    );
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
  const sides = new Set(sweeps.map((sweep) => sweep.side));
  const sideDescription = sides.size === 1
    ? sweepSideText(sweeps[0].side)
    : '买方与卖方';
  const groupLines = Array.from(groups.values()).map(
    (group) => (
      '  - ' +
      (
        sides.size > 1
          ? sweepSideText(group.side) + ' / '
          : ''
      ) +
      sweepTypeText(group.type) +
      ' ×' + group.count
    )
  );

  return [
    '已确认扫取' + sideDescription +
      '流动性，共' + sweeps.length + '个事件',
    ...groupLines,
    '  - 最新事件：' + newestDetails,
  ].join('\n');
}

function displacementText(displacement) {
  if (!displacement) {
    return '当前5m收盘未确认新的位移';
  }
  const direction = displacement.direction === 'BULLISH'
    ? '向上'
    : displacement.direction === 'BEARISH'
      ? '向下'
      : '方向不明';
  const strength = Number.isFinite(displacement.strength)
    ? '，强度 ' + displacement.strength.toFixed(2)
    : '';
  return '已确认' + direction + '位移' + strength;
}

function mssText(mss) {
  if (!mss) return '当前5m收盘未确认新的MSS';
  return mss.direction === 'BULLISH'
    ? '已确认向上MSS'
    : mss.direction === 'BEARISH'
      ? '已确认向下MSS'
      : 'MSS方向不明确';
}

function potentialText(observation) {
  if (!observation) return 'None';
  if (observation.state === 'POTENTIAL_LONG_OBSERVATION') {
    return 'Potential Long';
  }
  if (observation.state === 'POTENTIAL_SHORT_OBSERVATION') {
    return 'Potential Short';
  }
  return 'None';
}

function manualView(h4, h1, observation) {
  if (
    observation &&
    observation.state === 'POTENTIAL_LONG_OBSERVATION'
  ) {
    return {
      view: '偏多',
      reason:
        '4H方向偏多，5m已完成卖方流动性扫取、向上位移与向上MSS；' +
        (RELATION_TEXT[h1.relationToH4] || '1H关系不明确') +
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
        '4H方向偏空，5m已完成买方流动性扫取、向下位移与向下MSS；' +
        (RELATION_TEXT[h1.relationToH4] || '1H关系不明确') +
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
      (RELATION_TEXT[h1.relationToH4] || '1H关系不明确') +
      '。',
  };
}

function format(report) {
  const current = currentOf(report);
  const h4 = current.fourHourAnalysis;
  const h1 = current.oneHourAnalysis;
  const fiveMinute = current.fiveMinuteObservation;
  const confirmed = fiveMinute.currentConfirmed || {};
  const observation = fiveMinute.potentialObservation;
  const judgment = manualView(h4, h1, observation);
  const humanSummary = current.humanSummary ||
    HumanSummary.summarize(h4, h1, fiveMinute);
  const relation = RELATION_TEXT[h1.relationToH4] ||
    '与4H关系不明确';
  const location = LOCATION_TEXT[h4.premiumDiscount] ||
    '位置不明确';

  return [
    '【ICT市场分析】',
    '',
    '1. 4H HTF Bias',
    '- 结构：' + structureText(h4),
    '- Bias：' + directionText(h4.bias),
    '- 主要流动性目标：' +
      primaryDrawText(h4.primaryDraw),
    '- Premium/Discount：' + location,
    '',
    '2. 1H Delivery',
    '- 当前方向：' + directionText(h1.deliveryDirection),
    '- 与4H关系：' + relation,
    '- 当前阶段解释：' + deliveryStageText(h1),
    '',
    '3. 5m Confirmation',
    '- Sweep：' +
      sweepText(confirmed.liquiditySweeps),
    '- Displacement：' +
      displacementText(confirmed.displacement),
    '- MSS：' + mssText(confirmed.mss),
    '- Potential Long/Short/None：' +
      potentialText(observation),
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
  deliveryStageText,
  directionText,
  displacementText,
  format,
  manualView,
  mssText,
  potentialText,
  primaryDrawText,
  eventTimeText,
  latestSweep,
  structureText,
  sweepSideText,
  sweepText,
  sweepTypeText,
};
