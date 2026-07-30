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
  EQUAL_LOW: 'Equal Low',
  PDH: 'PDH',
  PWH: 'PWH',
  H4_SWING_HIGH: 'H4 Swing High',
  EQUAL_HIGH: 'Equal High',
});

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

function opportunityDirection(input) {
  const opportunity = input.opportunity || {};
  const h4Bias = input.h4 && input.h4.bias;
  const direction = (
    h4Bias === 'BULLISH' || h4Bias === 'BEARISH'
  )
    ? h4Bias
    : opportunity.direction;
  if (direction === 'BULLISH') return 'LONG';
  if (direction === 'BEARISH') return 'SHORT';
  return 'NONE';
}

function opportunityLiquidityText(input) {
  const opportunity = input.opportunity || {};
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
  if (direction === 'LONG') {
    return 'PDL / PWL / H4 Swing Low / Equal Low';
  }
  if (direction === 'SHORT') {
    return 'PDH / PWH / H4 Swing High / Equal High';
  }
  return '等待4H方向明确';
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

function opportunityStage(input) {
  const opportunity = input.opportunity || {};
  const direction = opportunityDirection(input);
  const confirmationStatus =
    fiveMinuteConfirmationStatus(input.fiveMinute);
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
    opportunity.status === 'WATCH_ZONE' &&
    hasExpectedOpportunitySweep(input)
  ) {
    return {
      status: 'CONFIRMING',
      text: '等待MSS/Displacement',
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
  const direction = opportunityDirection(input);
  if (direction === 'LONG') {
    return 'Sell Side Liquidity Sweep → ' +
      'Bullish MSS → Bullish Displacement';
  }
  if (direction === 'SHORT') {
    return 'Buy Side Liquidity Sweep → ' +
      'Bearish MSS → Bearish Displacement';
  }
  return '等待4H Bias明确 → Sweep → MSS → Displacement';
}

function opportunityObservationLines(input) {
  const direction = opportunityDirection(input);
  const h4Reason = direction === 'LONG'
    ? '4H Bias bullish'
    : direction === 'SHORT'
      ? '4H Bias bearish'
      : '4H Bias unclear';
  const stage = opportunityStage(input);
  return [
    '【交易机会观察】',
    '方向：' + direction,
    'HTF原因：' + h4Reason,
    '关注流动性：' + opportunityLiquidityText(input),
    '当前阶段：' + stage.status + '：' + stage.text,
    '下一步路径：' + opportunityPath(input),
  ];
}

function summarizeTraderContext(input) {
  input = input || {};
  const narrative = input.narrative ||
    analyzeNarrative(input);
  const opportunityLines = input.opportunity
    ? [
      '',
      ...opportunityObservationLines(input),
    ]
    : [];

  return [
    '【当前市场环境】',
    ...narrative.marketEnvironment,
    ...opportunityLines,
    '',
    '【已完成事件】',
    ...narrative.completedEvents.map(
      (event) => '- ' + event
    ),
    '',
    '【下一步等待路径】',
    narrative.nextScenario,
    '',
    '【等待原因】',
    narrative.waitingReason,
  ].join('\n');
}

module.exports = {
  LIQUIDITY_TYPE_TEXT,
  OPPORTUNITY_LIQUIDITY_TEXT,
  SETUP_STAGES,
  alignmentText,
  analyzeNarrative,
  analyzeSetupStage,
  completedEventTexts,
  confirmationState,
  fiveMinuteConfirmationStatus,
  fiveMinuteStatusText,
  focusDirection,
  hasConfirmedLtf,
  hasDirectionalH4,
  h4DirectionText,
  keyReasons,
  liquidityTypeText,
  ltfNarrativeState,
  nextScenario,
  opportunityDirection,
  opportunityLiquidityText,
  opportunityObservationLines,
  opportunityPath,
  opportunityStage,
  percentText,
  positionZoneText,
  positionWaitingNarrative,
  setupStageText,
  summarize,
  summarizeTraderContext,
  waitingReason,
};
