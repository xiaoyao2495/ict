'use strict';

const BULLISH_PHASES = Object.freeze([
  'BULLISH_CONTINUATION',
  'BULLISH_CONFIRMED',
  'BULLISH_PULLBACK',
]);

const BEARISH_PHASES = Object.freeze([
  'BEARISH_CONTINUATION',
  'BEARISH_CONFIRMED',
  'BEARISH_PULLBACK',
]);

function normalizeDirection(value) {
  return value === 'BULLISH' || value === 'BEARISH'
    ? value
    : null;
}

function phaseState(value) {
  let raw = value;
  if (raw && raw.current) raw = raw.current;
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') {
    return 'UNDETERMINED';
  }
  return raw.state ||
    raw.structurePhase ||
    'UNDETERMINED';
}

function structureDirection(value) {
  const phase = phaseState(value);
  if (
    BULLISH_PHASES.includes(phase) ||
    phase === 'BULLISH_MSS'
  ) {
    return 'BULLISH';
  }
  if (
    BEARISH_PHASES.includes(phase) ||
    phase === 'BEARISH_MSS'
  ) {
    return 'BEARISH';
  }
  return null;
}

function establishedDirection(phase) {
  return (
    BULLISH_PHASES.includes(phase) ||
    BEARISH_PHASES.includes(phase)
  );
}

function analyze(input) {
  input = input || {};
  const biasDirection = normalizeDirection(
    input.biasDirection === undefined
      ? input.h4Bias
      : input.biasDirection
  );
  const phase = phaseState(input.structurePhase);
  const phaseDirection = structureDirection(
    input.structurePhase
  );

  if (!biasDirection) {
    return {
      status: 'UNDETERMINED',
      biasDirection: null,
      structureDirection: phaseDirection,
      reason: '4H Bias方向尚未明确',
    };
  }
  if (!phaseDirection) {
    return {
      status: 'UNDETERMINED',
      biasDirection,
      structureDirection: null,
      reason: 'Structure Phase ' + phase +
        '尚未建立可确认方向',
    };
  }
  if (biasDirection !== phaseDirection) {
    return {
      status: 'CONFLICT',
      biasDirection,
      structureDirection: phaseDirection,
      reason: '4H Bias与Structure Phase方向冲突',
    };
  }
  if (!establishedDirection(phase)) {
    return {
      status: 'UNDETERMINED',
      biasDirection,
      structureDirection: phaseDirection,
      reason: 'Structure Phase ' + phase +
        '仍处于MSS转换阶段',
    };
  }
  return {
    status: 'ALIGNED',
    biasDirection,
    structureDirection: phaseDirection,
    reason: '4H Bias与Structure Phase方向一致',
  };
}

module.exports = {
  BEARISH_PHASES,
  BULLISH_PHASES,
  analyze,
  establishedDirection,
  normalizeDirection,
  phaseState,
  structureDirection,
};
