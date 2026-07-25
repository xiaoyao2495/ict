'use strict';

const HtfBiasV2 = require('./ictHtfBiasEngineV2');

const CATEGORY_BY_TYPE = Object.freeze({
  BULLISH_FVG: 'FVG',
  BEARISH_FVG: 'FVG',
  BULLISH_OB: 'OB',
  BEARISH_OB: 'OB',
  BULLISH_BREAKER: 'BREAKER',
  BEARISH_BREAKER: 'BREAKER',
  BULLISH_BPR: 'BPR',
  BEARISH_BPR: 'BPR',
});

const COLLECTION_BY_TYPE = Object.freeze({
  BULLISH_FVG: 'bullishFvgs',
  BEARISH_FVG: 'bearishFvgs',
  BULLISH_OB: 'bullishOrderBlocks',
  BEARISH_OB: 'bearishOrderBlocks',
  BULLISH_BREAKER: 'bullishBreakers',
  BEARISH_BREAKER: 'bearishBreakers',
  BULLISH_BPR: 'bullishBprs',
  BEARISH_BPR: 'bearishBprs',
});

function directionOf(type) {
  return type.startsWith('BULLISH_') ? 'BULLISH' : 'BEARISH';
}

function createId(item) {
  return [
    item.type,
    item.originIndex,
    item.availableIndex,
    item.bottom,
    item.top,
  ].join(':');
}

function cloneBaseArrays(klines) {
  return HtfBiasV2.buildPdArrays(klines).map((item) => {
    const cloned = {
      type: item.type,
      category: CATEGORY_BY_TYPE[item.type],
      direction: directionOf(item.type),
      top: item.top,
      bottom: item.bottom,
      originIndex: item.originIndex,
      availableIndex: item.availableIndex,
      sourceIds: [],
      touchIndex: null,
    };
    cloned.id = createId(cloned);
    return cloned;
  });
}

function firstZoneTouch(item, klines, priceIndex, startIndex) {
  let start = Math.max(item.availableIndex + 1, startIndex || 0);
  while (start < klines.length) {
    const candidate = HtfBiasV2.firstRangeMatch(
      priceIndex.highs,
      start,
      (maximum) => maximum >= item.bottom
    );
    if (candidate === null) return null;
    if (klines[candidate].low <= item.top) return candidate;
    start = candidate + 1;
  }
  return null;
}

function applyTouchLifecycle(items, klines, priceIndex) {
  priceIndex = priceIndex ||
    HtfBiasV2.buildPriceRangeIndex(klines);
  for (const item of items) {
    item.touchIndex = firstZoneTouch(
      item,
      klines,
      priceIndex,
      item.availableIndex + 1
    );
  }
  return items;
}

function firstObFailure(item, klines, priceIndex) {
  let start = item.availableIndex + 1;
  const bullish = item.type === 'BULLISH_OB';
  while (start < klines.length) {
    const candidate = bullish
      ? HtfBiasV2.firstRangeMatch(
        priceIndex.lows,
        start,
        (minimum) => minimum < item.bottom
      )
      : HtfBiasV2.firstRangeMatch(
        priceIndex.highs,
        start,
        (maximum) => maximum > item.top
      );
    if (candidate === null) return null;
    const failed = bullish
      ? klines[candidate].close < item.bottom
      : klines[candidate].close > item.top;
    if (failed) return candidate;
    start = candidate + 1;
  }
  return null;
}

function deriveBreakers(baseItems, klines, priceIndex) {
  priceIndex = priceIndex ||
    HtfBiasV2.buildPriceRangeIndex(klines);
  const result = [];
  for (const item of baseItems) {
    if (item.category !== 'OB') continue;
    const failureIndex = firstObFailure(item, klines, priceIndex);
    if (!Number.isInteger(failureIndex)) continue;
    const breaker = {
      type: item.direction === 'BULLISH'
        ? 'BEARISH_BREAKER'
        : 'BULLISH_BREAKER',
      category: 'BREAKER',
      direction: item.direction === 'BULLISH'
        ? 'BEARISH'
        : 'BULLISH',
      top: item.top,
      bottom: item.bottom,
      originIndex: item.originIndex,
      availableIndex: failureIndex,
      sourceIds: [item.id],
      touchIndex: null,
    };
    breaker.id = createId(breaker);
    result.push(breaker);
  }
  return result;
}

function overlap(left, right) {
  const bottom = Math.max(left.bottom, right.bottom);
  const top = Math.min(left.top, right.top);
  return bottom < top ? { bottom, top } : null;
}

function deriveBprs(baseItems) {
  const fvgs = baseItems
    .filter((item) => item.category === 'FVG')
    .sort((left, right) => (
      left.availableIndex - right.availableIndex ||
      left.originIndex - right.originIndex
    ));
  const result = [];
  const keys = new Set();
  for (let newerIndex = 0; newerIndex < fvgs.length; newerIndex += 1) {
    const newer = fvgs[newerIndex];
    for (let olderIndex = 0; olderIndex < newerIndex; olderIndex += 1) {
      const older = fvgs[olderIndex];
      if (older.direction === newer.direction) continue;
      const zone = overlap(older, newer);
      if (!zone) continue;
      const type = newer.direction + '_BPR';
      const key = [
        type,
        older.id,
        newer.id,
        zone.bottom,
        zone.top,
      ].join(':');
      if (keys.has(key)) continue;
      keys.add(key);
      const item = {
        type,
        category: 'BPR',
        direction: newer.direction,
        top: zone.top,
        bottom: zone.bottom,
        originIndex: newer.originIndex,
        availableIndex: newer.availableIndex,
        sourceIds: [older.id, newer.id],
        touchIndex: null,
      };
      item.id = createId(item) + ':' + older.originIndex;
      result.push(item);
    }
  }
  return result;
}

function projectItem(item) {
  return {
    id: item.id,
    type: item.type,
    category: item.category,
    direction: item.direction,
    top: item.top,
    bottom: item.bottom,
    originIndex: item.originIndex,
    availableIndex: item.availableIndex,
    sourceIds: item.sourceIds.slice(),
    status: 'ACTIVE',
  };
}

function createEmptyCollections() {
  return {
    bullishFvgs: [],
    bearishFvgs: [],
    bullishOrderBlocks: [],
    bearishOrderBlocks: [],
    bullishBreakers: [],
    bearishBreakers: [],
    bullishBprs: [],
    bearishBprs: [],
  };
}

function buildTimeline(items, klines, retainStates) {
  const availableAt = new Map();
  const touchedAt = new Map();
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    if (!availableAt.has(item.availableIndex)) {
      availableAt.set(item.availableIndex, []);
    }
    availableAt.get(item.availableIndex).push(itemIndex);
    if (Number.isInteger(item.touchIndex)) {
      if (!touchedAt.has(item.touchIndex)) {
        touchedAt.set(item.touchIndex, []);
      }
      touchedAt.get(item.touchIndex).push(itemIndex);
    }
  }

  const active = new Map();
  const events = [];
  const states = [];
  for (let index = 0; index < klines.length; index += 1) {
    for (const itemIndex of availableAt.get(index) || []) {
      active.set(itemIndex, items[itemIndex]);
    }
    const touches = [];
    for (const itemIndex of touchedAt.get(index) || []) {
      const item = items[itemIndex];
      active.delete(itemIndex);
      const event = {
        arrayId: item.id,
        direction: item.direction,
        category: item.category,
        arrayType: item.type,
        top: item.top,
        bottom: item.bottom,
        index,
        availableIndex: index,
        time: klines[index].closeTime,
      };
      events.push(event);
      touches.push(event);
    }
    if (retainStates) {
      const collections = createEmptyCollections();
      for (const item of active.values()) {
        collections[COLLECTION_BY_TYPE[item.type]].push(
          projectItem(item)
        );
      }
      states.push({
        index,
        availableIndex: index,
        time: klines[index].closeTime,
        referencePrice: klines[index].close,
        ...collections,
        touches,
      });
    }
  }
  return { states, events };
}

function analyze(input) {
  input = input || {};
  const usesH4Input = Array.isArray(input.h4Klines);
  const klines = usesH4Input
    ? input.h4Klines
    : input.klines;
  const duration = usesH4Input
    ? HtfBiasV2.FOUR_HOURS
    : input.intervalMilliseconds;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      'intervalMilliseconds is required for generic PD Array input.'
    );
  }
  HtfBiasV2.validateClosedKlines(
    klines,
    duration,
    usesH4Input ? '4H' : 'PD Array'
  );
  const priceIndex = HtfBiasV2.buildPriceRangeIndex(klines);
  const baseItems = cloneBaseArrays(klines);
  applyTouchLifecycle(baseItems, klines, priceIndex);
  const breakers = deriveBreakers(baseItems, klines, priceIndex);
  applyTouchLifecycle(breakers, klines, priceIndex);
  const bprs = deriveBprs(baseItems);
  applyTouchLifecycle(bprs, klines, priceIndex);
  const items = baseItems.concat(breakers, bprs).sort(
    (left, right) => (
      left.availableIndex - right.availableIndex ||
      left.originIndex - right.originIndex ||
      left.type.localeCompare(right.type)
    )
  );
  const timeline = buildTimeline(
    items,
    klines,
    input.retainStates !== false
  );
  return {
    protocol: {
      version: 'ICT_HTF_PD_ARRAY_ENGINE_V1',
      input: usesH4Input
        ? 'Complete closed 4H Klines'
        : 'Complete closed Klines at the declared interval',
      intervalMilliseconds: duration,
      pdArrays: ['FVG', 'OB', 'BREAKER', 'BPR'],
      breakerDefinition:
        'Order Block converted after a later 4H close beyond its range',
      bprDefinition:
        'Overlap of opposite FVGs; direction follows the newer confirmed FVG',
      touchDefinition:
        'First later closed 4H candle intersecting the confirmed zone',
      usesConfirmedCandles: true,
      usesAvailableIndex: true,
      readsTrades: false,
      generatesEntry: false,
    },
    arrays: items.map(projectItem),
    states: timeline.states,
    events: {
      touches: timeline.events,
    },
  };
}

module.exports = {
  CATEGORY_BY_TYPE,
  COLLECTION_BY_TYPE,
  analyze,
  applyTouchLifecycle,
  buildTimeline,
  cloneBaseArrays,
  createEmptyCollections,
  deriveBprs,
  deriveBreakers,
  directionOf,
  firstZoneTouch,
  overlap,
};
