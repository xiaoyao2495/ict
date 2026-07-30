'use strict';

const CLUSTER_DISTANCE_PERCENT = 0.2;
const MAX_PRIMARY_TARGETS = 3;
const MAX_COUNTER_RISKS = 2;

const SPECIAL_TYPES = new Set([
  'PDH',
  'PDL',
  'PWH',
  'PWL',
]);

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

const TIMEFRAME_RANK = Object.freeze({
  '1W': 6,
  '1D': 5,
  '4H': 4,
  '1H': 3,
  '15m': 2,
  '5m': 1,
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

function isSwingType(type) {
  return /_SWING_(?:HIGH|LOW)$/.test(type || '');
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

function distanceValue(price, currentPrice) {
  return Math.abs(price - currentPrice);
}

function priceSeparationPercent(left, right) {
  const reference = Math.max(
    Math.abs(left),
    Math.abs(right)
  );
  if (reference === 0) return left === right ? 0 : Infinity;
  return Math.abs(left - right) / reference * 100;
}

function samePriceRegion(left, right) {
  return priceSeparationPercent(left, right) <
    CLUSTER_DISTANCE_PERCENT;
}

function recencyValue(level) {
  for (const field of [
    'availableIndex',
    'activeFrom',
    'formedIndex',
    'confirmationIndex',
    'time',
  ]) {
    if (Number.isFinite(level[field])) {
      return level[field];
    }
  }
  return -Infinity;
}

function uniqueSpecialLiquidity(levels) {
  const selected = new Map();
  const ordinary = [];
  levels.forEach((level, order) => {
    if (!SPECIAL_TYPES.has(level.type)) {
      ordinary.push(level);
      return;
    }
    const previous = selected.get(level.type);
    const candidate = {
      level,
      order,
      recency: recencyValue(level),
    };
    if (
      !previous ||
      candidate.recency > previous.recency ||
      (
        candidate.recency === previous.recency &&
        candidate.order > previous.order
      )
    ) {
      selected.set(level.type, candidate);
    }
  });
  return ordinary.concat(
    [...selected.values()].map((item) => item.level)
  );
}

function dedupeKey(item) {
  return [
    item.type,
    item.timeframe,
    item.side,
    item.price,
  ].join('|');
}

function normalizeLevels(levels) {
  const seen = new Set();
  const result = [];
  uniqueSpecialLiquidity(
    levels.filter(isUsable)
  ).forEach((level, order) => {
    const side = sideOf(level);
    if (!side) return;
    const item = {
      type: level.type,
      timeframe: timeframeOf(level),
      price: level.price,
      priority: LIQUIDITY_PRIORITY[level.type] || 0,
      side,
      zoneLow: level.price,
      zoneHigh: level.price,
      liquidityCount: 1,
      mergedTypes: [level.type],
      mergedTimeframes: [timeframeOf(level)],
      _availableIndex: recencyValue(level),
      _order: order,
    };
    const key = dedupeKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function earlierRepresentative(left, right) {
  if (left._availableIndex !== right._availableIndex) {
    return left._availableIndex < right._availableIndex
      ? left
      : right;
  }
  return left._order <= right._order ? left : right;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function mergeZone(representative, members) {
  const all = members || [representative];
  return {
    ...representative,
    zoneLow: Math.min(...all.map((item) => item.zoneLow)),
    zoneHigh: Math.max(...all.map((item) => item.zoneHigh)),
    liquidityCount: all.reduce(
      (total, item) => total + item.liquidityCount,
      0
    ),
    mergedTypes: uniqueValues(
      all.flatMap((item) => item.mergedTypes)
    ),
    mergedTimeframes: uniqueValues(
      all.flatMap((item) => item.mergedTimeframes)
    ),
  };
}

function clusterSwingLiquidity(items) {
  const groups = new Map();
  const result = items.filter(
    (item) => !isSwingType(item.type)
  );
  for (const item of items) {
    if (!isSwingType(item.type)) continue;
    const key = item.timeframe + '|' + item.side;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const group of groups.values()) {
    const remaining = group.slice().sort(
      (left, right) => (
        left.price - right.price ||
        left._availableIndex - right._availableIndex ||
        left._order - right._order
      )
    );
    while (remaining.length > 0) {
      const anchor = remaining.shift();
      const members = [anchor];
      for (
        let index = remaining.length - 1;
        index >= 0;
        index -= 1
      ) {
        if (
          samePriceRegion(
            anchor.price,
            remaining[index].price
          )
        ) {
          members.push(remaining[index]);
          remaining.splice(index, 1);
        }
      }
      const representative = members.reduce(
        earlierRepresentative
      );
      result.push(mergeZone(representative, members));
    }
  }
  return result;
}

function timeframeRank(item) {
  return TIMEFRAME_RANK[item.timeframe] || 0;
}

function preferHigherTimeframe(items) {
  const ordered = items.slice().sort((left, right) => (
    timeframeRank(right) - timeframeRank(left) ||
    right.priority - left.priority ||
    left._availableIndex - right._availableIndex ||
    left._order - right._order
  ));
  const retained = [];

  for (const candidate of ordered) {
    const covering = retained.find((item) => (
      item.side === candidate.side &&
      item.timeframe !== candidate.timeframe &&
      samePriceRegion(item.price, candidate.price)
    ));
    if (!covering) {
      retained.push(candidate);
      continue;
    }
    const index = retained.indexOf(covering);
    retained[index] = mergeZone(
      covering,
      [covering, candidate]
    );
  }
  return retained;
}

function roadmapSort(left, right) {
  const distanceDifference =
    left.distancePercent - right.distancePercent;
  if (distanceDifference !== 0) return distanceDifference;
  const priorityDifference =
    right.priority - left.priority;
  if (priorityDifference !== 0) return priorityDifference;
  return (
    timeframeRank(right) - timeframeRank(left) ||
    left.type.localeCompare(right.type)
  );
}

function publicItem(item, currentPrice, h4Bias) {
  const directionAligned = alignsWithBias(
    item,
    h4Bias,
    currentPrice
  );
  return {
    type: item.type,
    timeframe: item.timeframe,
    price: item.price,
    distanceValue: distanceValue(
      item.price,
      currentPrice
    ),
    distancePercent: distancePercent(
      item.price,
      currentPrice
    ),
    priority: item.priority,
    side: item.side,
    directionAligned,
    category: directionAligned
      ? 'PRIMARY_TARGET'
      : 'COUNTER_RISK',
    zoneLow: item.zoneLow,
    zoneHigh: item.zoneHigh,
    liquidityCount: item.liquidityCount,
    mergedTypes: item.mergedTypes.slice(),
    mergedTimeframes: item.mergedTimeframes.slice(),
  };
}

function limitRoadmap(items, h4Bias) {
  if (h4Bias !== 'BULLISH' && h4Bias !== 'BEARISH') {
    return items
      .slice()
      .sort(roadmapSort)
      .slice(0, MAX_PRIMARY_TARGETS)
      .map((item) => ({
        ...item,
        category: 'PRIMARY_TARGET',
      }));
  }
  const primary = items
    .filter((item) => item.directionAligned)
    .sort(roadmapSort)
    .slice(0, MAX_PRIMARY_TARGETS)
    .map((item) => ({
      ...item,
      category: 'PRIMARY_TARGET',
    }));
  const counter = items
    .filter((item) => !item.directionAligned)
    .sort(roadmapSort)
    .slice(0, MAX_COUNTER_RISKS)
    .map((item) => ({
      ...item,
      category: 'COUNTER_RISK',
    }));
  return primary.concat(counter);
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
  const normalized = normalizeLevels(levels);
  const clustered = clusterSwingLiquidity(normalized);
  const preferred = preferHigherTimeframe(clustered);
  const roadmap = preferred.map(
    (item) => publicItem(item, currentPrice, h4Bias)
  );
  return limitRoadmap(roadmap, h4Bias);
}

module.exports = {
  CLUSTER_DISTANCE_PERCENT,
  LIQUIDITY_PRIORITY,
  MAX_COUNTER_RISKS,
  MAX_PRIMARY_TARGETS,
  SPECIAL_TYPES,
  TIMEFRAME_RANK,
  TYPE_TIMEFRAME,
  alignsWithBias,
  analyze,
  clusterSwingLiquidity,
  dedupeKey,
  distancePercent,
  distanceValue,
  isSwingType,
  isUsable,
  limitRoadmap,
  mergeZone,
  normalizeLevels,
  preferHigherTimeframe,
  priceSeparationPercent,
  recencyValue,
  samePriceRegion,
  sideOf,
  timeframeOf,
  uniqueSpecialLiquidity,
};
