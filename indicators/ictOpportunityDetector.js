'use strict';

const WATCH_ZONE_DISTANCE_PERCENT = 0.5;

const BULLISH_LIQUIDITY_TYPES = Object.freeze([
  'PDL',
  'PWL',
  'H4_SWING_LOW',
  'EQUAL_LOW',
]);

const BEARISH_LIQUIDITY_TYPES = Object.freeze([
  'PDH',
  'PWH',
  'H4_SWING_HIGH',
  'EQUAL_HIGH',
]);

function distancePercent(price, currentPrice) {
  return Math.abs(price - currentPrice) /
    currentPrice * 100;
}

function configuredTypes(h4Bias) {
  if (h4Bias === 'BULLISH') {
    return BULLISH_LIQUIDITY_TYPES;
  }
  if (h4Bias === 'BEARISH') {
    return BEARISH_LIQUIDITY_TYPES;
  }
  return null;
}

function isActive(level) {
  return (
    level.status === undefined ||
    level.status === null ||
    level.status === 'ACTIVE'
  );
}

function isOnExpectedSide(level, h4Bias, currentPrice) {
  if (h4Bias === 'BULLISH') {
    return level.price <= currentPrice;
  }
  if (h4Bias === 'BEARISH') {
    return level.price >= currentPrice;
  }
  return false;
}

function eligibleLevels(
  levels,
  h4Bias,
  currentPrice
) {
  const types = configuredTypes(h4Bias);
  if (!types) return [];
  return (Array.isArray(levels) ? levels : [])
    .filter((level) => (
      level &&
      typeof level === 'object' &&
      types.includes(level.type) &&
      Number.isFinite(level.price) &&
      level.price > 0 &&
      isActive(level) &&
      isOnExpectedSide(level, h4Bias, currentPrice)
    ))
    .map((level, order) => ({
      type: level.type,
      price: level.price,
      distancePercent: distancePercent(
        level.price,
        currentPrice
      ),
      priority: types.length - types.indexOf(level.type),
      order,
    }));
}

function nearestLevel(levels) {
  if (levels.length === 0) return null;
  return levels.slice().sort((left, right) => (
    left.distancePercent - right.distancePercent ||
    right.priority - left.priority ||
    left.order - right.order
  ))[0];
}

function waitingResult(h4Bias, reason) {
  return {
    status: 'WAITING',
    direction:
      h4Bias === 'BULLISH' || h4Bias === 'BEARISH'
        ? h4Bias
        : null,
    liquidityType: null,
    price: null,
    distancePercent: null,
    reason,
  };
}

function detect(input) {
  input = input || {};
  const h4Bias = input.h4Bias || 'NEUTRAL';
  const currentPrice = input.currentPrice;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(
      'A positive finite currentPrice is required.'
    );
  }
  if (!configuredTypes(h4Bias)) {
    return waitingResult(h4Bias, 'HTF_BIAS_UNCLEAR');
  }

  const levels = Array.isArray(input.liquidity)
    ? input.liquidity
    : input.liquidityRoadmap;
  const nearest = nearestLevel(
    eligibleLevels(levels, h4Bias, currentPrice)
  );
  if (
    !nearest ||
    nearest.distancePercent >
      WATCH_ZONE_DISTANCE_PERCENT
  ) {
    return waitingResult(
      h4Bias,
      'NO_MATCHING_LIQUIDITY_WITHIN_THRESHOLD'
    );
  }

  return {
    status: 'WATCH_ZONE',
    direction: h4Bias,
    liquidityType: nearest.type,
    price: nearest.price,
    distancePercent: nearest.distancePercent,
    reason: h4Bias === 'BULLISH'
      ? 'BULLISH_PRICE_NEAR_SELL_SIDE_LIQUIDITY'
      : 'BEARISH_PRICE_NEAR_BUY_SIDE_LIQUIDITY',
  };
}

module.exports = {
  BEARISH_LIQUIDITY_TYPES,
  BULLISH_LIQUIDITY_TYPES,
  WATCH_ZONE_DISTANCE_PERCENT,
  configuredTypes,
  detect,
  distancePercent,
  eligibleLevels,
  isActive,
  isOnExpectedSide,
  nearestLevel,
  waitingResult,
};
