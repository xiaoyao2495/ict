'use strict';

function normalizedDirection(value) {
  return value === 'BULLISH' || value === 'BEARISH'
    ? value
    : null;
}

function confirmedDirection(input) {
  const direction = normalizedDirection(
    input.fiveMinuteConfirmationDirection
  );
  const status = input.fiveMinuteConfirmationStatus;
  const confirmed = (
    status === 'CONFIRMED' ||
    status === 'CONFIRMED_' + direction
  );
  return confirmed ? direction : null;
}

function alignedReason(direction) {
  return direction === 'BULLISH'
    ? '4小时与5分钟方向一致：偏多'
    : '4小时与5分钟方向一致：偏空';
}

function conflictReason(h4Bias, confirmationDirection) {
  return h4Bias === 'BULLISH'
    ? '4小时偏多，但5分钟确认偏空'
    : '4小时偏空，但5分钟确认偏多';
}

function analyze(input) {
  input = input || {};
  const h4Bias = normalizedDirection(input.h4Bias);
  if (!h4Bias) {
    return {
      status: 'WAITING',
      direction: null,
      reason: '等待4小时方向明确',
    };
  }

  const confirmationDirection =
    confirmedDirection(input);
  if (
    confirmationDirection &&
    confirmationDirection !== h4Bias
  ) {
    return {
      status: 'CONFLICT',
      direction: null,
      reason: conflictReason(
        h4Bias,
        confirmationDirection
      ),
    };
  }

  if (
    confirmationDirection === h4Bias
  ) {
    return {
      status: 'ALIGNED',
      direction: h4Bias,
      reason: alignedReason(h4Bias),
    };
  }

  return {
    status: 'WAITING',
    direction: null,
    reason: '等待5分钟确认',
  };
}

module.exports = {
  analyze,
  alignedReason,
  confirmedDirection,
  conflictReason,
  normalizedDirection,
};
