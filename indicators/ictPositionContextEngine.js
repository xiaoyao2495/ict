'use strict';

const NEAR_LIQUIDITY_PERCENT = 0.5;
const POSITION_ZONES = new Set([
  'PREMIUM',
  'DISCOUNT',
  'EQUILIBRIUM',
]);

function structureRangeOf(input) {
  return input.structureRange ||
    input.fourHourStructureRange ||
    input.h4StructureRange ||
    input.dealingRange ||
    null;
}

function positionZoneOf(
  currentPrice,
  structureRange,
  premiumDiscount
) {
  if (
    structureRange &&
    Number.isFinite(structureRange.high) &&
    Number.isFinite(structureRange.low) &&
    structureRange.high > structureRange.low
  ) {
    const equilibrium =
      (structureRange.high + structureRange.low) / 2;
    if (currentPrice > equilibrium) return 'PREMIUM';
    if (currentPrice < equilibrium) return 'DISCOUNT';
    return 'EQUILIBRIUM';
  }
  return POSITION_ZONES.has(premiumDiscount)
    ? premiumDiscount
    : 'UNKNOWN';
}

function distancePercent(price, currentPrice) {
  return Math.abs(price - currentPrice) / currentPrice * 100;
}

function distanceValue(price, currentPrice) {
  return Math.abs(price - currentPrice);
}

function nearestLiquidityOf(roadmap, currentPrice) {
  if (!Array.isArray(roadmap)) return null;
  const candidates = roadmap
    .filter((level) => (
      level &&
      typeof level === 'object' &&
      Number.isFinite(level.price)
    ))
    .map((level, order) => ({
      level,
      order,
      distanceValue: distanceValue(
        level.price,
        currentPrice
      ),
      distancePercent: distancePercent(
        level.price,
        currentPrice
      ),
    }))
    .sort((left, right) => {
      const distanceDifference =
        left.distancePercent - right.distancePercent;
      if (distanceDifference !== 0) {
        return distanceDifference;
      }
      const priorityDifference =
        (right.level.priority || 0) -
        (left.level.priority || 0);
      return priorityDifference || left.order - right.order;
    });
  if (candidates.length === 0) return null;
  return {
    ...candidates[0].level,
    distanceValue: candidates[0].distanceValue,
    distancePercent: candidates[0].distancePercent,
  };
}

function zoneText(positionZone) {
  if (positionZone === 'PREMIUM') return '价格位于溢价区';
  if (positionZone === 'DISCOUNT') return '价格位于折价区';
  if (positionZone === 'EQUILIBRIUM') {
    return '价格位于4H区间均衡位置';
  }
  return '当前4H区间位置不明确';
}

function liquidityLocationText(level, currentPrice) {
  if (level.price > currentPrice) return '上方';
  if (level.price < currentPrice) return '下方';
  return '';
}

function liquiditySideText(level) {
  if (level.side === 'BUY_SIDE') return '买方';
  if (level.side === 'SELL_SIDE') return '卖方';
  return '';
}

function contextOf(
  positionZone,
  nearestLiquidity,
  currentPrice
) {
  const position = zoneText(positionZone);
  if (!nearestLiquidity) {
    return position + '，暂无明确的主要流动性目标。';
  }
  const location = liquidityLocationText(
    nearestLiquidity,
    currentPrice
  );
  const side = liquiditySideText(nearestLiquidity);
  const target = location + side + '流动性';
  if (
    nearestLiquidity.distancePercent <=
      NEAR_LIQUIDITY_PERCENT
  ) {
    return position + '，价格接近' + target +
      '，不适合追单。';
  }
  return position + '，距离' + target + '较远。';
}

function analyze(input) {
  input = input || {};
  const currentPrice = input.currentPrice;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(
      'A positive finite currentPrice is required.'
    );
  }
  const positionZone = positionZoneOf(
    currentPrice,
    structureRangeOf(input),
    input.premiumDiscount
  );
  const nearestLiquidity = nearestLiquidityOf(
    input.liquidityRoadmap,
    currentPrice
  );
  const nearestDistance = nearestLiquidity
    ? nearestLiquidity.distancePercent
    : null;
  const nearestDistanceValue = nearestLiquidity
    ? nearestLiquidity.distanceValue
    : null;

  return {
    positionZone,
    nearestLiquidity,
    distanceValue: nearestDistanceValue,
    distancePercent: nearestDistance,
    context: contextOf(
      positionZone,
      nearestLiquidity,
      currentPrice
    ),
  };
}

module.exports = {
  NEAR_LIQUIDITY_PERCENT,
  analyze,
  contextOf,
  distancePercent,
  distanceValue,
  liquidityLocationText,
  liquiditySideText,
  nearestLiquidityOf,
  positionZoneOf,
  structureRangeOf,
  zoneText,
};
