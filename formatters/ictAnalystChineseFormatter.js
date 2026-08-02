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
  LTF_SWING_HIGH: '5分钟摆动高点',
  LTF_SWING_LOW: '5分钟摆动低点',
});

const NOTIFICATION_STATE_TEXT = Object.freeze({
  NONE: '未发现机会',
  DATA_UNAVAILABLE: '数据暂不可用',
  WAITING_HTF: '等待4小时方向确认',
  HTF_TRANSITION: '4小时结构转换中',
  HTF_CONFLICT: '4小时结构冲突',
  WAITING_OPPORTUNITY: '等待流动性机会',
  WATCH_ZONE: '进入观察区域',
  CONFIRMING: '确认中',
  READY_OBSERVATION: '确认完成，进入观察阶段',
  INVALIDATED: '机会观察已失效',
});

const NOTIFICATION_STATE_DISPLAY = Object.freeze({
  NONE: '⚪ 未发现机会',
  DATA_UNAVAILABLE: '⚪ 数据暂不可用',
  WAITING_HTF: '⚪ 等待4小时方向确认',
  HTF_TRANSITION: '🟡 4小时结构转换中',
  HTF_CONFLICT: '🔴 4小时结构冲突',
  WAITING_OPPORTUNITY: '⚪ 等待流动性机会',
  WATCH_ZONE: '🟡 观察区（Watch Zone）',
  CONFIRMING: '🟠 确认中（Confirming）',
  READY_OBSERVATION: '🟢 确认完成（Ready Observation）',
  INVALIDATED: '⚫ 机会观察已失效',
});

const NOTIFICATION_REASON_TEXT = Object.freeze({
  DATA_UNAVAILABLE: '当前分析数据暂不可用',
  OPPORTUNITY_ACTIVE: '发现潜在机会区域',
  OPPORTUNITY_WATCH_ZONE: '价格进入机会观察区域',
  WAITING_FOR_HTF_BIAS: '等待高周期方向明确',
  WAITING_FOR_HTF_ALIGNMENT: '等待高周期结构完成对齐',
  WAITING_FOR_OPPORTUNITY: '等待明确的流动性位置出现',
  HTF_STRUCTURE_CONFLICT: '高周期方向与结构阶段存在冲突',
  HTF_STRUCTURE_TRANSITION: '高周期结构正在转换',
  HTF_DIRECTION_CHANGED: '高周期方向已经变化',
  HTF_ALIGNMENT_LOST: '高周期结构不再保持一致',
  LTF_DIRECTION_CONFLICT: '低周期确认方向与高周期不一致',
  OPPORTUNITY_DIRECTION_MISMATCH: '机会方向与高周期方向不一致',
  OPPOSITE_CONFIRMATION: '出现反方向完整确认',
  OPPORTUNITY_REPLACED: '当前流动性观察区域已经更新',
  WATCH_ZONE_EXITED: '价格已离开原观察区域',
  SWEEP_COMPLETED: '目标流动性已被扫取',
  MSS_COMPLETED: '5分钟市场结构转换已经确认',
  STRICT_CONFIRMATION_COMPLETED: '完整确认链已经完成',
});

const NOTIFICATION_LIQUIDITY_TEXT = Object.freeze({
  EQUAL_HIGH: '等高点（买方流动性）',
  EQUAL_LOW: '等低点（卖方流动性）',
  PDH: '昨日高点',
  PDL: '昨日低点',
  PWH: '上周高点',
  PWL: '上周低点',
  SWING_HIGH: '摆动高点',
  SWING_LOW: '摆动低点',
  H4_SWING_HIGH: '4小时摆动高点',
  H4_SWING_LOW: '4小时摆动低点',
  H1_SWING_HIGH: '1小时摆动高点',
  H1_SWING_LOW: '1小时摆动低点',
  LTF_SWING_HIGH: '5分钟摆动高点',
  LTF_SWING_LOW: '5分钟摆动低点',
});

function deliveryAnalysisOf(current) {
  return current.oneHourAnalysis || null;
}

function deliveryTimeframeText(delivery) {
  return '1H';
}

function currentOf(report) {
  const current = report && report.current
    ? report.current
    : report;
  if (
    !current ||
    !current.fourHourAnalysis ||
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

function metricNumberText(value) {
  if (!Number.isFinite(value)) return '--';
  return String(Number(value.toFixed(8)));
}

function liquidityRoadmapLines(roadmap) {
  if (!Array.isArray(roadmap) || roadmap.length === 0) {
    return ['暂无明确流动性路线。'];
  }
  return roadmap.flatMap((item, index) => {
    const type = LIQUIDITY_TYPE_TEXT[item.type] ||
      item.type ||
      '其他流动性';
    const price = metricNumberText(item.price);
    const distanceValue = metricNumberText(
      item.distanceValue
    );
    const distancePercent = Number.isFinite(
      item.distancePercent
    )
      ? item.distancePercent.toFixed(2)
      : '--';
    return [
      roadmapNumber(index) + ' ' + type,
      '价格：' + price,
      '距离：' + distanceValue +
        '（' + distancePercent + '%）',
    ];
  });
}

function positionContextLines(positionContext, h4) {
  const value = positionContext || {};
  const zone = LOCATION_TEXT[value.positionZone] ||
    '位置不明确';
  const nearest = value.nearestLiquidity
    ? sweepTypeText(value.nearestLiquidity.type)
    : '暂无明确流动性';
  const price = metricNumberText(
    value.nearestLiquidity &&
      value.nearestLiquidity.price
  );
  const distanceValue = metricNumberText(
    value.distanceValue
  );
  const distancePercent = Number.isFinite(
    value.distancePercent
  )
    ? value.distancePercent.toFixed(2)
    : '--';
  const context = HumanSummary.positionWaitingNarrative(
    h4,
    value
  );
  return [
    '区域：' + zone,
    '最近流动性：' + nearest,
    '价格：' + price,
    '距离：' + distanceValue +
      '（' + distancePercent + '%）',
    '说明：' + context,
  ];
}

function manualView(h4, delivery, observation) {
  const relation = delivery
    ? RELATION_TEXT[delivery.relationToH4]
    : null;
  if (
    observation &&
    observation.state === 'POTENTIAL_LONG_OBSERVATION'
  ) {
    return {
      view: '偏多',
      reason:
        '4H方向偏多，5m已完成卖方流动性扫取、' +
        '向上位移与向上市场结构转换' +
        (relation ? '；' + relation : '') + '。',
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
        '向下位移与向下市场结构转换' +
        (relation ? '；' + relation : '') + '。',
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
      '，但当前5m尚未形成新的同向完整确认' +
      (relation ? '；' + relation : '') + '。',
  };
}

function ensureStructurePhaseSection(summary, structurePhase) {
  if (summary.includes('【4小时结构阶段】')) {
    return summary;
  }
  return [
    ...HumanSummary.structurePhaseSectionLines(
      structurePhase
    ),
    '',
    summary,
  ].join('\n');
}

function dashboardInput(current) {
  return {
    h4: current.fourHourAnalysis || {},
    fiveMinute: current.fiveMinuteObservation || {},
    alignment: current.alignment,
    opportunity: current.opportunity,
    liquidityRoadmap: current.liquidityRoadmap,
    positionContext: current.positionContext,
    structurePhase: current.structurePhase,
    htfAlignment: current.htfAlignment,
    decisionGate: current.decisionGate,
  };
}

function biasValueText(value) {
  return HumanSummary.dashboardBiasText({ bias: value });
}

function opportunityChangeText(input, change) {
  const currentStatus = input.opportunity &&
    input.opportunity.status;
  const previousStatus = change &&
    change.previousState &&
    change.previousState.opportunity
    ? change.previousState.opportunity.status
    : null;
  const stage = HumanSummary.opportunityStage(input).status;

  if (stage === 'CONFIRMING') {
    return '进入 CONFIRMING';
  }
  if (
    currentStatus === 'WATCH_ZONE' &&
    previousStatus !== 'WATCH_ZONE'
  ) {
    return '进入 WATCH_ZONE';
  }
  if (
    currentStatus !== 'WATCH_ZONE' &&
    previousStatus === 'WATCH_ZONE'
  ) {
    return '离开 WATCH_ZONE';
  }
  return 'Entry Watch 变化';
}

function notificationStateText(value) {
  return NOTIFICATION_STATE_TEXT[value] || '状态待确认';
}

function notificationStateDisplay(value) {
  return NOTIFICATION_STATE_DISPLAY[value] || '⚪ 状态待确认';
}

function notificationDirectionText(value) {
  if (value === 'BULLISH') return '🟢 偏多';
  if (value === 'BEARISH') return '🔴 偏空';
  if (value === 'NEUTRAL') return '⚪ 中性';
  return '⚪ 方向尚未明确';
}

function notificationReasonText(value) {
  return NOTIFICATION_REASON_TEXT[value] || '观察状态发生变化';
}

function notificationLiquidityText(value) {
  return NOTIFICATION_LIQUIDITY_TEXT[value] ||
    LIQUIDITY_TYPE_TEXT[value] ||
    '尚未锁定具体流动性';
}

function directionalMssText(direction) {
  return direction === 'BEARISH'
    ? '5分钟看跌 MSS'
    : direction === 'BULLISH'
      ? '5分钟看涨 MSS'
      : '5分钟 MSS';
}

function directionalDisplacementText(direction) {
  return direction === 'BEARISH'
    ? '看跌 Displacement'
    : direction === 'BULLISH'
      ? '看涨 Displacement'
      : 'Displacement';
}

function notificationStageText(state, progress, direction) {
  progress = progress || {};
  if (state === 'READY_OBSERVATION') {
    return '完整确认链已经完成';
  }
  if (state === 'INVALIDATED') {
    return '原机会观察生命周期已经结束';
  }
  if (state === 'HTF_CONFLICT') {
    return '暂停低周期机会观察，等待4小时结构冲突解除';
  }
  if (state === 'HTF_TRANSITION') {
    return '等待4小时结构转换完成';
  }
  if (state === 'WAITING_HTF') {
    return '等待4小时方向与结构明确';
  }
  if (state === 'WAITING_OPPORTUNITY') {
    return '等待系统锁定具体流动性位置';
  }
  if (!progress.sweepCompleted) {
    return '等待流动性被扫取';
  }
  if (!progress.mssCompleted) {
    return '流动性已扫取，等待' +
      directionalMssText(direction);
  }
  if (!progress.displacementCompleted) {
    return 'MSS 已确认，等待' +
      directionalDisplacementText(direction);
  }
  if (!progress.strictConfirmationCompleted) {
    return '位移已经出现，等待完整确认链完成';
  }
  return '完整确认链已经完成';
}

function notificationProgressLines(
  opportunity,
  progress,
  direction
) {
  progress = progress || {};
  const type = opportunity
    ? notificationLiquidityText(opportunity.liquidityType)
    : '具体流动性位置';
  return [
    '✅ 流动性位置已发现：' + type,
    (progress.sweepCompleted ? '✅ ' : '⏳ ') +
      '流动性扫取',
    (progress.mssCompleted ? '✅ ' : '⏳ ') +
      directionalMssText(direction),
    (progress.displacementCompleted ? '✅ ' : '⏳ ') +
      directionalDisplacementText(direction),
    (progress.strictConfirmationCompleted ? '✅ ' : '⏳ ') +
      '完整确认',
  ];
}

function notificationWatchLines(
  opportunity,
  progress,
  direction
) {
  progress = progress || {};
  const lines = [];
  const price = opportunity && Number.isFinite(opportunity.price)
    ? metricNumberText(opportunity.price)
    : null;
  if (!progress.sweepCompleted) {
    const side = direction === 'BEARISH'
      ? '上方'
      : direction === 'BULLISH'
        ? '下方'
        : '附近';
    lines.push(
      '是否扫取' + (price ? price : '目标价格') +
      side + '流动性'
    );
  }
  if (!progress.mssCompleted) {
    lines.push('是否形成' + directionalMssText(direction));
  }
  if (!progress.displacementCompleted) {
    lines.push('是否出现' + directionalDisplacementText(direction));
  }
  if (!progress.strictConfirmationCompleted) {
    lines.push('是否完成确认链');
  }
  if (lines.length === 0) {
    lines.push('确认链已完成，继续观察市场状态变化');
  }
  return lines.map((line, index) => (
    String(index + 1) + '. ' + line
  ));
}

function notificationOpportunityLines(opportunity) {
  if (!opportunity) return [];
  return [
    '',
    '流动性位置：',
    '📍 ' + notificationLiquidityText(
      opportunity.liquidityType
    ),
    '',
    '价格：',
    metricNumberText(opportunity.price),
  ];
}

function notificationTimeLines(current) {
  if (!current || current.asOf === undefined) return [];
  return [
    '',
    '时间：',
    BeijingTime.formatBeijingTime(current.asOf),
  ];
}

function formatDecisionGateTransition(change, current) {
  const transition = change &&
    change.decisionGateTransition;
  if (!transition || transition.changed !== true) return null;
  current = current || {};
  const currentGate = current.decisionGate || {};
  const opportunity = transition.activeOpportunity ||
    currentGate.activeOpportunity || null;
  const progress = currentGate.progress || {};
  const direction = transition.direction ||
    currentGate.direction || null;
  const lines = [
    '🔔 ' + (change.symbol || '--') + ' 机会更新',
    ...notificationTimeLines(current),
    '',
    '状态：',
    notificationStateDisplay(transition.to),
  ];
  if (transition.from !== transition.to) {
    lines.push(
      '',
      '变化：',
      notificationStateText(transition.from || 'NONE') +
        ' → ' + notificationStateText(transition.to)
    );
  }
  lines.push(
    '',
    '方向：',
    notificationDirectionText(direction),
    '',
    '原因：',
    notificationReasonText(transition.reasonCode),
    ...notificationOpportunityLines(opportunity),
    '',
    '当前阶段：',
    notificationStageText(
      transition.to,
      progress,
      direction
    )
  );
  if (opportunity) {
    lines.push(
      '',
      'ICT流程：',
      ...notificationProgressLines(
        opportunity,
        progress,
        direction
      ),
      '',
      '后续关注：',
      ...notificationWatchLines(
        opportunity,
        progress,
        direction
      )
    );
  }
  return lines.join('\n');
}

function progressMark(completed, label) {
  return (completed ? '✓ ' : '□ ') + label;
}

function progressWaitingText(progress) {
  if (!progress.sweepCompleted) {
    return 'Sweep → MSS → Displacement';
  }
  if (!progress.mssCompleted) {
    return 'MSS → Displacement';
  }
  if (!progress.displacementCompleted) {
    return 'Displacement';
  }
  if (!progress.strictConfirmationCompleted) {
    return 'Strict Confirmation';
  }
  return '完整确认已完成';
}

function progressUpdateText(transition) {
  const fields = transition.completedFields || [];
  const direction = transition.direction;
  if (fields.includes('strictConfirmationCompleted')) {
    return '完整确认链已经完成';
  }
  if (fields.includes('displacementCompleted')) {
    return directionalDisplacementText(direction) + '已经出现';
  }
  if (fields.includes('mssCompleted')) {
    return directionalMssText(direction) + '已经确认';
  }
  if (fields.includes('sweepCompleted')) {
    return '目标流动性已经被扫取';
  }
  return '确认流程继续推进';
}

function formatDecisionGateProgress(change, current) {
  const transition = change && change.decisionGateProgress;
  if (!transition || transition.changed !== true) return null;
  current = current || {};
  const progress = transition.current || {};
  const opportunity = transition.activeOpportunity ||
    current.decisionGate &&
      current.decisionGate.activeOpportunity ||
    null;
  const direction = transition.direction ||
    current.decisionGate && current.decisionGate.direction ||
    null;
  const lines = [
    '🔔 ' + (change.symbol || '--') + ' 事件更新',
    ...notificationTimeLines(current),
    '',
    '状态：',
    notificationStateDisplay(transition.state),
    '',
    '方向：',
    notificationDirectionText(direction),
    '',
    '事件进展：',
    progressUpdateText(transition),
    ...notificationOpportunityLines(opportunity),
    '',
    '当前阶段：',
    notificationStageText(
      transition.state,
      progress,
      direction
    )
  ];
  if (opportunity) {
    lines.push(
      '',
      'ICT流程：',
      ...notificationProgressLines(
        opportunity,
        progress,
        direction
      ),
      '',
      '后续关注：',
      ...notificationWatchLines(
        opportunity,
        progress,
        direction
      )
    );
  }
  return lines.join('\n');
}

function formatNotificationChange(report, reasons, change) {
  const current = currentOf(report);
  const input = dashboardInput(current);
  const decisionGateTransition =
    formatDecisionGateTransition(change, current);
  if (decisionGateTransition) {
    return decisionGateTransition;
  }
  const decisionGateProgress =
    formatDecisionGateProgress(change, current);
  if (decisionGateProgress) {
    return decisionGateProgress;
  }
  const changeReasons = Array.isArray(reasons)
    ? reasons
    : [];
  if (changeReasons.includes('INITIAL_STATE')) {
    return [
      HumanSummary.summarizeTraderContext(input),
      '',
      '================',
      '',
      '⑤ 【Liquidity Roadmap】',
      ...liquidityRoadmapLines(current.liquidityRoadmap),
    ].join('\n');
  }

  const lines = [];
  const biasChanged = changeReasons.includes(
    'H4_BIAS_CHANGED'
  );
  const alignmentChanged = changeReasons.includes(
    'ALIGNMENT_STATUS_CHANGED'
  );
  const opportunityChanged = changeReasons.includes(
    'OPPORTUNITY_CHANGED'
  );
  const confirmationChanged = changeReasons.includes(
    'CONFIRMATION_STATUS_CHANGED'
  );

  if (biasChanged) {
    const previousBias = change && change.previousState
      ? change.previousState.h4Bias
      : null;
    const currentBias = change && change.currentState
      ? change.currentState.h4Bias
      : input.h4 && input.h4.bias;
    lines.push(
      'HTF Bias：' + biasValueText(previousBias) +
      ' → ' + biasValueText(currentBias)
    );
  }
  if (alignmentChanged) {
    if (lines.length > 0) lines.push('');
    lines.push(
      'Alignment 变化：',
      HumanSummary.titleCaseState(
        current.alignment && current.alignment.status
      )
    );
  }
  if (opportunityChanged) {
    if (lines.length > 0) lines.push('');
    lines.push(opportunityChangeText(input, change));
  }

  const showEntryWatch = biasChanged || opportunityChanged;
  const showEventChain = biasChanged ||
    confirmationChanged ||
    (
      opportunityChanged &&
      HumanSummary.opportunityStage(input).status ===
        'CONFIRMING'
    );
  const showPrimaryDraw = biasChanged;

  if (showEntryWatch) {
    if (lines.length > 0) lines.push('');
    lines.push(...HumanSummary.entryWatchLines(
      input,
      { numbered: false }
    ));
  }
  if (showEventChain) {
    if (lines.length > 0) lines.push('');
    lines.push(...HumanSummary.eventChainLines(
      input,
      { numbered: false }
    ));
  }
  if (showPrimaryDraw) {
    if (lines.length > 0) lines.push('');
    lines.push(...HumanSummary.primaryDrawLines(
      input,
      { numbered: false }
    ));
  }

  if (lines.length === 0) {
    lines.push(...HumanSummary.eventChainLines(
      input,
      { numbered: false }
    ));
  }
  return lines.join('\n');
}

function format(report) {
  const current = currentOf(report);
  const input = dashboardInput(current);
  const humanSummary =
    HumanSummary.summarizeTraderContext(input);

  return [
    '【ICT市场分析】',
    '',
    '时间：' + BeijingTime.formatBeijingTime(current.asOf),
    '',
    '【交易监控面板】',
    '',
    humanSummary,
    '',
    '================',
    '',
    '⑤ 【Liquidity Roadmap】',
    ...liquidityRoadmapLines(current.liquidityRoadmap),
  ].join('\n');
}

module.exports = {
  DIRECTION_TEXT,
  LIQUIDITY_TYPE_TEXT,
  LOCATION_TEXT,
  RELATION_TEXT,
  STRUCTURE_TEXT,
  currentOf,
  biasValueText,
  dashboardInput,
  deliveryAnalysisOf,
  deliveryStageText,
  deliveryTimeframeText,
  directionText,
  displacementText,
  ensureStructurePhaseSection,
  format,
  formatDecisionGateTransition,
  formatDecisionGateProgress,
  formatNotificationChange,
  manualView,
  mssText,
  opportunityChangeText,
  potentialText,
  positionContextLines,
  progressMark,
  progressWaitingText,
  primaryDrawText,
  eventTimeText,
  latestSweep,
  liquidityRoadmapLines,
  metricNumberText,
  roadmapNumber,
  sweepDetailLines,
  sweepFormationTime,
  structureText,
  sweepSideText,
  sweepText,
  sweepTypeText,
};
