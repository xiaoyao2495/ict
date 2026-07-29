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
  const text = direction.toLowerCase();
  return (
    '4H ' + text + ' bias + 15m ' + text +
    ' delivery + 5m ' + text + ' confirmation'
  );
}

function conflictReason(h4Bias, confirmationDirection) {
  return (
    '4H ' + h4Bias.toLowerCase() +
    ' but 5m ' +
    confirmationDirection.toLowerCase() +
    ' confirmation'
  );
}

function analyze(input) {
  input = input || {};
  const h4Bias = normalizedDirection(input.h4Bias);
  if (!h4Bias) {
    return {
      status: 'WAITING',
      direction: null,
      reason: 'HTF bias is unclear',
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
    input.m15DeliveryDirection === h4Bias &&
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
    reason:
      'Higher timeframe direction exists but lower timeframe confirmation is incomplete',
  };
}

module.exports = {
  analyze,
  alignedReason,
  confirmedDirection,
  conflictReason,
  normalizedDirection,
};
