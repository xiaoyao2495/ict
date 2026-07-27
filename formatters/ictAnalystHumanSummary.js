'use strict';

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

function summarize(h4, h1, fiveMinute) {
  h4 = h4 || {};
  h1 = h1 || {};
  fiveMinute = fiveMinute || {};

  if (
    h4.bias !== 'BULLISH' &&
    h4.bias !== 'BEARISH'
  ) {
    return '4H方向尚未明确，5m局部事件暂不足以形成可执行叙事。';
  }

  const structure = h4.bias === 'BULLISH'
    ? '4H结构保持多头'
    : '4H结构保持空头';
  const relation = h1.relationToH4;
  const ltfNarrative = ltfNarrativeState(fiveMinute);
  const confirmation = confirmationState(h4, fiveMinute);

  if (ltfNarrative === 'CONFLICT') {
    const delivery = relation === 'ALIGNED'
      ? '1H正在顺应4H方向交付'
      : relation === 'RETRACEMENT'
        ? '1H目前处于回调阶段'
        : relation === 'COUNTER_TREND'
          ? '1H正在呈现逆向交付'
          : '1H方向暂不清晰';
    return (
      structure + '，' + delivery + '。' +
      '5m已出现局部结构事件，但扫取方向、位移方向与MSS' +
      '未形成一致叙事。'
    );
  }

  if (relation === 'RETRACEMENT') {
    if (confirmation === 'ALIGNED') {
      return (
        structure +
        '，1H目前处于回调阶段，但5m已出现同向确认，' +
        '多周期状态正在重新收敛。'
      );
    }
    return (
      structure +
      '，但1H目前处于回调阶段，' +
      '等待低周期确认是否重新跟随4H方向。'
    );
  }

  if (relation === 'COUNTER_TREND') {
    if (confirmation === 'ALIGNED') {
      return (
        structure +
        '，1H仍在呈现逆向交付，5m虽已出现同向确认，' +
        '但多周期状态仍有分歧。'
      );
    }
    return (
      structure +
      '，但1H正在呈现逆向交付，' +
      '5m尚未提供清晰的同向确认。'
    );
  }

  if (relation === 'ALIGNED') {
    if (confirmation === 'ALIGNED') {
      return (
        structure +
        '，1H正在顺应4H方向交付，' +
        '5m也已出现同向确认，当前多周期状态较为一致。'
      );
    }
    if (confirmation === 'CONFLICT') {
      return (
        structure +
        '，1H正在顺应4H方向交付，' +
        '但5m确认方向与4H状态不一致。'
      );
    }
    return (
      structure +
      '，1H正在顺应4H方向交付，' +
      '但5m尚未出现新的同向确认。'
    );
  }

  if (confirmation === 'ALIGNED') {
    return (
      structure +
      '，1H方向暂不清晰，5m已出现同向确认，' +
      '当前多周期状态仍需继续观察。'
    );
  }
  return (
    structure +
    '，但1H方向暂不清晰，5m也尚未提供同向确认。'
  );
}

module.exports = {
  confirmationState,
  ltfNarrativeState,
  summarize,
};
