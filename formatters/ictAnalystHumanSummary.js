'use strict';

const LIQUIDITY_TYPE_TEXT = Object.freeze({
  PWH: '上周高点',
  PWL: '上周低点',
  PDH: '昨日高点',
  PDL: '昨日低点',
  H4_SWING_HIGH: '4小时摆动高点',
  H4_SWING_LOW: '4小时摆动低点',
  H1_SWING_HIGH: '1小时摆动高点',
  H1_SWING_LOW: '1小时摆动低点',
  LTF_SWING_HIGH: '5分钟摆动高点',
  LTF_SWING_LOW: '5分钟摆动低点',
  EQUAL_HIGH: '等高',
  EQUAL_LOW: '等低',
});

const OPPORTUNITY_LIQUIDITY_TEXT = Object.freeze({
  PDL: 'PDL',
  PWL: 'PWL',
  H4_SWING_LOW: 'H4 Swing Low',
  H1_SWING_LOW: 'H1 Swing Low',
  LTF_SWING_LOW: '5m Swing Low',
  EQUAL_LOW: 'Equal Low',
  PDH: 'PDH',
  PWH: 'PWH',
  H4_SWING_HIGH: 'H4 Swing High',
  H1_SWING_HIGH: 'H1 Swing High',
  LTF_SWING_HIGH: '5m Swing High',
  EQUAL_HIGH: 'Equal High',
});

const STRUCTURE_PHASE_DESCRIPTIONS = Object.freeze({
  UNDETERMINED: '4小时结构阶段尚未明确',
  BULLISH_CONTINUATION: '多头结构延续中',
  BEARISH_CONTINUATION: '空头结构延续中',
  BULLISH_MSS: '空头结构已被破坏，等待多头确认',
  BEARISH_MSS: '多头结构已被破坏，等待空头确认',
  BULLISH_PULLBACK:
    '多头转换回调阶段，等待Bullish BOS',
  BEARISH_PULLBACK:
    '空头转换回调阶段，等待Bearish BOS',
  BULLISH_CONFIRMED: '多头趋势已确认',
  BEARISH_CONFIRMED: '空头趋势已确认',
});

const STRUCTURE_PHASE_NEXT_EVENTS = Object.freeze({
  UNDETERMINED: '等待方向性4小时结构确认',
  BULLISH_CONTINUATION:
    '等待新的Bullish BOS或Bearish MSS',
  BEARISH_CONTINUATION:
    '等待新的Bearish BOS或Bullish MSS',
  BULLISH_MSS: '等待MSS后的Swing Low回调确认',
  BEARISH_MSS: '等待MSS后的Swing High回调确认',
  BULLISH_PULLBACK: '等待Bullish BOS',
  BEARISH_PULLBACK: '等待Bearish BOS',
  BULLISH_CONFIRMED:
    '等待后续Bullish BOS或Bearish MSS',
  BEARISH_CONFIRMED:
    '等待后续Bearish BOS或Bullish MSS',
});

function phaseDirection(state) {
  if (String(state).indexOf('BULLISH_') === 0) {
    return 'BULLISH';
  }
  if (String(state).indexOf('BEARISH_') === 0) {
    return 'BEARISH';
  }
  return null;
}

function structurePhaseDetails(value) {
  let raw = value;
  if (raw && raw.current) raw = raw.current;
  if (typeof raw === 'string') {
    raw = { state: raw };
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  const state = raw.state ||
    raw.structurePhase ||
    'UNDETERMINED';
  return {
    state,
    direction: raw.direction || phaseDirection(state),
    context: raw.context || null,
    sourceEvent: raw.sourceEvent || null,
    mssEvent: raw.mssEvent || null,
    confirmationBos: raw.confirmationBos || null,
  };
}

function structurePhaseDescription(state) {
  return STRUCTURE_PHASE_DESCRIPTIONS[state] ||
    '4小时结构阶段尚未明确';
}

function structurePhaseNextEvent(state) {
  return STRUCTURE_PHASE_NEXT_EVENTS[state] ||
    '等待新的4小时结构事件';
}

function structureEventText(event) {
  if (!event) return null;
  const details = [];
  if (event.breakType) details.push(event.breakType);
  if (Number.isFinite(event.level)) {
    details.push('结构位：' + event.level);
  }
  return String(event.type || 'UNKNOWN_STRUCTURE_EVENT') +
    (details.length > 0
      ? '（' + details.join('，') + '）'
      : '');
}

function sameStructureEvent(left, right) {
  if (!left || !right) return false;
  return (
    left === right ||
    (
      left.type === right.type &&
      left.breakIndex === right.breakIndex &&
      left.availableIndex === right.availableIndex
    )
  );
}

function structureSourceLines(details) {
  const lines = [];
  if (details.mssEvent) {
    lines.push(
      '来源MSS：' +
      structureEventText(details.mssEvent)
    );
  }
  if (details.confirmationBos) {
    lines.push(
      '来源BOS：' +
      structureEventText(details.confirmationBos)
    );
  }
  if (
    details.sourceEvent &&
    !sameStructureEvent(
      details.sourceEvent,
      details.mssEvent
    ) &&
    !sameStructureEvent(
      details.sourceEvent,
      details.confirmationBos
    )
  ) {
    const type = String(details.sourceEvent.type || '');
    const label = type.endsWith('_MSS')
      ? '来源MSS：'
      : type.endsWith('_BOS')
        ? '来源BOS：'
        : '来源结构事件：';
    lines.push(
      label + structureEventText(details.sourceEvent)
    );
  }
  return lines.length > 0
    ? lines
    : ['来源MSS/BOS：暂无'];
}

function structurePhaseSectionLines(value) {
  const details = structurePhaseDetails(value);
  return [
    '【4小时结构阶段】',
    '状态：' + details.state,
    '方向：' + (details.direction || '--'),
    '上下文：' + (details.context || '--'),
    '当前阶段说明：' +
      structurePhaseDescription(details.state),
    ...structureSourceLines(details),
    '下一等待事件：' +
      structurePhaseNextEvent(details.state),
  ];
}

function htfAlignmentSectionLines(value) {
  const alignment = value && typeof value === 'object'
    ? value
    : {
      status: 'UNDETERMINED',
      biasDirection: null,
      structureDirection: null,
      reason: 'HTF一致性尚未分析',
    };
  return [
    '【HTF Alignment】',
    '状态：' + (alignment.status || 'UNDETERMINED'),
    'Bias方向：' +
      (alignment.biasDirection || '--'),
    '结构方向：' +
      (alignment.structureDirection || '--'),
    '说明：' +
      (alignment.reason || 'HTF一致性尚未分析'),
  ];
}

function ltfNarrativeState(fiveMinute) {
  const confirmed = fiveMinute &&
    fiveMinute.currentConfirmed
    ? fiveMinute.currentConfirmed
    : {};
  const sweeps = Array.isArray(confirmed.liquiditySweeps)
    ? confirmed.liquiditySweeps
    : [];
  const displacement = confirmed.displacement;
  const mss = confirmed.mss;
  const hasAnyEvent = (
    sweeps.length > 0 ||
    Boolean(displacement) ||
    Boolean(mss)
  );

  if (
    sweeps.length === 0 ||
    !displacement ||
    !mss
  ) {
    return hasAnyEvent ? 'INCOMPLETE' : 'NONE';
  }

  const sides = new Set(sweeps.map((sweep) => sweep.side));
  if (
    sides.size === 1 &&
    sides.has('SELL_SIDE') &&
    displacement.direction === 'BULLISH' &&
    mss.direction === 'BULLISH'
  ) {
    return 'ALIGNED_BULLISH';
  }
  if (
    sides.size === 1 &&
    sides.has('BUY_SIDE') &&
    displacement.direction === 'BEARISH' &&
    mss.direction === 'BEARISH'
  ) {
    return 'ALIGNED_BEARISH';
  }
  return 'CONFLICT';
}

function confirmationState(h4, fiveMinute) {
  const observation = fiveMinute &&
    fiveMinute.potentialObservation;
  const state = observation && observation.state;

  if (
    h4.bias === 'BULLISH' &&
    state === 'POTENTIAL_LONG_OBSERVATION'
  ) {
    return 'ALIGNED';
  }
  if (
    h4.bias === 'BEARISH' &&
    state === 'POTENTIAL_SHORT_OBSERVATION'
  ) {
    return 'ALIGNED';
  }
  if (
    state === 'POTENTIAL_LONG_OBSERVATION' ||
    state === 'POTENTIAL_SHORT_OBSERVATION'
  ) {
    return 'CONFLICT';
  }
  return 'NONE';
}

function summarize(h4, delivery, fiveMinute) {
  h4 = h4 || {};
  if (fiveMinute === undefined) {
    fiveMinute = delivery || {};
    const confirmation = fiveMinute &&
      fiveMinute.currentConfirmed &&
      fiveMinute.currentConfirmed.confirmation;
    if (
      h4.bias !== 'BULLISH' &&
      h4.bias !== 'BEARISH'
    ) {
      return '等待4小时方向明确。';
    }
    if (!confirmation) {
      return (
        (h4.bias === 'BULLISH'
          ? '4H结构保持多头'
          : '4H结构保持空头') +
        '，等待5分钟确认。'
      );
    }
    if (confirmation.direction !== h4.bias) {
      return '4H方向与5m确认方向存在冲突。';
    }
    return (
      (h4.bias === 'BULLISH'
        ? '4H结构保持多头'
        : '4H结构保持空头') +
      '，5m已形成同向完整确认。'
    );
  }
  delivery = delivery || {};
  fiveMinute = fiveMinute || {};
  const timeframe = '1H';

  if (
    h4.bias !== 'BULLISH' &&
    h4.bias !== 'BEARISH'
  ) {
    return '4H方向尚未明确，5m局部事件暂不足以形成可执行叙事。';
  }

  const structure = h4.bias === 'BULLISH'
    ? '4H结构保持多头'
    : '4H结构保持空头';
  const relation = delivery.relationToH4;
  const ltfNarrative = ltfNarrativeState(fiveMinute);
  const confirmation = confirmationState(h4, fiveMinute);

  if (ltfNarrative === 'CONFLICT') {
    const delivery = relation === 'ALIGNED'
      ? timeframe + '正在顺应4H方向交付'
      : relation === 'RETRACEMENT'
        ? timeframe + '目前处于回调阶段'
        : relation === 'COUNTER_TREND'
          ? timeframe + '正在呈现逆向交付'
          : timeframe + '方向暂不清晰';
    return (
      structure + '，' + delivery + '。' +
      '5m已出现局部结构事件，但扫取方向、位移方向与' +
      '市场结构转换方向' +
      '未形成一致叙事。'
    );
  }

  if (relation === 'RETRACEMENT') {
    if (confirmation === 'ALIGNED') {
      return (
        structure +
        '，' + timeframe +
        '目前处于回调阶段，但5m已出现同向确认，' +
        '多周期状态正在重新收敛。'
      );
    }
    return (
      structure +
      '，但' + timeframe + '目前处于回调阶段，' +
      '等待低周期确认是否重新跟随4H方向。'
    );
  }

  if (relation === 'COUNTER_TREND') {
    if (confirmation === 'ALIGNED') {
      return (
        structure +
        '，' + timeframe +
        '仍在呈现逆向交付，5m虽已出现同向确认，' +
        '但多周期状态仍有分歧。'
      );
    }
    return (
      structure +
      '，但' + timeframe + '正在呈现逆向交付，' +
      '5m尚未提供清晰的同向确认。'
    );
  }

  if (relation === 'ALIGNED') {
    if (confirmation === 'ALIGNED') {
      return (
        structure +
        '，' + timeframe + '正在顺应4H方向交付，' +
        '5m也已出现同向确认，当前多周期状态较为一致。'
      );
    }
    if (confirmation === 'CONFLICT') {
      return (
        structure +
        '，' + timeframe + '正在顺应4H方向交付，' +
        '但5m确认方向与4H状态不一致。'
      );
    }
    return (
      structure +
      '，' + timeframe + '正在顺应4H方向交付，' +
      '但5m尚未出现新的同向确认。'
    );
  }

  if (confirmation === 'ALIGNED') {
    return (
      structure +
      '，' + timeframe +
      '方向暂不清晰，5m已出现同向确认，' +
      '当前多周期状态仍需继续观察。'
    );
  }
  return (
    structure +
    '，但' + timeframe +
    '方向暂不清晰，5m也尚未提供同向确认。'
  );
}

function h4DirectionText(h4) {
  if (h4 && h4.bias === 'BULLISH') return '偏多';
  if (h4 && h4.bias === 'BEARISH') return '偏空';
  return '方向不明确';
}

function fiveMinuteStatusText(fiveMinute, alignment) {
  const status = fiveMinuteConfirmationStatus(fiveMinute);
  if (
    alignment &&
    alignment.status === 'CONFLICT'
  ) {
    return '确认方向存在冲突';
  }
  if (status === 'CONFIRMED_BULLISH') {
    return '已形成向上完整确认';
  }
  if (status === 'CONFIRMED_BEARISH') {
    return '已形成向下完整确认';
  }
  return '等待严格事件链确认';
}

function fiveMinuteConfirmationStatus(fiveMinute) {
  const confirmation = fiveMinute &&
    fiveMinute.currentConfirmed &&
    fiveMinute.currentConfirmed.confirmation;
  if (
    !confirmation ||
    confirmation.status !== 'CONFIRMED'
  ) {
    return 'WAITING';
  }
  if (confirmation.direction === 'BULLISH') {
    return 'CONFIRMED_BULLISH';
  }
  if (confirmation.direction === 'BEARISH') {
    return 'CONFIRMED_BEARISH';
  }
  return 'WAITING';
}

function alignmentText(alignment) {
  if (!alignment) return '多周期关系不明确';
  if (alignment.status === 'ALIGNED') {
    return '多周期方向一致';
  }
  if (alignment.status === 'CONFLICT') {
    return '多周期方向存在分歧';
  }
  return '等待低周期确认';
}

function positionZoneText(positionContext) {
  const zone = positionContext &&
    positionContext.positionZone;
  if (zone === 'PREMIUM') return '溢价区';
  if (zone === 'DISCOUNT') return '折价区';
  if (zone === 'EQUILIBRIUM') return '均衡区';
  return '位置不明确';
}

function positionWaitingNarrative(h4, positionContext) {
  const bias = h4 && h4.bias;
  const zone = positionContext &&
    positionContext.positionZone;
  if (bias !== 'BULLISH' && bias !== 'BEARISH') {
    return '4H方向尚未明确，当前位置仅作为区间信息观察。';
  }
  if (bias === 'BULLISH' && zone === 'DISCOUNT') {
    return '4H偏多且价格位于折价区，等待5分钟多头确认路径完成。';
  }
  if (bias === 'BULLISH' && zone === 'PREMIUM') {
    return '4H偏多但价格位于溢价区，等待价格完成流动性处理并重新形成5分钟多头确认。';
  }
  if (bias === 'BEARISH' && zone === 'PREMIUM') {
    return '4H偏空且价格位于溢价区，等待5分钟空头确认路径完成。';
  }
  if (bias === 'BEARISH' && zone === 'DISCOUNT') {
    return '4H偏空但价格位于折价区，等待价格完成流动性处理并重新形成5分钟空头确认。';
  }
  return (
    '价格位于4H区间' +
    positionZoneText(positionContext) +
    '，等待5分钟' +
    (bias === 'BULLISH' ? '多头' : '空头') +
    '确认路径完成。'
  );
}

function focusDirection(input) {
  const h4 = input.h4 || {};
  const alignment = input.alignment || {};
  if (h4.bias !== 'BULLISH' && h4.bias !== 'BEARISH') {
    return '等待4H方向明确';
  }
  const direction = h4.bias === 'BULLISH'
    ? '多头'
    : '空头';
  if (alignment.status === 'ALIGNED') {
    return '关注多周期偏' +
      (h4.bias === 'BULLISH' ? '多' : '空') +
      '状态能否延续';
  }
  return '等待顺势' + direction + '确认';
}

const SETUP_STAGES = Object.freeze({
  WAITING_HTF: 'WAITING_HTF',
  WAITING_LTF_CONFIRMATION: 'WAITING_LTF_CONFIRMATION',
  READY_OBSERVATION: 'READY_OBSERVATION',
});

function hasDirectionalH4(h4) {
  return Boolean(
    h4 &&
    (h4.bias === 'BULLISH' || h4.bias === 'BEARISH')
  );
}

function hasConfirmedLtf(h4, fiveMinute, alignment) {
  const confirmation = fiveMinute &&
    fiveMinute.currentConfirmed &&
    fiveMinute.currentConfirmed.confirmation;
  return Boolean(
    h4 &&
    confirmation &&
    confirmation.status === 'CONFIRMED' &&
    confirmation.direction === h4.bias &&
    alignment &&
    alignment.status === 'ALIGNED'
  );
}

function analyzeSetupStage(input) {
  input = input || {};
  const h4 = input.h4 || {};
  const fiveMinute = input.fiveMinute || {};
  const alignment = input.alignment || null;
  const h4Ready = hasDirectionalH4(h4);
  const ltfReady = hasConfirmedLtf(
    h4,
    fiveMinute,
    alignment
  );

  if (!h4Ready) {
    return {
      setupStage: SETUP_STAGES.WAITING_HTF,
      missingConditions: [
        '明确的4小时方向',
        '5分钟完整确认',
      ],
    };
  }
  if (!ltfReady) {
    return {
      setupStage:
        SETUP_STAGES.WAITING_LTF_CONFIRMATION,
      missingConditions: ['5分钟完整确认'],
    };
  }
  return {
    setupStage: SETUP_STAGES.READY_OBSERVATION,
    missingConditions: [],
  };
}

function setupStageText(stage) {
  if (stage === SETUP_STAGES.WAITING_HTF) {
    return '等待4小时方向明确';
  }
  if (stage === SETUP_STAGES.WAITING_LTF_CONFIRMATION) {
    return '等待5分钟完整确认';
  }
  if (stage === SETUP_STAGES.READY_OBSERVATION) {
    return '多周期观察条件已经完整';
  }
  return '当前阶段不明确';
}

function liquidityTypeText(type) {
  return LIQUIDITY_TYPE_TEXT[type] ||
    '其他流动性';
}

function percentText(value) {
  return Number.isFinite(value)
    ? value.toFixed(2) + '%'
    : '距离不明确';
}

function keyReasons(input) {
  const roadmap = Array.isArray(input.liquidityRoadmap)
    ? input.liquidityRoadmap
    : [];
  const positionContext = input.positionContext || {};
  const alignment = input.alignment || {};
  const reasons = [];
  const routeTarget = roadmap.find(
    (item) => item.directionAligned === true
  ) || roadmap[0];

  if (routeTarget) {
    reasons.push(
      '流动性路线首先指向' +
      liquidityTypeText(routeTarget.type) +
      '，距离当前价格' +
      percentText(routeTarget.distancePercent) + '。'
    );
  } else {
    reasons.push('当前暂无明确的主要流动性路线。');
  }

  reasons.push(
    '当前价格位于' +
    positionZoneText(positionContext) + '。'
  );

  const nearest = positionContext.nearestLiquidity;
  if (
    nearest &&
    Number.isFinite(positionContext.distancePercent)
  ) {
    const nearestText = liquidityTypeText(nearest.type);
    const distance = percentText(
      positionContext.distancePercent
    );
    if (positionContext.distancePercent <= 0.5) {
      reasons.push(
        '最近的' + nearestText + '仅相距' +
        distance +
        '，价格已经接近目标流动性。'
      );
    } else {
      reasons.push(
        '最近的' + nearestText + '相距' +
        distance + '。'
      );
    }
  } else {
    reasons.push('当前位置附近暂无明确流动性目标。');
  }

  if (alignment.status === 'ALIGNED') {
    reasons.push('4H与5m方向已经形成一致状态。');
  } else if (alignment.status === 'CONFLICT') {
    reasons.push('5m确认与高周期方向存在分歧。');
  } else {
    reasons.push('5m尚未完成与高周期一致的确认。');
  }
  return reasons;
}

function completedEventTexts(fiveMinute) {
  const confirmed = fiveMinute &&
    fiveMinute.currentConfirmed
    ? fiveMinute.currentConfirmed
    : {};
  const sweeps = Array.isArray(confirmed.liquiditySweeps)
    ? confirmed.liquiditySweeps
    : [];
  const sellSideCount = sweeps.filter(
    (event) => event.side === 'SELL_SIDE'
  ).length;
  const buySideCount = sweeps.filter(
    (event) => event.side === 'BUY_SIDE'
  ).length;
  const events = [];

  if (sellSideCount > 0) {
    events.push(
      '已确认卖方流动性扫取，共' +
      sellSideCount + '项。'
    );
  }
  if (buySideCount > 0) {
    events.push(
      '已确认买方流动性扫取，共' +
      buySideCount + '项。'
    );
  }
  if (confirmed.mss) {
    events.push(
      confirmed.mss.direction === 'BULLISH'
        ? '已观测到向上市场结构转换事件。'
        : confirmed.mss.direction === 'BEARISH'
          ? '已观测到向下市场结构转换事件。'
          : '已观测到方向未明的市场结构转换事件。'
    );
  }
  if (confirmed.displacement) {
    events.push(
      confirmed.displacement.direction === 'BULLISH'
        ? '已观测到向上位移事件。'
        : confirmed.displacement.direction === 'BEARISH'
          ? '已观测到向下位移事件。'
          : '已观测到方向未明的位移事件。'
    );
  }

  const status = fiveMinuteConfirmationStatus(fiveMinute);
  if (status === 'CONFIRMED_BULLISH') {
    events.push('5分钟严格多头确认链已经完成。');
  } else if (status === 'CONFIRMED_BEARISH') {
    events.push('5分钟严格空头确认链已经完成。');
  } else if (events.length > 0) {
    events.push(
      '上述为局部事件，尚未构成同一条严格确认链。'
    );
  } else {
    events.push('当前5分钟尚无已确认的局部结构事件。');
  }
  return events;
}

function nextScenario(h4, confirmationStatus) {
  const bias = h4 && h4.bias;
  if (
    (bias === 'BULLISH' &&
      confirmationStatus === 'CONFIRMED_BULLISH') ||
    (bias === 'BEARISH' &&
      confirmationStatus === 'CONFIRMED_BEARISH')
  ) {
    return '当前5分钟确认链已完成，等待新的市场状态变化。';
  }
  if (bias === 'BULLISH') {
    return [
      '等待：',
      'Sell Side Liquidity Sweep',
      '→ Bullish MSS',
      '→ Bullish Displacement',
    ].join('\n');
  }
  if (bias === 'BEARISH') {
    return [
      '等待：',
      'Buy Side Liquidity Sweep',
      '→ Bearish MSS',
      '→ Bearish Displacement',
    ].join('\n');
  }
  return '等待：4小时方向明确';
}

function waitingReason(input, status, completedEvents) {
  const h4 = input.h4 || {};
  const alignment = input.alignment || {};
  if (!hasDirectionalH4(h4)) {
    return '4小时方向尚未明确，暂不建立方向性5分钟等待路径。';
  }
  if (
    status === 'CONFIRMED_BULLISH' ||
    status === 'CONFIRMED_BEARISH'
  ) {
    if (alignment.status === 'CONFLICT') {
      return '5分钟完整确认方向与4小时方向存在冲突，等待多周期叙事重新一致。';
    }
    return '4小时与5分钟确认方向一致，当前等待新的市场状态变化。';
  }
  if (
    completedEvents.length > 1 ||
    !completedEvents[0].startsWith('当前5分钟尚无')
  ) {
    return '5分钟已出现局部事件，但事件方向、顺序或距离尚未构成符合4小时方向的严格确认链。';
  }
  return '5分钟尚未形成符合4小时方向的流动性扫取→MSS→位移事件链。';
}

function analyzeNarrative(input) {
  input = input || {};
  const fiveMinute = input.fiveMinute || {};
  const status = fiveMinuteConfirmationStatus(fiveMinute);
  const completedEvents = completedEventTexts(fiveMinute);
  return {
    fiveMinuteConfirmationStatus: status,
    structurePhase: structurePhaseDetails(
      input.structurePhase ||
      (input.h4 && input.h4.structurePhase)
    ),
    marketEnvironment: [
      '4H方向：' + h4DirectionText(input.h4),
      '当前位置：' +
        positionZoneText(input.positionContext),
      '位置叙事：' + positionWaitingNarrative(
        input.h4,
        input.positionContext
      ),
      '5m确认状态：' + fiveMinuteStatusText(
        fiveMinute,
        input.alignment
      ),
      '多周期关系：' +
        alignmentText(input.alignment),
    ],
    completedEvents,
    nextScenario: nextScenario(input.h4, status),
    waitingReason: waitingReason(
      input,
      status,
      completedEvents
    ),
  };
}

function decisionGateOf(input) {
  const gate = input && (
    input.decisionGate ||
    (input.current && input.current.decisionGate)
  );
  return gate && typeof gate.state === 'string'
    ? gate
    : null;
}

function opportunityOf(input) {
  const gate = decisionGateOf(input);
  return gate
    ? gate.activeOpportunity || {}
    : input.opportunity || {};
}

function opportunityDirection(input) {
  const gate = decisionGateOf(input);
  const opportunity = opportunityOf(input);
  if (gate) {
    const direction = gate.direction || opportunity.direction;
    if (direction === 'BULLISH') return 'LONG';
    if (direction === 'BEARISH') return 'SHORT';
    return 'NONE';
  }
  const h4Bias = input.h4 && input.h4.bias;
  const h4Directional =
    h4Bias === 'BULLISH' || h4Bias === 'BEARISH';
  const opportunityDirectional =
    opportunity.direction === 'BULLISH' ||
    opportunity.direction === 'BEARISH';
  if (!h4Directional || !opportunityDirectional) {
    return 'NONE';
  }
  if (h4Bias === 'BULLISH') return 'LONG';
  if (h4Bias === 'BEARISH') return 'SHORT';
  return 'NONE';
}

function opportunityCandidateText(direction) {
  if (direction === 'LONG') {
    return 'PDL / PWL / H4 Swing Low / Equal Low';
  }
  if (direction === 'SHORT') {
    return 'PDH / PWH / H4 Swing High / Equal High';
  }
  return '';
}

function opportunityLiquidityText(input) {
  const opportunity = opportunityOf(input);
  if (
    OPPORTUNITY_LIQUIDITY_TEXT[
      opportunity.liquidityType
    ]
  ) {
    return OPPORTUNITY_LIQUIDITY_TEXT[
      opportunity.liquidityType
    ];
  }
  const direction = opportunityDirection(input);
  const candidates = opportunityCandidateText(direction);
  if (candidates) return candidates;
  return '等待4H方向明确';
}

function metricText(value) {
  return Number.isFinite(value)
    ? String(Number(value.toFixed(8)))
    : '--';
}

function titleCaseState(value) {
  if (!value) return 'Undetermined';
  return String(value)
    .toLowerCase()
    .split('_')
    .map((part) => (
      part.charAt(0).toUpperCase() + part.slice(1)
    ))
    .join(' ');
}

function dashboardBiasText(h4) {
  if (h4 && h4.bias === 'BULLISH') return 'Bullish';
  if (h4 && h4.bias === 'BEARISH') return 'Bearish';
  if (h4 && h4.bias === 'NEUTRAL') return 'Neutral';
  return 'Undetermined';
}

function dashboardAlignmentText(input) {
  const value = input.htfAlignment || input.alignment || {};
  if (value.status === 'ALIGNED') return 'Aligned';
  if (value.status === 'CONFLICT') return 'Conflict';
  if (value.status === 'WAITING') return 'Waiting';
  return 'Undetermined';
}

function expectedOpportunitySweep(input) {
  if (decisionGateOf(input)) return null;
  const direction = opportunityDirection(input);
  const expectedSide = direction === 'LONG'
    ? 'SELL_SIDE'
    : direction === 'SHORT'
      ? 'BUY_SIDE'
      : null;
  const confirmed = input.fiveMinute &&
    input.fiveMinute.currentConfirmed
    ? input.fiveMinute.currentConfirmed
    : {};
  const sweeps = Array.isArray(confirmed.liquiditySweeps)
    ? confirmed.liquiditySweeps
    : [];
  const matching = sweeps.filter(
    (sweep) => sweep.side === expectedSide
  );
  return matching.length > 0
    ? matching[matching.length - 1]
    : null;
}

function entryWatchData(input) {
  const opportunity = opportunityOf(input);
  const direction = opportunityDirection(input);
  const type = OPPORTUNITY_LIQUIDITY_TEXT[
    opportunity.liquidityType
  ];
  const hasSpecificLiquidity = Boolean(
    type && Number.isFinite(opportunity.price)
  );
  return {
    direction,
    paused: direction === 'NONE',
    hasSpecificLiquidity,
    liquidity: hasSpecificLiquidity ? type : null,
    candidates: opportunityCandidateText(direction),
    location: direction === 'LONG' ? '下方' : '上方',
    price: hasSpecificLiquidity
      ? opportunity.price
      : null,
  };
}

function primaryDrawData(input) {
  const draw = input.h4 && input.h4.primaryDraw;
  if (!draw) {
    return {
      type: '暂无明确目标',
      price: null,
    };
  }
  return {
    type: OPPORTUNITY_LIQUIDITY_TEXT[draw.type] ||
      draw.type ||
      '其他流动性',
    price: Number.isFinite(draw.price)
      ? draw.price
      : null,
  };
}

function hasExpectedOpportunitySweep(input) {
  const direction = opportunityDirection(input);
  const sweeps = input.fiveMinute &&
    input.fiveMinute.currentConfirmed &&
    Array.isArray(
      input.fiveMinute.currentConfirmed.liquiditySweeps
    )
    ? input.fiveMinute.currentConfirmed.liquiditySweeps
    : [];
  const expectedSide = direction === 'LONG'
    ? 'SELL_SIDE'
    : direction === 'SHORT'
      ? 'BUY_SIDE'
      : null;
  return Boolean(
    expectedSide &&
    sweeps.some((sweep) => sweep.side === expectedSide)
  );
}

function opportunityEventProgress(input) {
  const gate = decisionGateOf(input);
  if (gate) {
    const progress = gate.progress || {};
    return {
      sweepCompleted: progress.sweepCompleted === true,
      mssCompleted: progress.mssCompleted === true,
      displacementCompleted:
        progress.displacementCompleted === true,
    };
  }
  const direction = opportunityDirection(input);
  const confirmed = input.fiveMinute &&
    input.fiveMinute.currentConfirmed
    ? input.fiveMinute.currentConfirmed
    : {};
  const expectedDirection = direction === 'LONG'
    ? 'BULLISH'
    : direction === 'SHORT'
      ? 'BEARISH'
      : null;
  const sweepCompleted =
    hasExpectedOpportunitySweep(input);
  const mssCompleted = Boolean(
    sweepCompleted &&
    confirmed.mss &&
    confirmed.mss.direction === expectedDirection
  );
  const displacementCompleted = Boolean(
    mssCompleted &&
    confirmed.displacement &&
    confirmed.displacement.direction ===
      expectedDirection
  );

  return {
    sweepCompleted,
    mssCompleted,
    displacementCompleted,
  };
}

function opportunitySteps(input) {
  const direction = opportunityDirection(input);
  const watch = entryWatchData(input);
  const sweep = watch.hasSpecificLiquidity
    ? 'Sweep ' + watch.liquidity
    : 'Sweep（目标尚未锁定）';
  if (direction === 'LONG') {
    return {
      sweep,
      mss: 'Bullish MSS',
      displacement: 'Bullish Displacement',
    };
  }
  if (direction === 'SHORT') {
    return {
      sweep,
      mss: 'Bearish MSS',
      displacement: 'Bearish Displacement',
    };
  }
  return {
    sweep: 'Sweep',
    mss: 'MSS',
    displacement: 'Displacement',
  };
}

function opportunityStage(input) {
  const gate = decisionGateOf(input);
  if (gate) {
    return {
      status: gate.state,
      text: gate.reasonCode || gate.state,
    };
  }
  const opportunity = input.opportunity || {};
  const direction = opportunityDirection(input);
  const confirmationStatus =
    fiveMinuteConfirmationStatus(input.fiveMinute);
  if (direction === 'NONE') {
    return {
      status: 'WAITING',
      text: '暂停，等待4H方向明确',
    };
  }
  if (
    (direction === 'LONG' &&
      confirmationStatus === 'CONFIRMED_BULLISH') ||
    (direction === 'SHORT' &&
      confirmationStatus === 'CONFIRMED_BEARISH')
  ) {
    return {
      status: 'CONFIRMED',
      text: 'Sweep、MSS与Displacement已完成',
    };
  }
  if (
    opportunity.status === 'CONFIRMING' ||
    (
      opportunity.status === 'WATCH_ZONE' &&
      hasExpectedOpportunitySweep(input)
    )
  ) {
    const progress = opportunityEventProgress(input);
    let text = 'Sweep已完成，等待MSS/Displacement';
    if (progress.mssCompleted) {
      text = 'Sweep与MSS已完成，等待Displacement';
    }
    if (progress.displacementCompleted) {
      text = '事件已齐备，等待严格确认链成立';
    }
    return {
      status: 'CONFIRMING',
      text,
    };
  }
  if (opportunity.status === 'WATCH_ZONE') {
    return {
      status: 'WATCH_ZONE',
      text: '等待流动性扫取',
    };
  }
  return {
    status: 'WAITING',
    text: '尚未进入关键流动性观察区域',
  };
}

function opportunityPath(input) {
  const stage = opportunityStage(input);
  const steps = opportunitySteps(input);
  if (
    stage.status === 'CONFIRMED' ||
    stage.status === 'READY_OBSERVATION'
  ) {
    return 'Sweep → MSS → Displacement 已完成';
  }
  if (stage.status === 'WAITING') {
    return [
      steps.sweep,
      steps.mss,
      steps.displacement,
    ].join(' → ');
  }
  if (stage.status === 'WATCH_ZONE') {
    const watch = entryWatchData(input);
    return (
      watch.hasSpecificLiquidity
        ? '等待 ' + watch.liquidity + ' 流动性扫取'
        : '等待锁定具体' + watch.location + '流动性'
    ) + ' → ' + steps.mss +
      ' → ' + steps.displacement;
  }

  const progress = opportunityEventProgress(input);
  const remaining = [];
  if (!progress.sweepCompleted) remaining.push(steps.sweep);
  if (!progress.mssCompleted) remaining.push(steps.mss);
  if (!progress.displacementCompleted) {
    remaining.push(steps.displacement);
  }
  return remaining.length > 0
    ? remaining.join(' → ')
    : '等待严格确认链成立';
}

function opportunityObservationLines(input) {
  const direction = opportunityDirection(input);
  const stage = opportunityStage(input);
  const gate = decisionGateOf(input);
  const ready = stage.status === 'CONFIRMED' ||
    stage.status === 'READY_OBSERVATION';
  return [
    '【交易机会】',
    '方向：' + direction,
    '当前阶段：' + (
      gate ? stage.status : ready ? 'READY' : stage.status
    ),
    '',
    ...entryWatchLines(input),
    '',
    ...eventChainLines(input),
  ];
}

function dashboardHeading(number, title, options) {
  return options && options.numbered === false
    ? '【' + title + '】'
    : number + ' 【' + title + '】';
}

function entryWatchLines(input, options) {
  const watch = entryWatchData(input);
  const heading = dashboardHeading(
    '②',
    'Entry Watch',
    options
  );
  if (watch.paused) {
    return [
      heading,
      '暂停，等待4H方向明确',
    ];
  }
  if (!watch.hasSpecificLiquidity) {
    return [
      heading,
      '尚未锁定具体' + watch.location + '流动性',
      '候选类型：',
      watch.candidates,
    ];
  }
  return [
    heading,
    '等待：',
    watch.liquidity,
    metricText(watch.price),
  ];
}

function eventChainLines(input, options) {
  const progress = opportunityEventProgress(input);
  const steps = opportunitySteps(input);
  const watch = entryWatchData(input);
  const heading = dashboardHeading(
    '③',
    'Event Chain',
    options
  );
  if (watch.paused) {
    return [heading, '暂停'];
  }
  const sweep = expectedOpportunitySweep(input);
  const sweepType = sweep && sweep.type
    ? opportunityLiquidityText({
      h4: input.h4,
      opportunity: { liquidityType: sweep.type },
    })
    : watch.hasSpecificLiquidity
      ? watch.liquidity
      : '目标尚未锁定';
  const sweepPrice = sweep && Number.isFinite(sweep.price)
    ? sweep.price
    : watch.price;
  const stage = opportunityStage(input).status;
  const ready = stage === 'CONFIRMED' ||
    stage === 'READY_OBSERVATION';

  return [
    heading,
    (progress.sweepCompleted ? '✓ ' : '□ ') +
      'Sweep ' + sweepType,
    ...(sweepPrice === null
      ? []
      : ['  价格：' + metricText(sweepPrice)]),
    '',
    (progress.mssCompleted ? '✓ ' : '□ ') + steps.mss,
    '',
    (progress.displacementCompleted ? '✓ ' : '□ ') +
      steps.displacement,
    ...(ready
      ? ['', '状态：' + (
        decisionGateOf(input)
          ? 'READY_OBSERVATION'
          : 'READY'
      )]
      : []),
  ];
}

function primaryDrawLines(input, options) {
  const draw = primaryDrawData(input);
  return [
    dashboardHeading('④', 'Primary Draw', options),
    '目标：',
    draw.type,
    ...(draw.price === null
      ? []
      : [metricText(draw.price)]),
  ];
}

function nextOpportunityEvent(input) {
  const progress = opportunityEventProgress(input);
  const steps = opportunitySteps(input);
  const stage = opportunityStage(input).status;
  if (
    stage === 'CONFIRMED' ||
    stage === 'READY_OBSERVATION'
  ) {
    return 'READY';
  }
  if (!progress.sweepCompleted) return steps.sweep;
  if (!progress.mssCompleted) return steps.mss;
  if (!progress.displacementCompleted) {
    return steps.displacement;
  }
  return '等待严格确认链成立';
}

function htfDashboardLines(input) {
  const phase = structurePhaseDetails(
    input.structurePhase ||
    (input.h4 && input.h4.structurePhase)
  );
  return [
    '① 【HTF】',
    'Bias：' + dashboardBiasText(input.h4),
    'Structure：' + titleCaseState(phase.state),
    'Alignment：' + dashboardAlignmentText(input),
    '位置：' + positionZoneText(input.positionContext),
  ];
}

function decisionGateLines(input) {
  const gate = decisionGateOf(input);
  if (!gate) return [];
  const blockers = Array.isArray(gate.blockers)
    ? gate.blockers
    : [];
  return [
    '【Decision Gate】',
    '状态：',
    gate.state,
    '方向：',
    gate.direction || 'NONE',
    '原因：',
    gate.reasonCode || 'NONE',
    '阻塞：',
    blockers.length > 0 ? blockers.join(' / ') : '无',
  ];
}

function summarizeTraderContext(input) {
  input = input || {};
  const gateLines = decisionGateLines(input);
  return [
    ...htfDashboardLines(input),
    ...(gateLines.length > 0
      ? [
        '',
        '================',
        '',
        ...gateLines,
      ]
      : []),
    '',
    '================',
    '',
    ...opportunityObservationLines(input),
    '',
    '================',
    '',
    ...primaryDrawLines(input),
  ].join('\n');
}

module.exports = {
  LIQUIDITY_TYPE_TEXT,
  OPPORTUNITY_LIQUIDITY_TEXT,
  SETUP_STAGES,
  STRUCTURE_PHASE_DESCRIPTIONS,
  STRUCTURE_PHASE_NEXT_EVENTS,
  alignmentText,
  analyzeNarrative,
  analyzeSetupStage,
  completedEventTexts,
  confirmationState,
  dashboardAlignmentText,
  dashboardBiasText,
  dashboardHeading,
  decisionGateLines,
  decisionGateOf,
  entryWatchData,
  entryWatchLines,
  eventChainLines,
  expectedOpportunitySweep,
  fiveMinuteConfirmationStatus,
  fiveMinuteStatusText,
  focusDirection,
  hasConfirmedLtf,
  hasDirectionalH4,
  h4DirectionText,
  htfDashboardLines,
  htfAlignmentSectionLines,
  keyReasons,
  liquidityTypeText,
  ltfNarrativeState,
  nextScenario,
  nextOpportunityEvent,
  opportunityDirection,
  opportunityCandidateText,
  opportunityEventProgress,
  opportunityLiquidityText,
  opportunityObservationLines,
  opportunityPath,
  opportunityStage,
  opportunitySteps,
  percentText,
  primaryDrawData,
  primaryDrawLines,
  positionZoneText,
  positionWaitingNarrative,
  setupStageText,
  structureEventText,
  structurePhaseDescription,
  structurePhaseDetails,
  structurePhaseNextEvent,
  structurePhaseSectionLines,
  structureSourceLines,
  summarize,
  summarizeTraderContext,
  titleCaseState,
  waitingReason,
};
