'use strict';

const LIQUIDITY_PRIORITY = Object.freeze({
  PDH: 7,
  PDL: 7,
  PWH: 6,
  PWL: 6,
  EQUAL_HIGH: 5,
  EQUAL_LOW: 5,
  H4_SWING_HIGH: 4,
  H4_SWING_LOW: 4,
  H1_SWING_HIGH: 3,
  H1_SWING_LOW: 3,
  M15_SWING_HIGH: 2,
  M15_SWING_LOW: 2,
  LTF_SWING_HIGH: 1,
  LTF_SWING_LOW: 1,
});

const TYPE_TIMEFRAME = Object.freeze({
  PWH: '1W',
  PWL: '1W',
  PDH: '1D',
  PDL: '1D',
  H4_SWING_HIGH: '4H',
  H4_SWING_LOW: '4H',
  H1_SWING_HIGH: '1H',
  H1_SWING_LOW: '1H',
  M15_SWING_HIGH: '15m',
  M15_SWING_LOW: '15m',
  LTF_SWING_HIGH: '5m',
  LTF_SWING_LOW: '5m',
});

function sideOf(level) {
  if (level.side === 'BUY_SIDE' ||
      level.side === 'SELL_SIDE') {
    return level.side;
  }
  if (
    level.type === 'PWH' ||
    level.type === 'PDH' ||
    /(?:HIGH)$/.test(level.type || '')
  ) {
    return 'BUY_SIDE';
  }
  if (
    level.type === 'PWL' ||
    level.type === 'PDL' ||
    /(?:LOW)$/.test(level.type || '')
  ) {
    return 'SELL_SIDE';
  }
  return null;
}

function timeframeOf(level) {
  return level.timeframe ||
    TYPE_TIMEFRAME[level.type] ||
    null;
}

function isUsable(level) {
  if (!level || typeof level !== 'object') return false;
  if (!level.type || !Number.isFinite(level.price)) return false;
  return (
    level.status === undefined ||
    level.status === null ||
    level.status === 'ACTIVE'
  );
}

function alignsWithBias(level, h4Bias, currentPrice) {
  const side = sideOf(level);
  if (h4Bias === 'BULLISH') {
    return side === 'BUY_SIDE' && level.price >= currentPrice;
  }
  if (h4Bias === 'BEARISH') {
    return side === 'SELL_SIDE' && level.price <= currentPrice;
  }
  return false;
}

function distancePercent(price, currentPrice) {
  return Math.abs(price - currentPrice) / currentPrice * 100;
}

function dedupeKey(item) {
  return [
    item.type,
    item.timeframe,
    item.side,
    item.price,
  ].join('|');
}

function analyze(input) {
  input = input || {};
  const currentPrice = input.currentPrice;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(
      'A positive finite currentPrice is required.'
    );
  }
  const levels = Array.isArray(input.liquidity)
    ? input.liquidity
    : [];
  const h4Bias = input.h4Bias || 'NEUTRAL';
  const seen = new Set();
  const roadmap = [];

  for (const level of levels) {
    if (!isUsable(level)) continue;
    const side = sideOf(level);
    if (!side) continue;
    const item = {
      type: level.type,
      timeframe: timeframeOf(level),
      price: level.price,
      distancePercent: distancePercent(
        level.price,
        currentPrice
      ),
      priority: LIQUIDITY_PRIORITY[level.type] || 0,
      side,
      directionAligned: alignsWithBias(
        level,
        h4Bias,
        currentPrice
      ),
    };
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    roadmap.push(item);
  }

  return roadmap.sort((left, right) => {
    if (left.directionAligned !== right.directionAligned) {
      return left.directionAligned ? -1 : 1;
    }
    const distanceDifference =
      left.distancePercent - right.distancePercent;
    if (distanceDifference !== 0) return distanceDifference;
    const priorityDifference =
      right.priority - left.priority;
    if (priorityDifference !== 0) return priorityDifference;
    return left.type.localeCompare(right.type);
  });
}

module.exports = {
  LIQUIDITY_PRIORITY,
  TYPE_TIMEFRAME,
  alignsWithBias,
  analyze,
  distancePercent,
  isUsable,
  sideOf,
  timeframeOf,
};
