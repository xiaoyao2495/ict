'use strict';

const Pivot = require('./pivot');
const Swing = require('./swing');

const ONE_HOUR = 60 * 60 * 1000;
const FOUR_HOURS = 4 * ONE_HOUR;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;
const WEEK_ANCHOR = Date.UTC(1970, 0, 5);
const EQUAL_TOLERANCE = 0.001;

const LIQUIDITY_PRIORITY = Object.freeze({
  PWH: 4,
  PWL: 4,
  PDH: 3,
  PDL: 3,
  H4_SWING_HIGH: 2,
  H4_SWING_LOW: 2,
  EQUAL_HIGH: 1,
  EQUAL_LOW: 1,
  H1_SWING_HIGH: 1,
  H1_SWING_LOW: 1,
});

function validateClosedKlines(klines, duration, label) {
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error(label + ' closed Klines are required.');
  }
  for (let index = 0; index < klines.length; index += 1) {
    const bar = klines[index];
    if (
      !Number.isFinite(bar.openTime) ||
      !Number.isFinite(bar.closeTime) ||
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close)
    ) {
      throw new Error(label + ' Kline is invalid at ' + index);
    }
    if (bar.closeTime < bar.openTime + duration - 1) {
      throw new Error(label + ' Kline is not fully closed at ' + index);
    }
    if (
      index > 0 &&
      bar.openTime - klines[index - 1].openTime !== duration
    ) {
      throw new Error(label + ' Klines must be continuous.');
    }
  }
}

function getAvailableIndex(swing) {
  if (Number.isInteger(swing.availableIndex)) {
    return swing.availableIndex;
  }
  if (Number.isInteger(swing.confirmationIndex)) {
    return swing.confirmationIndex;
  }
  return swing.index;
}

function serializeSwing(swing, klines) {
  return {
    type: swing.type === 'HIGH' ? 'SWING_HIGH' : 'SWING_LOW',
    price: swing.price,
    index: swing.index,
    availableIndex: getAvailableIndex(swing),
    time: klines[swing.index].openTime,
  };
}

function classifySwing(swing, previous) {
  if (!previous) return swing.type === 'HIGH' ? 'H' : 'L';
  if (swing.type === 'HIGH') {
    return swing.price > previous.price ? 'HH' : 'LH';
  }
  return swing.price > previous.price ? 'HL' : 'LL';
}

function resolveStructureState(highLabel, lowLabel) {
  if (highLabel === 'HH' && lowLabel === 'HL') {
    return 'BULLISH';
  }
  if (highLabel === 'LH' && lowLabel === 'LL') {
    return 'BEARISH';
  }
  return 'NEUTRAL';
}

function buildDealingRange(highSwing, lowSwing, referencePrice) {
  if (
    !highSwing ||
    !lowSwing ||
    highSwing.price <= lowSwing.price
  ) {
    return {
      high: null,
      low: null,
      equilibrium: null,
      location: 'UNKNOWN',
      highSource: null,
      lowSource: null,
      availableIndex: null,
    };
  }
  const equilibrium = (highSwing.price + lowSwing.price) / 2;
  return {
    high: highSwing.price,
    low: lowSwing.price,
    equilibrium,
    location: referencePrice > equilibrium
      ? 'PREMIUM'
      : referencePrice < equilibrium
        ? 'DISCOUNT'
        : 'EQUILIBRIUM',
    highSource: highSwing,
    lowSource: lowSwing,
    availableIndex: Math.max(
      highSwing.availableIndex,
      lowSwing.availableIndex
    ),
  };
}

function buildStructureTimeline(klines) {
  const swings = Swing.filterSwings(
    Pivot.findPivots(klines, 2, 2)
  ).map((swing, order) => ({ swing, order }))
    .sort((left, right) => {
      const availableDifference =
        getAvailableIndex(left.swing) -
        getAvailableIndex(right.swing);
      return availableDifference || left.order - right.order;
    })
    .map((item) => item.swing);
  const swingsByAvailability = {};
  for (const swing of swings) {
    const availableIndex = getAvailableIndex(swing);
    if (!swingsByAvailability[availableIndex]) {
      swingsByAvailability[availableIndex] = [];
    }
    swingsByAvailability[availableIndex].push(swing);
  }

  const sequence = [];
  const states = [];
  let previousHigh = null;
  let previousLow = null;
  let lastHighItem = null;
  let lastLowItem = null;
  let highLabel = null;
  let lowLabel = null;

  for (let index = 0; index < klines.length; index += 1) {
    for (const swing of swingsByAvailability[index] || []) {
      const previous = swing.type === 'HIGH'
        ? previousHigh
        : previousLow;
      const item = {
        label: classifySwing(swing, previous),
        type: swing.type,
        price: swing.price,
        index: swing.index,
        availableIndex: getAvailableIndex(swing),
        swing: serializeSwing(swing, klines),
      };
      sequence.push(item);
      if (swing.type === 'HIGH') {
        previousHigh = swing;
        lastHighItem = item;
        highLabel = item.label;
      } else {
        previousLow = swing;
        lastLowItem = item;
        lowLabel = item.label;
      }
    }

    const structureState = resolveStructureState(
      highLabel,
      lowLabel
    );
    const publishedSequence = sequence
      .filter((item) => (
        item.label === 'HH' ||
        item.label === 'HL' ||
        item.label === 'LH' ||
        item.label === 'LL'
      ))
      .map((item) => ({
        label: item.label,
        type: item.type,
        price: item.price,
        index: item.index,
        availableIndex: item.availableIndex,
      }));
    const lastConfirmedSwingHigh =
      lastHighItem ? lastHighItem.swing : null;
    const lastConfirmedSwingLow =
      lastLowItem ? lastLowItem.swing : null;
    const protectedLow = structureState === 'BULLISH' &&
      lastLowItem &&
      lastLowItem.label === 'HL'
      ? lastLowItem.swing
      : null;
    const protectedHigh = structureState === 'BEARISH' &&
      lastHighItem &&
      lastHighItem.label === 'LH'
      ? lastHighItem.swing
      : null;

    states.push({
      index,
      availableIndex: index,
      time: klines[index].closeTime,
      referencePrice: klines[index].close,
      structure: {
        state: structureState,
        lastConfirmedSwingHigh,
        lastConfirmedSwingLow,
        protectedHigh,
        protectedLow,
        swingSequence: publishedSequence.slice(-12),
      },
      dealingRange: buildDealingRange(
        lastConfirmedSwingHigh,
        lastConfirmedSwingLow,
        klines[index].close
      ),
    });
  }

  return {
    klines,
    rawSwings: swings,
    swings: swings.map((swing) => serializeSwing(swing, klines)),
    states,
  };
}

function samePrice(left, right) {
  const reference = Math.max(Math.abs(left), Math.abs(right));
  if (reference === 0) return left === right;
  return Math.abs(left - right) / reference <= EQUAL_TOLERANCE;
}

function periodStart(time, duration, anchor) {
  return Math.floor((time - anchor) / duration) *
    duration + anchor;
}

function aggregatePeriods(klines, duration, anchor) {
  const periods = [];
  let current = null;

  function appendComplete() {
    if (
      current &&
      current.firstOpenTime === current.start &&
      current.closeTime >= current.end - 1
    ) {
      periods.push(current);
    }
  }

  for (let index = 0; index < klines.length; index += 1) {
    const start = periodStart(
      klines[index].openTime,
      duration,
      anchor
    );
    if (!current || current.start !== start) {
      appendComplete();
      current = {
        start,
        end: start + duration,
        firstOpenTime: klines[index].openTime,
        closeTime: klines[index].closeTime,
        high: klines[index].high,
        low: klines[index].low,
        highIndex: index,
        lowIndex: index,
      };
      continue;
    }
    if (klines[index].high > current.high) {
      current.high = klines[index].high;
      current.highIndex = index;
    }
    if (klines[index].low < current.low) {
      current.low = klines[index].low;
      current.lowIndex = index;
    }
    current.closeTime = klines[index].closeTime;
  }
  appendComplete();
  return periods;
}

function firstIndexAtOrAfter(klines, timestamp) {
  let low = 0;
  let high = klines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle].openTime < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

function createLiquidity(
  type,
  side,
  price,
  formedIndex,
  availableIndex
) {
  return {
    type,
    side,
    price,
    formedIndex,
    availableIndex,
    status: 'ACTIVE',
    sweptIndex: null,
  };
}

function addPeriodLiquidity(
  result,
  periods,
  highType,
  lowType,
  klines
) {
  for (const period of periods) {
    const availableIndex = firstIndexAtOrAfter(
      klines,
      period.end
    );
    if (availableIndex >= klines.length) continue;
    result.push(createLiquidity(
      highType,
      'BUY_SIDE',
      period.high,
      period.highIndex,
      availableIndex
    ));
    result.push(createLiquidity(
      lowType,
      'SELL_SIDE',
      period.low,
      period.lowIndex,
      availableIndex
    ));
  }
}

function addSwingLiquidity(result, timeline, prefix) {
  const previous = { HIGH: null, LOW: null };
  for (const swing of timeline.rawSwings) {
    const availableIndex = getAvailableIndex(swing);
    const side = swing.type === 'HIGH'
      ? 'BUY_SIDE'
      : 'SELL_SIDE';
    result.push(createLiquidity(
      prefix + '_SWING_' + swing.type,
      side,
      swing.price,
      swing.index,
      availableIndex
    ));
    if (
      previous[swing.type] &&
      samePrice(previous[swing.type].price, swing.price)
    ) {
      result.push(createLiquidity(
        swing.type === 'HIGH' ? 'EQUAL_HIGH' : 'EQUAL_LOW',
        side,
        (previous[swing.type].price + swing.price) / 2,
        swing.index,
        availableIndex
      ));
    }
    previous[swing.type] = swing;
  }
}

function buildRangeTree(values, combine, neutral) {
  const size = values.length;
  const tree = Array(size * 4).fill(neutral);
  function build(node, left, right) {
    if (left === right) {
      tree[node] = values[left];
      return;
    }
    const middle = Math.floor((left + right) / 2);
    build(node * 2, left, middle);
    build(node * 2 + 1, middle + 1, right);
    tree[node] = combine(tree[node * 2], tree[node * 2 + 1]);
  }
  if (size > 0) build(1, 0, size - 1);
  return {
    size,
    tree,
  };
}

function firstRangeMatch(rangeTree, start, predicate) {
  if (rangeTree.size === 0 || start >= rangeTree.size) return null;
  function search(node, left, right) {
    if (right < start || !predicate(rangeTree.tree[node])) {
      return null;
    }
    if (left === right) return left;
    const middle = Math.floor((left + right) / 2);
    const first = search(node * 2, left, middle);
    return first === null
      ? search(node * 2 + 1, middle + 1, right)
      : first;
  }
  return search(1, 0, rangeTree.size - 1);
}

function buildPriceRangeIndex(klines) {
  return {
    highs: buildRangeTree(
      klines.map((bar) => bar.high),
      Math.max,
      -Infinity
    ),
    lows: buildRangeTree(
      klines.map((bar) => bar.low),
      Math.min,
      Infinity
    ),
  };
}

function applyLiquidityLifecycle(levels, klines) {
  const priceIndex = buildPriceRangeIndex(klines);
  for (const level of levels) {
    const isPeriodLevel = (
      level.type === 'PDH' ||
      level.type === 'PDL' ||
      level.type === 'PWH' ||
      level.type === 'PWL'
    );
    const start = level.availableIndex + (isPeriodLevel ? 0 : 1);
    level.sweptIndex = level.side === 'BUY_SIDE'
      ? firstRangeMatch(
        priceIndex.highs,
        start,
        (maximum) => maximum >= level.price
      )
      : firstRangeMatch(
        priceIndex.lows,
        start,
        (minimum) => minimum <= level.price
      );
  }
  return levels;
}

function buildH4Liquidity(timeline) {
  const levels = [];
  addPeriodLiquidity(
    levels,
    aggregatePeriods(timeline.klines, ONE_WEEK, WEEK_ANCHOR),
    'PWH',
    'PWL',
    timeline.klines
  );
  addPeriodLiquidity(
    levels,
    aggregatePeriods(timeline.klines, ONE_DAY, 0),
    'PDH',
    'PDL',
    timeline.klines
  );
  addSwingLiquidity(levels, timeline, 'H4');
  return applyLiquidityLifecycle(levels, timeline.klines);
}

function projectLevel(level, status) {
  return {
    type: level.type,
    side: level.side,
    price: level.price,
    status,
    availableIndex: level.availableIndex,
    sweptIndex: status === 'SWEPT' ? level.sweptIndex : null,
  };
}

function projectLiquidity(levels, index, referencePrice) {
  const visible = levels.filter(
    (level) => level.availableIndex <= index
  );
  const active = visible.filter((level) => (
    !Number.isInteger(level.sweptIndex) ||
    level.sweptIndex > index
  ));
  const recentlyTaken = visible
    .filter((level) => (
      Number.isInteger(level.sweptIndex) &&
      level.sweptIndex <= index
    ))
    .sort((left, right) => right.sweptIndex - left.sweptIndex)
    .slice(0, 12)
    .map((level) => projectLevel(level, 'SWEPT'));
  return {
    buySideLiquidity: active
      .filter((level) => (
        level.side === 'BUY_SIDE' &&
        level.price >= referencePrice
      ))
      .map((level) => projectLevel(level, 'ACTIVE')),
    sellSideLiquidity: active
      .filter((level) => (
        level.side === 'SELL_SIDE' &&
        level.price <= referencePrice
      ))
      .map((level) => projectLevel(level, 'ACTIVE')),
    recentlyTaken,
  };
}

function sortActiveLevels(levels, referencePrice) {
  return levels.slice().sort((left, right) => {
    const distanceDifference =
      distancePercent(left.price, referencePrice) -
      distancePercent(right.price, referencePrice);
    if (distanceDifference !== 0) return distanceDifference;
    return (
      (LIQUIDITY_PRIORITY[right.type] || 0) -
      (LIQUIDITY_PRIORITY[left.type] || 0)
    );
  });
}

function buildLiquidityTimeline(levels, klines, options) {
  options = options || {};
  const maxLevelsPerSide = Number.isInteger(
    options.maxLevelsPerSide
  )
    ? options.maxLevelsPerSide
    : Infinity;
  const availableAt = {};
  const sweptAt = {};
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const level = levels[levelIndex];
    if (!availableAt[level.availableIndex]) {
      availableAt[level.availableIndex] = [];
    }
    availableAt[level.availableIndex].push(levelIndex);
    if (Number.isInteger(level.sweptIndex)) {
      if (!sweptAt[level.sweptIndex]) {
        sweptAt[level.sweptIndex] = [];
      }
      sweptAt[level.sweptIndex].push(levelIndex);
    }
  }

  const active = new Map();
  const taken = [];
  const result = [];
  for (let index = 0; index < klines.length; index += 1) {
    for (const levelIndex of availableAt[index] || []) {
      active.set(levelIndex, levels[levelIndex]);
    }
    for (const levelIndex of sweptAt[index] || []) {
      active.delete(levelIndex);
      taken.push(levels[levelIndex]);
    }
    taken.sort((left, right) => right.sweptIndex - left.sweptIndex);
    const activeLevels = [...active.values()];
    const buyLevels = sortActiveLevels(
      activeLevels.filter((level) => (
        level.side === 'BUY_SIDE' &&
        level.price >= klines[index].close
      )),
      klines[index].close
    );
    const sellLevels = sortActiveLevels(
      activeLevels.filter((level) => (
        level.side === 'SELL_SIDE' &&
        level.price <= klines[index].close
      )),
      klines[index].close
    );
    result.push({
      buySideLiquidity: buyLevels
        .slice(0, maxLevelsPerSide)
        .map((level) => projectLevel(level, 'ACTIVE')),
      sellSideLiquidity: sellLevels
        .slice(0, maxLevelsPerSide)
        .map((level) => projectLevel(level, 'ACTIVE')),
      activeBuySideCount: buyLevels.length,
      activeSellSideCount: sellLevels.length,
      recentlyTaken: taken
        .slice(0, 12)
        .map((level) => projectLevel(level, 'SWEPT')),
    });
  }
  return result;
}

function distancePercent(price, referencePrice) {
  return referencePrice === 0
    ? null
    : Math.abs(price - referencePrice) / referencePrice * 100;
}

function selectPrimaryDraw(levels, referencePrice) {
  if (!levels || levels.length === 0) return null;
  const selected = levels.slice().sort((left, right) => {
    const priorityDifference =
      (LIQUIDITY_PRIORITY[right.type] || 0) -
      (LIQUIDITY_PRIORITY[left.type] || 0);
    if (priorityDifference !== 0) return priorityDifference;
    return distancePercent(left.price, referencePrice) -
      distancePercent(right.price, referencePrice);
  })[0];
  return {
    side: selected.side,
    type: selected.type,
    price: selected.price,
    availableIndex: selected.availableIndex,
    distancePercent: distancePercent(
      selected.price,
      referencePrice
    ),
  };
}

function createPdArray(
  type,
  top,
  bottom,
  originIndex,
  availableIndex
) {
  return {
    type,
    top,
    bottom,
    originIndex,
    availableIndex,
    mitigatedIndex: null,
  };
}

function findOppositeCandle(klines, fromIndex, bullish) {
  for (
    let index = fromIndex;
    index >= Math.max(0, fromIndex - 3);
    index -= 1
  ) {
    const bearishCandle = klines[index].close < klines[index].open;
    if ((bullish && bearishCandle) || (!bullish && !bearishCandle)) {
      return index;
    }
  }
  return null;
}

function applyPdLifecycle(items, klines) {
  const priceIndex = buildPriceRangeIndex(klines);
  for (const item of items) {
    const start = item.availableIndex + 1;
    if (item.type === 'BULLISH_FVG') {
      item.mitigatedIndex = firstRangeMatch(
        priceIndex.lows,
        start,
        (minimum) => minimum <= item.bottom
      );
    } else if (item.type === 'BEARISH_FVG') {
      item.mitigatedIndex = firstRangeMatch(
        priceIndex.highs,
        start,
        (maximum) => maximum >= item.top
      );
    } else {
      let candidateStart = start;
      while (candidateStart < klines.length) {
        const candidate = firstRangeMatch(
          priceIndex.highs,
          candidateStart,
          (maximum) => maximum >= item.bottom
        );
        if (candidate === null) break;
        if (klines[candidate].low <= item.top) {
          item.mitigatedIndex = candidate;
          break;
        }
        candidateStart = candidate + 1;
      }
    }
  }
  return items;
}

function buildPdArrays(klines) {
  const items = [];
  const orderBlockKeys = new Set();
  for (let index = 2; index < klines.length; index += 1) {
    const first = klines[index - 2];
    const third = klines[index];
    let bullish = null;
    let fvg = null;
    if (first.high < third.low) {
      bullish = true;
      fvg = createPdArray(
        'BULLISH_FVG',
        third.low,
        first.high,
        index,
        index
      );
    } else if (first.low > third.high) {
      bullish = false;
      fvg = createPdArray(
        'BEARISH_FVG',
        first.low,
        third.high,
        index,
        index
      );
    }
    if (!fvg) continue;
    items.push(fvg);

    const originIndex = findOppositeCandle(
      klines,
      index - 1,
      bullish
    );
    if (!Number.isInteger(originIndex)) continue;
    const type = bullish ? 'BULLISH_OB' : 'BEARISH_OB';
    const key = type + ':' + originIndex;
    if (orderBlockKeys.has(key)) continue;
    orderBlockKeys.add(key);
    items.push(createPdArray(
      type,
      klines[originIndex].high,
      klines[originIndex].low,
      originIndex,
      index
    ));
  }
  return applyPdLifecycle(items, klines);
}

function projectPdArrays(items, index) {
  const active = items.filter((item) => (
    item.availableIndex <= index &&
    (
      !Number.isInteger(item.mitigatedIndex) ||
      item.mitigatedIndex > index
    )
  )).map((item) => ({
    type: item.type,
    top: item.top,
    bottom: item.bottom,
    originIndex: item.originIndex,
    availableIndex: item.availableIndex,
    status: 'ACTIVE',
  }));
  return {
    bullishFvgs: active.filter(
      (item) => item.type === 'BULLISH_FVG'
    ),
    bullishOrderBlocks: active.filter(
      (item) => item.type === 'BULLISH_OB'
    ),
    bearishFvgs: active.filter(
      (item) => item.type === 'BEARISH_FVG'
    ),
    bearishOrderBlocks: active.filter(
      (item) => item.type === 'BEARISH_OB'
    ),
  };
}

function groupPdArrays(items) {
  const projected = items.map((item) => ({
    type: item.type,
    top: item.top,
    bottom: item.bottom,
    originIndex: item.originIndex,
    availableIndex: item.availableIndex,
    status: 'ACTIVE',
  }));
  return {
    bullishFvgs: projected.filter(
      (item) => item.type === 'BULLISH_FVG'
    ),
    bullishOrderBlocks: projected.filter(
      (item) => item.type === 'BULLISH_OB'
    ),
    bearishFvgs: projected.filter(
      (item) => item.type === 'BEARISH_FVG'
    ),
    bearishOrderBlocks: projected.filter(
      (item) => item.type === 'BEARISH_OB'
    ),
  };
}

function buildPdTimeline(items, klines) {
  const availableAt = {};
  const mitigatedAt = {};
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    if (!availableAt[item.availableIndex]) {
      availableAt[item.availableIndex] = [];
    }
    availableAt[item.availableIndex].push(itemIndex);
    if (Number.isInteger(item.mitigatedIndex)) {
      if (!mitigatedAt[item.mitigatedIndex]) {
        mitigatedAt[item.mitigatedIndex] = [];
      }
      mitigatedAt[item.mitigatedIndex].push(itemIndex);
    }
  }
  const active = new Map();
  const result = [];
  for (let index = 0; index < klines.length; index += 1) {
    for (const itemIndex of availableAt[index] || []) {
      active.set(itemIndex, items[itemIndex]);
    }
    for (const itemIndex of mitigatedAt[index] || []) {
      active.delete(itemIndex);
    }
    result.push(groupPdArrays([...active.values()]));
  }
  return result;
}

function containsPrice(item, price) {
  return item.bottom <= price && price <= item.top;
}

function pdArrayConflict(pdArray, direction, referencePrice) {
  const opposing = direction === 'BULLISH'
    ? pdArray.bearishFvgs.concat(pdArray.bearishOrderBlocks)
    : pdArray.bullishFvgs.concat(pdArray.bullishOrderBlocks);
  return opposing.some((item) => containsPrice(item, referencePrice));
}

function matchingPdArray(pdArray, direction, referencePrice) {
  const matching = direction === 'BULLISH'
    ? pdArray.bullishFvgs.concat(pdArray.bullishOrderBlocks)
    : pdArray.bearishFvgs.concat(pdArray.bearishOrderBlocks);
  return matching.some((item) => containsPrice(item, referencePrice));
}

function latestRelevantSweep(liquidity, dealingRange) {
  return liquidity.recentlyTaken.find((level) => (
    dealingRange.availableIndex !== null &&
    level.sweptIndex >= dealingRange.availableIndex
  )) || null;
}

function resolveNarrative(
  structure,
  dealingRange,
  liquidity,
  pdArray,
  referencePrice
) {
  const reasons = [];
  const lastTaken = latestRelevantSweep(liquidity, dealingRange);
  const bullishDraw = selectPrimaryDraw(
    liquidity.buySideLiquidity,
    referencePrice
  );
  const bearishDraw = selectPrimaryDraw(
    liquidity.sellSideLiquidity,
    referencePrice
  );
  const bullishConditions = {
    structure: structure.state === 'BULLISH',
    location: dealingRange.location === 'DISCOUNT',
    sellSideTaken: Boolean(
      lastTaken && lastTaken.side === 'SELL_SIDE'
    ),
    buySideRemains: Boolean(bullishDraw),
    noPdConflict: !pdArrayConflict(
      pdArray,
      'BULLISH',
      referencePrice
    ),
  };
  const bearishConditions = {
    structure: structure.state === 'BEARISH',
    location: dealingRange.location === 'PREMIUM',
    buySideTaken: Boolean(
      lastTaken && lastTaken.side === 'BUY_SIDE'
    ),
    sellSideRemains: Boolean(bearishDraw),
    noPdConflict: !pdArrayConflict(
      pdArray,
      'BEARISH',
      referencePrice
    ),
  };

  const bullish = Object.values(bullishConditions).every(Boolean);
  const bearish = Object.values(bearishConditions).every(Boolean);
  let bias = 'NEUTRAL';
  let primaryDraw = null;
  if (bullish && !bearish) {
    bias = 'BULLISH';
    primaryDraw = bullishDraw;
    reasons.push(
      'HH_HL_STRUCTURE',
      'PRICE_IN_DISCOUNT',
      'SELL_SIDE_LIQUIDITY_TAKEN',
      'BUY_SIDE_LIQUIDITY_REMAINS'
    );
    if (matchingPdArray(pdArray, bias, referencePrice)) {
      reasons.push('BULLISH_PD_ARRAY');
    }
  } else if (bearish && !bullish) {
    bias = 'BEARISH';
    primaryDraw = bearishDraw;
    reasons.push(
      'LH_LL_STRUCTURE',
      'PRICE_IN_PREMIUM',
      'BUY_SIDE_LIQUIDITY_TAKEN',
      'SELL_SIDE_LIQUIDITY_REMAINS'
    );
    if (matchingPdArray(pdArray, bias, referencePrice)) {
      reasons.push('BEARISH_PD_ARRAY');
    }
  } else {
    if (!bullishConditions.structure && !bearishConditions.structure) {
      reasons.push('NO_DIRECTIONAL_4H_STRUCTURE');
    } else {
      reasons.push('STRUCTURE_CONTEXT_CONFLICT');
    }
    if (
      dealingRange.location === 'UNKNOWN' ||
      dealingRange.location === 'EQUILIBRIUM'
    ) {
      reasons.push('NO_PREMIUM_DISCOUNT_ADVANTAGE');
    }
    if (!lastTaken) reasons.push('NO_RELEVANT_LIQUIDITY_TAKEN');
    if (!bullishDraw && !bearishDraw) {
      reasons.push('NO_ACTIVE_EXTERNAL_LIQUIDITY');
    }
    if (
      pdArrayConflict(pdArray, 'BULLISH', referencePrice) ||
      pdArrayConflict(pdArray, 'BEARISH', referencePrice)
    ) {
      reasons.push('OPPOSING_PD_ARRAY_CONFLICT');
    }
  }

  return {
    bias,
    primaryDraw,
    reasons,
    conditions: bias === 'BULLISH'
      ? bullishConditions
      : bias === 'BEARISH'
        ? bearishConditions
        : {
          bullish: bullishConditions,
          bearish: bearishConditions,
        },
  };
}

function buildStates(timeline, levels, pdItems) {
  const liquidityTimeline = buildLiquidityTimeline(
    levels,
    timeline.klines
  );
  const pdTimeline = buildPdTimeline(pdItems, timeline.klines);
  return timeline.states.map((state) => {
    const liquidity = liquidityTimeline[state.index];
    const pdArray = pdTimeline[state.index];
    const narrative = resolveNarrative(
      state.structure,
      state.dealingRange,
      liquidity,
      pdArray,
      state.referencePrice
    );
    return {
      ...state,
      liquidity: {
        ...liquidity,
        primaryDraw: narrative.primaryDraw,
      },
      pdArray,
      narrative,
    };
  });
}

function analyze(input) {
  input = input || {};
  const h4Klines = input.h4Klines;
  validateClosedKlines(h4Klines, FOUR_HOURS, '4H');
  const timeline = buildStructureTimeline(h4Klines);
  const liquidityLevels = buildH4Liquidity(timeline);
  const pdItems = buildPdArrays(h4Klines);
  const states = buildStates(timeline, liquidityLevels, pdItems);
  return {
    protocol: {
      version: 'ICT_HTF_BIAS_ENGINE_V2',
      input: 'Complete closed 4H Klines only',
      usesConfirmedSwings: true,
      usesAvailableIndex: true,
      usesMssForH4Bias: false,
      reads5mSetup: false,
      readsTrades: false,
      readsEntryExit: false,
      generatesSignal: false,
    },
    swings: timeline.swings,
    states,
  };
}

module.exports = {
  EQUAL_TOLERANCE,
  FOUR_HOURS,
  LIQUIDITY_PRIORITY,
  ONE_DAY,
  ONE_HOUR,
  ONE_WEEK,
  aggregatePeriods,
  analyze,
  applyLiquidityLifecycle,
  applyPdLifecycle,
  buildLiquidityTimeline,
  buildDealingRange,
  buildH4Liquidity,
  buildPdArrays,
  buildPdTimeline,
  buildPriceRangeIndex,
  buildStates,
  buildStructureTimeline,
  classifySwing,
  projectLiquidity,
  projectPdArrays,
  firstRangeMatch,
  resolveNarrative,
  resolveStructureState,
  selectPrimaryDraw,
  sortActiveLevels,
  validateClosedKlines,
};
