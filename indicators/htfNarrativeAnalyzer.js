'use strict';

const Pivot = require('./pivot');
const Swing = require('./swing');
const StructureEngineV2 = require('./structureEngineV2');
const HTFContextAnalyzer = require('./htfContextAnalyzer');

const ONE_HOUR = HTFContextAnalyzer.ONE_HOUR;
const FOUR_HOURS = HTFContextAnalyzer.FOUR_HOURS;
const ONE_DAY = HTFContextAnalyzer.ONE_DAY;
const ONE_WEEK = 7 * ONE_DAY;
const WEEK_ANCHOR = Date.UTC(1970, 0, 5);
const EQUAL_TOLERANCE = 0.001;
const RECENT_SWEEP_LIMIT = 5;

const LEVEL_PRIORITY = Object.freeze({
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

function getCloseTime(kline, interval) {
  return Number.isFinite(kline.closeTime)
    ? kline.closeTime
    : kline.openTime + interval - 1;
}

function getSwingAvailableIndex(swing) {
  if (Number.isInteger(swing.availableIndex)) {
    return swing.availableIndex;
  }
  if (Number.isInteger(swing.confirmationIndex)) {
    return swing.confirmationIndex;
  }
  return swing.index;
}

function cloneSwing(swing, bars) {
  if (!swing) return null;
  const availableIndex = getSwingAvailableIndex(swing);
  return {
    type: swing.type,
    price: swing.price,
    index: swing.index,
    formedAt: bars[swing.index]
      ? getCloseTime(bars[swing.index], 0)
      : null,
    availableIndex,
    availableAt: bars[availableIndex]
      ? getCloseTime(bars[availableIndex], 0)
      : null,
  };
}

function samePrice(left, right) {
  const reference = Math.max(Math.abs(left), Math.abs(right));
  if (reference === 0) return left === right;
  return Math.abs(left - right) / reference <= EQUAL_TOLERANCE;
}

function directionFromType(type) {
  return String(type).indexOf('BULLISH_') === 0
    ? 'BULLISH'
    : String(type).indexOf('BEARISH_') === 0
      ? 'BEARISH'
      : 'UNKNOWN';
}

function labelSwing(swing, previousSameSide) {
  if (!previousSameSide) {
    return swing.type === 'HIGH' ? 'H' : 'L';
  }
  if (swing.type === 'HIGH') {
    return swing.price > previousSameSide.price ? 'HH' : 'LH';
  }
  return swing.price > previousSameSide.price ? 'HL' : 'LL';
}

function findMatchingSwing(sequence, type, price) {
  if (!Number.isFinite(price)) return null;
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    if (
      sequence[index].type === type &&
      samePrice(sequence[index].price, price)
    ) {
      return sequence[index].source;
    }
  }
  return null;
}

function findLatestAfter(sequence, type, sourceIndex) {
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    if (
      sequence[index].type === type &&
      sequence[index].source.index > sourceIndex
    ) {
      return sequence[index].source;
    }
  }
  return null;
}

function priceLocation(price, high, low) {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    high <= low
  ) {
    return 'UNKNOWN';
  }
  const equilibrium = (high + low) / 2;
  if (price > equilibrium) return 'PREMIUM';
  if (price < equilibrium) return 'DISCOUNT';
  return 'EQUILIBRIUM';
}

function emptyRange() {
  return {
    high: null,
    low: null,
    equilibrium: null,
    location: 'UNKNOWN',
    rangeHighSource: null,
    rangeLowSource: null,
    availableAt: null,
  };
}

function selectDealingRange(
  structureState,
  protectedHigh,
  protectedLow,
  sequence,
  bars,
  index
) {
  let highSource = null;
  let lowSource = null;

  if (structureState === 'BULLISH') {
    lowSource = findMatchingSwing(sequence, 'LOW', protectedLow);
    if (lowSource) {
      highSource = findLatestAfter(sequence, 'HIGH', lowSource.index);
    }
  } else if (structureState === 'BEARISH') {
    highSource = findMatchingSwing(sequence, 'HIGH', protectedHigh);
    if (highSource) {
      lowSource = findLatestAfter(sequence, 'LOW', highSource.index);
    }
  } else {
    for (let cursor = sequence.length - 1; cursor >= 0; cursor -= 1) {
      if (!highSource && sequence[cursor].type === 'HIGH') {
        highSource = sequence[cursor].source;
      }
      if (!lowSource && sequence[cursor].type === 'LOW') {
        lowSource = sequence[cursor].source;
      }
      if (highSource && lowSource) break;
    }
  }

  if (
    !highSource ||
    !lowSource ||
    highSource.price <= lowSource.price
  ) {
    return emptyRange();
  }

  const high = highSource.price;
  const low = lowSource.price;
  const highAvailable = getSwingAvailableIndex(highSource);
  const lowAvailable = getSwingAvailableIndex(lowSource);
  const availableIndex = Math.max(highAvailable, lowAvailable);

  return {
    high,
    low,
    equilibrium: (high + low) / 2,
    location: priceLocation(bars[index].close, high, low),
    rangeHighSource: cloneSwing(highSource, bars),
    rangeLowSource: cloneSwing(lowSource, bars),
    availableAt: bars[availableIndex]
      ? getCloseTime(bars[availableIndex], 0)
      : null,
  };
}

function buildMarketTimeline(bars) {
  const pivots = Pivot.findPivots(bars, 2, 2);
  const swings = Swing.filterSwings(pivots)
    .map((swing, order) => ({ swing, order }))
    .sort((left, right) => {
      const difference =
        getSwingAvailableIndex(left.swing) -
        getSwingAvailableIndex(right.swing);
      if (difference !== 0) return difference;
      return left.order - right.order;
    })
    .map((item) => item.swing);
  const structure = StructureEngineV2.analyze(
    bars,
    swings,
    {
      averageLength: 20,
      displacementMultiplier: 1.5,
      minBodyRatio: 0.65,
    }
  );
  const swingsByIndex = {};
  const eventsByIndex = {};

  for (const swing of swings) {
    const availableIndex = getSwingAvailableIndex(swing);
    if (!swingsByIndex[availableIndex]) {
      swingsByIndex[availableIndex] = [];
    }
    swingsByIndex[availableIndex].push(swing);
  }
  for (const event of structure.events) {
    if (
      event.type !== 'BULLISH_STRUCTURE_CONFIRMED' &&
      event.type !== 'BEARISH_STRUCTURE_CONFIRMED' &&
      event.type !== 'BULLISH_BOS' &&
      event.type !== 'BEARISH_BOS' &&
      event.type !== 'BULLISH_MSS' &&
      event.type !== 'BEARISH_MSS'
    ) {
      continue;
    }
    if (!eventsByIndex[event.availableIndex]) {
      eventsByIndex[event.availableIndex] = [];
    }
    eventsByIndex[event.availableIndex].push(event);
  }

  const snapshots = [];
  const sequence = [];
  let previousHigh = null;
  let previousLow = null;
  let latestHigh = null;
  let latestLow = null;
  let lastEvent = null;
  let state = 'UNKNOWN';
  let protectedHigh = null;
  let protectedLow = null;

  for (let index = 0; index < bars.length; index += 1) {
    for (const swing of swingsByIndex[index] || []) {
      const previous = swing.type === 'HIGH'
        ? previousHigh
        : previousLow;
      sequence.push({
        type: swing.type,
        label: labelSwing(swing, previous),
        price: swing.price,
        formedAt: bars[swing.index]
          ? getCloseTime(bars[swing.index], 0)
          : null,
        availableAt: getCloseTime(bars[index], 0),
        source: swing,
      });
      if (swing.type === 'HIGH') {
        previousHigh = swing;
        latestHigh = swing;
      } else {
        previousLow = swing;
        latestLow = swing;
      }
    }

    for (const event of eventsByIndex[index] || []) {
      lastEvent = event;
      state = directionFromType(event.type);
      if (state === 'BULLISH') {
        protectedLow = Number.isFinite(event.newProtectedLow)
          ? event.newProtectedLow
          : Number.isFinite(event.protectedLow)
            ? event.protectedLow
            : protectedLow;
        if (event.type === 'BULLISH_MSS') protectedHigh = null;
      } else if (state === 'BEARISH') {
        protectedHigh = Number.isFinite(event.newProtectedHigh)
          ? event.newProtectedHigh
          : Number.isFinite(event.protectedHigh)
            ? event.protectedHigh
            : protectedHigh;
        if (event.type === 'BEARISH_MSS') protectedLow = null;
      }
    }

    const dealingRange = selectDealingRange(
      state,
      protectedHigh,
      protectedLow,
      sequence,
      bars,
      index
    );
    snapshots.push({
      state,
      lastConfirmedSwingHigh: cloneSwing(latestHigh, bars),
      lastConfirmedSwingLow: cloneSwing(latestLow, bars),
      swingSequence: sequence.slice(-8).map((item) => ({
        type: item.type,
        label: item.label,
        price: item.price,
        formedAt: item.formedAt,
        availableAt: item.availableAt,
      })),
      protectedHigh,
      protectedLow,
      lastStructureEvent: lastEvent
        ? {
          type: lastEvent.type,
          direction: lastEvent.direction,
          level: lastEvent.level,
          breakType: lastEvent.breakType,
          availableAt: getCloseTime(
            bars[lastEvent.availableIndex],
            0
          ),
        }
        : null,
      dealingRange,
    });
  }

  return {
    bars,
    swings,
    events: structure.events,
    snapshots,
  };
}

function periodStart(time, interval, anchor) {
  return Math.floor((time - anchor) / interval) * interval + anchor;
}

function aggregatePeriods(bars, interval, anchor) {
  const result = [];
  let current = null;

  function appendIfComplete() {
    if (!current) return;
    const expectedClose = current.start + interval - 1;
    if (
      current.firstOpenTime === current.start &&
      current.closeTime >= expectedClose
    ) {
      result.push(current);
    }
  }

  for (let index = 0; index < bars.length; index += 1) {
    const start = periodStart(bars[index].openTime, interval, anchor);
    if (!current || current.start !== start) {
      appendIfComplete();
      current = {
        start,
        end: start + interval,
        high: bars[index].high,
        low: bars[index].low,
        highIndex: index,
        lowIndex: index,
        closeTime: bars[index].closeTime,
        firstOpenTime: bars[index].openTime,
      };
      continue;
    }
    if (bars[index].high > current.high) {
      current.high = bars[index].high;
      current.highIndex = index;
    }
    if (bars[index].low < current.low) {
      current.low = bars[index].low;
      current.lowIndex = index;
    }
    current.closeTime = bars[index].closeTime;
  }
  appendIfComplete();
  return result;
}

function createLevel(
  type,
  side,
  price,
  formedAt,
  availableAt,
  activeIndex
) {
  return {
    type,
    side,
    price,
    formedAt,
    availableAt,
    activeIndex,
    status: 'ACTIVE',
    sweptAt: null,
    sweptIndex: null,
    priority: LEVEL_PRIORITY[type] || 0,
  };
}

function addPeriodLevels(result, periods, highType, lowType, bars) {
  for (const period of periods) {
    const activeIndex = findFirstOpenAtOrAfter(bars, period.end);
    result.push(createLevel(
      highType,
      'BUY_SIDE',
      period.high,
      bars[period.highIndex].closeTime,
      period.end,
      activeIndex
    ));
    result.push(createLevel(
      lowType,
      'SELL_SIDE',
      period.low,
      bars[period.lowIndex].closeTime,
      period.end,
      activeIndex
    ));
  }
}

function findFirstOpenAtOrAfter(bars, time) {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle].openTime < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function addSwingLevels(result, timeline, prefix) {
  const previousByType = { HIGH: null, LOW: null };
  for (const swing of timeline.swings) {
    const availableIndex = getSwingAvailableIndex(swing);
    const side = swing.type === 'HIGH' ? 'BUY_SIDE' : 'SELL_SIDE';
    const swingType = prefix + '_SWING_' + swing.type;
    result.push(createLevel(
      swingType,
      side,
      swing.price,
      timeline.bars[swing.index].closeTime,
      timeline.bars[availableIndex].closeTime,
      availableIndex + 1
    ));
    const previous = previousByType[swing.type];
    if (previous && samePrice(previous.price, swing.price)) {
      const equalType = swing.type === 'HIGH'
        ? 'EQUAL_HIGH'
        : 'EQUAL_LOW';
      result.push(createLevel(
        equalType,
        side,
        (previous.price + swing.price) / 2,
        timeline.bars[swing.index].closeTime,
        timeline.bars[availableIndex].closeTime,
        availableIndex + 1
      ));
    }
    previousByType[swing.type] = swing;
  }
}

function applyLiquidityLifecycle(levels, bars) {
  for (const level of levels) {
    for (
      let index = Math.max(0, level.activeIndex);
      index < bars.length;
      index += 1
    ) {
      const taken = level.side === 'BUY_SIDE'
        ? bars[index].high >= level.price
        : bars[index].low <= level.price;
      if (taken) {
        level.sweptIndex = index;
        level.sweptAt = bars[index].closeTime;
        break;
      }
    }
  }
  return levels;
}

function buildH4LiquidityLevels(timeline) {
  const result = [];
  addPeriodLevels(
    result,
    aggregatePeriods(timeline.bars, ONE_DAY, 0),
    'PDH',
    'PDL',
    timeline.bars
  );
  addPeriodLevels(
    result,
    aggregatePeriods(timeline.bars, ONE_WEEK, WEEK_ANCHOR),
    'PWH',
    'PWL',
    timeline.bars
  );
  addSwingLevels(result, timeline, 'H4');
  return applyLiquidityLifecycle(result, timeline.bars);
}

function buildH1LiquidityLevels(timeline) {
  const result = [];
  addSwingLevels(result, timeline, 'H1');
  return applyLiquidityLifecycle(result, timeline.bars);
}

function projectLevel(level, contextIndex, timestamp) {
  const swept = Number.isInteger(level.sweptIndex) &&
    level.sweptIndex <= contextIndex &&
    level.sweptAt <= timestamp;
  return {
    type: level.type,
    side: level.side,
    price: level.price,
    formedAt: level.formedAt,
    availableAt: level.availableAt,
    status: swept ? 'SWEPT' : 'ACTIVE',
    sweptAt: swept ? level.sweptAt : null,
  };
}

function distancePercent(price, referencePrice) {
  return referencePrice !== 0
    ? Math.abs(price - referencePrice) / referencePrice * 100
    : null;
}

function sortByDistance(levels, price) {
  return levels.slice().sort((left, right) => {
    const distanceDifference =
      distancePercent(left.price, price) -
      distancePercent(right.price, price);
    if (distanceDifference !== 0) return distanceDifference;
    return right.price - left.price;
  });
}

function buildLiquiditySnapshot(
  levels,
  contextIndex,
  timestamp,
  referencePrice
) {
  const visible = levels
    .filter((level) => level.availableAt <= timestamp)
    .map((level) => projectLevel(level, contextIndex, timestamp));
  const activeBuySide = sortByDistance(
    visible.filter((level) => (
      level.status === 'ACTIVE' &&
      level.side === 'BUY_SIDE' &&
      level.price >= referencePrice
    )),
    referencePrice
  );
  const activeSellSide = sortByDistance(
    visible.filter((level) => (
      level.status === 'ACTIVE' &&
      level.side === 'SELL_SIDE' &&
      level.price <= referencePrice
    )),
    referencePrice
  );
  const recentlyTaken = visible
    .filter((level) => level.status === 'SWEPT')
    .sort((left, right) => right.sweptAt - left.sweptAt)
    .slice(0, RECENT_SWEEP_LIMIT);

  return {
    activeBuySide,
    activeSellSide,
    recentlyTaken,
    nearestBuySide: activeBuySide[0] || null,
    nearestSellSide: activeSellSide[0] || null,
  };
}

function buildPdArrays(bars) {
  const result = [];
  for (let index = 2; index < bars.length; index += 1) {
    const first = bars[index - 2];
    const third = bars[index];
    let item = null;
    if (first.high < third.low) {
      item = {
        type: 'BULLISH_FVG',
        top: third.low,
        bottom: first.high,
      };
    } else if (first.low > third.high) {
      item = {
        type: 'BEARISH_FVG',
        top: first.low,
        bottom: third.high,
      };
    }
    if (!item) continue;
    item.formedIndex = index;
    item.availableAt = bars[index].closeTime;
    item.filledIndex = null;
    item.filledAt = null;
    for (let future = index + 1; future < bars.length; future += 1) {
      const filled = item.type === 'BULLISH_FVG'
        ? bars[future].low <= item.bottom
        : bars[future].high >= item.top;
      if (filled) {
        item.filledIndex = future;
        item.filledAt = bars[future].closeTime;
        break;
      }
    }
    result.push(item);
  }
  return result;
}

function projectPdArrays(items, contextIndex, timestamp) {
  const visible = items.filter((item) => (
    item.formedIndex <= contextIndex &&
    item.availableAt <= timestamp &&
    (
      !Number.isInteger(item.filledIndex) ||
      item.filledIndex > contextIndex
    )
  ));
  function project(item) {
    return {
      type: item.type,
      top: item.top,
      bottom: item.bottom,
      formedAt: item.availableAt,
      availableAt: item.availableAt,
      status: 'ACTIVE',
      filledAt: null,
    };
  }
  return {
    bullishFvgs: visible
      .filter((item) => item.type === 'BULLISH_FVG')
      .map(project),
    bearishFvgs: visible
      .filter((item) => item.type === 'BEARISH_FVG')
      .map(project),
  };
}

function importantLiquidity(levels, price) {
  if (!levels || levels.length === 0) return null;
  return levels.slice().sort((left, right) => {
    const priorityDifference =
      (LEVEL_PRIORITY[right.type] || 0) -
      (LEVEL_PRIORITY[left.type] || 0);
    if (priorityDifference !== 0) return priorityDifference;
    return distancePercent(left.price, price) -
      distancePercent(right.price, price);
  })[0];
}

function drawFromLevel(level, price) {
  if (!level) return null;
  return {
    side: level.side,
    type: level.type,
    price: level.price,
    distancePercent: distancePercent(level.price, price),
  };
}

function buildNarrative(structure, liquidity, pdArrays, price) {
  const bullishReasons = [];
  const bearishReasons = [];
  const lastTaken = liquidity.recentlyTaken[0] || null;
  const nearestBuy = liquidity.nearestBuySide;
  const nearestSell = liquidity.nearestSellSide;

  if (structure.state === 'BULLISH') {
    bullishReasons.push('BULLISH_4H_STRUCTURE');
  }
  if (structure.state === 'BEARISH') {
    bearishReasons.push('BEARISH_4H_STRUCTURE');
  }
  if (structure.dealingRange.location === 'DISCOUNT') {
    bullishReasons.push('PRICE_IN_DISCOUNT');
  }
  if (structure.dealingRange.location === 'PREMIUM') {
    bearishReasons.push('PRICE_IN_PREMIUM');
  }
  if (lastTaken && lastTaken.side === 'SELL_SIDE') {
    bullishReasons.push('SELL_SIDE_LIQUIDITY_TAKEN');
  }
  if (lastTaken && lastTaken.side === 'BUY_SIDE') {
    bearishReasons.push('BUY_SIDE_LIQUIDITY_TAKEN');
  }
  if (
    nearestBuy &&
    (
      !nearestSell ||
      distancePercent(nearestBuy.price, price) <
        distancePercent(nearestSell.price, price)
    )
  ) {
    bullishReasons.push('UPSIDE_EXTERNAL_LIQUIDITY_REMAINS');
  } else if (nearestSell) {
    bearishReasons.push('DOWNSIDE_EXTERNAL_LIQUIDITY_REMAINS');
  }
  if (pdArrays.bullishFvgs.some((fvg) => fvg.top <= price)) {
    bullishReasons.push('BULLISH_PD_ARRAY_SUPPORT');
  }
  if (pdArrays.bearishFvgs.some((fvg) => fvg.bottom >= price)) {
    bearishReasons.push('BEARISH_PD_ARRAY_RESISTANCE');
  }

  let advantageDirection = 'NEUTRAL';
  if (bullishReasons.length >= 3 && bearishReasons.length <= 1) {
    advantageDirection = 'BULLISH';
  } else if (
    bearishReasons.length >= 3 &&
    bullishReasons.length <= 1
  ) {
    advantageDirection = 'BEARISH';
  }

  const directionalLevels = advantageDirection === 'BULLISH'
    ? liquidity.activeBuySide
    : advantageDirection === 'BEARISH'
      ? liquidity.activeSellSide
      : [];
  const opposingLevels = advantageDirection === 'BULLISH'
    ? liquidity.activeSellSide
    : advantageDirection === 'BEARISH'
      ? liquidity.activeBuySide
      : [];
  const primaryLevel = importantLiquidity(directionalLevels, price);
  const secondaryLevel = importantLiquidity(
    directionalLevels.filter((level) => level !== primaryLevel),
    price
  );
  const opposingLevel = importantLiquidity(opposingLevels, price);

  return {
    advantageDirection,
    primaryDraw: drawFromLevel(primaryLevel, price),
    secondaryDraw: drawFromLevel(secondaryLevel, price),
    opposingLiquidity: drawFromLevel(opposingLevel, price),
    reasons: advantageDirection === 'BULLISH'
      ? bullishReasons
      : advantageDirection === 'BEARISH'
        ? bearishReasons
        : bullishReasons.concat(bearishReasons),
  };
}

function findLatestClosedIndex(bars, timestamp) {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle].closeTime <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function buildH4Context(
  timeline,
  liquidityLevels,
  pdItems,
  index,
  timestamp
) {
  if (index < 0) return null;
  const market = timeline.snapshots[index];
  const price = timeline.bars[index].close;
  const liquidity = buildLiquiditySnapshot(
    liquidityLevels,
    index,
    timestamp,
    price
  );
  const pdArrays = projectPdArrays(pdItems, index, timestamp);
  const structure = {
    state: market.state,
    lastConfirmedSwingHigh: market.lastConfirmedSwingHigh,
    lastConfirmedSwingLow: market.lastConfirmedSwingLow,
    swingSequence: market.swingSequence,
    protectedHigh: market.protectedHigh,
    protectedLow: market.protectedLow,
    lastStructureEvent: market.lastStructureEvent,
  };
  structure.dealingRange = market.dealingRange;
  const narrative = buildNarrative(
    structure,
    liquidity,
    pdArrays,
    price
  );
  delete structure.dealingRange;

  return {
    timeframe: '4H',
    structure,
    dealingRange: market.dealingRange,
    liquidity,
    pdArrays,
    narrative,
  };
}

function getDeliveryDirection(market) {
  const event = market.lastStructureEvent;
  if (event && String(event.type).endsWith('_MSS')) {
    return 'TRANSITION';
  }
  if (market.state === 'BULLISH') return 'UP';
  if (market.state === 'BEARISH') return 'DOWN';

  const labels = market.swingSequence
    .slice(-4)
    .map((item) => item.label);
  if (labels.includes('HH') && labels.includes('HL')) return 'UP';
  if (labels.includes('LH') && labels.includes('LL')) return 'DOWN';
  return 'TRANSITION';
}

function relationToH4(deliveryDirection, h4Direction) {
  if (h4Direction === 'NEUTRAL') return 'UNCLEAR';
  if (deliveryDirection === 'TRANSITION') return 'TRANSITIONING';
  if (
    (h4Direction === 'BULLISH' && deliveryDirection === 'UP') ||
    (h4Direction === 'BEARISH' && deliveryDirection === 'DOWN')
  ) {
    return 'ALIGNED';
  }
  return 'RETRACING';
}

function movingTowardDraw(
  primaryDraw,
  currentPrice,
  previousPrice,
  previousDraw
) {
  if (
    !primaryDraw ||
    !Number.isFinite(previousPrice) ||
    !previousDraw ||
    primaryDraw.type !== previousDraw.type ||
    primaryDraw.price !== previousDraw.price
  ) {
    return false;
  }
  return Math.abs(primaryDraw.price - currentPrice) <
    Math.abs(primaryDraw.price - previousPrice);
}

function buildH1Context(
  timeline,
  liquidityLevels,
  pdItems,
  index,
  timestamp,
  h4,
  previousSnapshot
) {
  const market = timeline.snapshots[index];
  const price = timeline.bars[index].close;
  const liquidity = buildLiquiditySnapshot(
    liquidityLevels,
    index,
    timestamp,
    price
  );
  const direction = getDeliveryDirection(market);
  const relation = relationToH4(
    direction,
    h4 ? h4.narrative.advantageDirection : 'NEUTRAL'
  );
  const previousPrice = previousSnapshot
    ? previousSnapshot.referencePrice
    : null;
  const previousDraw = previousSnapshot && previousSnapshot.h4
    ? previousSnapshot.h4.narrative.primaryDraw
    : null;
  const primaryDraw = h4 ? h4.narrative.primaryDraw : null;

  return {
    timeframe: '1H',
    structure: {
      state: market.state,
      swingSequence: market.swingSequence,
      lastStructureEvent: market.lastStructureEvent,
    },
    dealingRange: market.dealingRange,
    liquidity: {
      nearestBuySide: liquidity.nearestBuySide,
      nearestSellSide: liquidity.nearestSellSide,
      recentlyTaken: liquidity.recentlyTaken,
    },
    pdArrays: projectPdArrays(pdItems, index, timestamp),
    delivery: {
      direction,
      relationToH4: relation,
      movingTowardPrimaryDraw: movingTowardDraw(
        primaryDraw,
        price,
        previousPrice,
        previousDraw
      ),
    },
  };
}

function executionGuidance(h4, h1) {
  if (!h4 || h4.narrative.advantageDirection === 'NEUTRAL') {
    return {
      preferredDirection: null,
      currentState: 'NO_HTF_ADVANTAGE',
      message:
        '4H narrative is neutral. Wait for clearer higher-timeframe evidence.',
    };
  }
  const preferredDirection =
    h4.narrative.advantageDirection === 'BULLISH'
      ? 'LONG'
      : 'SHORT';
  if (h1.delivery.relationToH4 === 'ALIGNED') {
    return {
      preferredDirection,
      currentState: 'HTF_DELIVERY_ALIGNED',
      message:
        '4H narrative and 1H delivery are aligned. Wait for the lower-timeframe execution model.',
    };
  }
  if (h1.delivery.relationToH4 === 'RETRACING') {
    return {
      preferredDirection,
      currentState: 'WAIT_FOR_EXECUTION',
      message:
        '1H is retracing against the 4H narrative. Wait for the lower-timeframe execution model.',
    };
  }
  return {
    preferredDirection,
    currentState: 'HTF_TRANSITION',
    message:
      '1H delivery is transitioning. Wait for the lower-timeframe execution model.',
  };
}

function validateKlines(klines) {
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error('5m Klines are required.');
  }
  for (let index = 1; index < klines.length; index += 1) {
    if (klines[index].openTime <= klines[index - 1].openTime) {
      throw new Error('Klines must be strictly chronological.');
    }
  }
}

function analyze(klines, options) {
  validateKlines(klines);
  const settings = options || {};
  const h1Bars = HTFContextAnalyzer.aggregateClosedKlines(
    klines,
    ONE_HOUR
  );
  const h4Bars = HTFContextAnalyzer.aggregateClosedKlines(
    klines,
    FOUR_HOURS
  );
  const h1Timeline = buildMarketTimeline(h1Bars);
  const h4Timeline = buildMarketTimeline(h4Bars);
  const h1Liquidity = buildH1LiquidityLevels(h1Timeline);
  const h4Liquidity = buildH4LiquidityLevels(h4Timeline);
  const h1PdArrays = buildPdArrays(h1Bars);
  const h4PdArrays = buildPdArrays(h4Bars);
  const snapshots = [];
  let previousSnapshot = null;
  const firstSnapshotIndex = settings.latestOnly
    ? Math.max(0, h1Bars.length - 2)
    : 0;

  for (
    let h1Index = firstSnapshotIndex;
    h1Index < h1Bars.length;
    h1Index += 1
  ) {
    const timestamp = h1Bars[h1Index].closeTime;
    const h4Index = findLatestClosedIndex(h4Bars, timestamp);
    const h4 = buildH4Context(
      h4Timeline,
      h4Liquidity,
      h4PdArrays,
      h4Index,
      timestamp
    );
    const h1 = buildH1Context(
      h1Timeline,
      h1Liquidity,
      h1PdArrays,
      h1Index,
      timestamp,
      h4,
      previousSnapshot
    );
    const snapshot = {
      timestamp,
      referencePrice: h1Bars[h1Index].close,
      h4,
      h1,
      executionGuidance: executionGuidance(h4, h1),
    };
    snapshots.push(snapshot);
    previousSnapshot = snapshot;
  }

  return {
    protocol: {
      h4UsesOnlyClosed4HBars: true,
      h1DoesNotRewriteH4: true,
      setupInputUsed: false,
      entrySignalGenerated: false,
      automatedOrderGenerated: false,
      narrativeEvidence:
        '4H structure, confirmed dealing range, liquidity lifecycle, active PD arrays and draw on liquidity',
      snapshotCadence: 'Each complete 1H close',
    },
    source: {
      klineCount: klines.length,
      firstTime: klines[0].openTime,
      lastTime: klines[klines.length - 1].openTime,
      h1Bars: h1Bars.length,
      h4Bars: h4Bars.length,
    },
    snapshots: settings.latestOnly
      ? snapshots.slice(-1)
      : snapshots,
  };
}

module.exports = {
  EQUAL_TOLERANCE,
  LEVEL_PRIORITY,
  ONE_DAY,
  ONE_HOUR,
  ONE_WEEK,
  FOUR_HOURS,
  aggregatePeriods,
  analyze,
  applyLiquidityLifecycle,
  buildH1LiquidityLevels,
  buildH4Context,
  buildH4LiquidityLevels,
  buildLiquiditySnapshot,
  buildMarketTimeline,
  buildNarrative,
  buildPdArrays,
  executionGuidance,
  getDeliveryDirection,
  priceLocation,
  projectLevel,
  projectPdArrays,
  relationToH4,
  selectDealingRange,
};
