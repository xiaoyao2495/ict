'use strict';

const Pivot = require('./pivot');
const Swing = require('./swing');
const StructureEngineV2 = require('./structureEngineV2');

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

function validateClosedKlines(klines, timeframe) {
  const duration = timeframe === '4H' ? FOUR_HOURS : ONE_HOUR;
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error(timeframe + ' closed Klines are required.');
  }
  for (let index = 0; index < klines.length; index += 1) {
    if (
      !Number.isFinite(klines[index].openTime) ||
      !Number.isFinite(klines[index].closeTime)
    ) {
      throw new Error(timeframe + ' Kline time is invalid at ' + index);
    }
    if (klines[index].closeTime < klines[index].openTime + duration - 1) {
      throw new Error(timeframe + ' Kline is not fully closed at ' + index);
    }
    if (
      index > 0 &&
      klines[index].openTime - klines[index - 1].openTime !== duration
    ) {
      throw new Error(timeframe + ' Klines must be continuous.');
    }
  }
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

function serializeSwing(swing, klines) {
  return {
    type: swing.type === 'HIGH' ? 'SWING_HIGH' : 'SWING_LOW',
    price: swing.price,
    index: swing.index,
    availableIndex: getSwingAvailableIndex(swing),
    time: klines[swing.index].openTime,
  };
}

function samePrice(left, right) {
  const reference = Math.max(Math.abs(left), Math.abs(right));
  if (reference === 0) return left === right;
  return Math.abs(left - right) / reference <= EQUAL_TOLERANCE;
}

function classifySwing(swing, previous) {
  if (!previous) return swing.type === 'HIGH' ? 'H' : 'L';
  if (swing.type === 'HIGH') {
    return swing.price > previous.price ? 'HH' : 'LH';
  }
  return swing.price > previous.price ? 'HL' : 'LL';
}

function marketState(latestHighLabel, latestLowLabel) {
  if (latestHighLabel === 'HH' && latestLowLabel === 'HL') {
    return 'BULLISH';
  }
  if (latestHighLabel === 'LH' && latestLowLabel === 'LL') {
    return 'BEARISH';
  }
  return 'NEUTRAL';
}

function structureEventTimeline(klines, swings) {
  const result = StructureEngineV2.analyze(
    klines,
    swings,
    {
      averageLength: 20,
      displacementMultiplier: 1.5,
      minBodyRatio: 0.65,
    }
  );
  const eventsByIndex = {};
  for (const event of result.events) {
    if (
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
  return eventsByIndex;
}

function latestSequenceItem(sequence, labels) {
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    if (labels.indexOf(sequence[index].label) !== -1) {
      return sequence[index];
    }
  }
  return null;
}

function buildDealingRange(
  state,
  sequence,
  referencePrice
) {
  let highItem;
  let lowItem;

  if (state === 'BULLISH') {
    highItem = latestSequenceItem(sequence, ['HH']);
    lowItem = latestSequenceItem(sequence, ['HL']);
  } else if (state === 'BEARISH') {
    highItem = latestSequenceItem(sequence, ['LH']);
    lowItem = latestSequenceItem(sequence, ['LL']);
  } else {
    highItem = latestSequenceItem(sequence, ['HH', 'LH', 'H']);
    lowItem = latestSequenceItem(sequence, ['HL', 'LL', 'L']);
  }

  if (
    !highItem ||
    !lowItem ||
    highItem.price <= lowItem.price
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

  const high = highItem.price;
  const low = lowItem.price;
  const equilibrium = (high + low) / 2;
  return {
    high,
    low,
    equilibrium,
    location: referencePrice > equilibrium
      ? 'PREMIUM'
      : referencePrice < equilibrium
        ? 'DISCOUNT'
        : 'EQUILIBRIUM',
    highSource: highItem.swing,
    lowSource: lowItem.swing,
    availableIndex: Math.max(
      highItem.availableIndex,
      lowItem.availableIndex
    ),
  };
}

function buildStructureTimeline(klines) {
  const swings = Swing.filterSwings(
    Pivot.findPivots(klines, 2, 2)
  ).map((swing, order) => ({ swing, order }))
    .sort((left, right) => {
      const difference =
        getSwingAvailableIndex(left.swing) -
        getSwingAvailableIndex(right.swing);
      if (difference !== 0) return difference;
      return left.order - right.order;
    })
    .map((item) => item.swing);
  const swingsByIndex = {};
  for (const swing of swings) {
    const availableIndex = getSwingAvailableIndex(swing);
    if (!swingsByIndex[availableIndex]) {
      swingsByIndex[availableIndex] = [];
    }
    swingsByIndex[availableIndex].push(swing);
  }
  const eventsByIndex = structureEventTimeline(klines, swings);
  const states = [];
  const sequence = [];
  let previousHigh = null;
  let previousLow = null;
  let latestHigh = null;
  let latestLow = null;
  let latestHighLabel = null;
  let latestLowLabel = null;
  let lastStructureEvent = null;

  for (let index = 0; index < klines.length; index += 1) {
    for (const swing of swingsByIndex[index] || []) {
      const previous = swing.type === 'HIGH'
        ? previousHigh
        : previousLow;
      const label = classifySwing(swing, previous);
      const item = {
        label,
        type: swing.type,
        price: swing.price,
        index: swing.index,
        availableIndex: getSwingAvailableIndex(swing),
        swing: serializeSwing(swing, klines),
      };
      sequence.push(item);
      if (swing.type === 'HIGH') {
        previousHigh = swing;
        latestHigh = item.swing;
        latestHighLabel = label;
      } else {
        previousLow = swing;
        latestLow = item.swing;
        latestLowLabel = label;
      }
    }
    for (const event of eventsByIndex[index] || []) {
      lastStructureEvent = {
        type: event.type,
        direction: event.direction,
        level: event.level,
        availableIndex: event.availableIndex,
      };
    }

    const state = marketState(latestHighLabel, latestLowLabel);
    states.push({
      index,
      time: klines[index].closeTime,
      referencePrice: klines[index].close,
      state,
      sequence: sequence
        .filter((item) => (
          item.label === 'HH' ||
          item.label === 'HL' ||
          item.label === 'LH' ||
          item.label === 'LL'
        ))
        .slice(-8)
        .map((item) => ({
          label: item.label,
          type: item.type,
          price: item.price,
          index: item.index,
          availableIndex: item.availableIndex,
        })),
      lastConfirmedSwingHigh: latestHigh,
      lastConfirmedSwingLow: latestLow,
      lastStructureEvent,
      dealingRange: buildDealingRange(
        state,
        sequence,
        klines[index].close
      ),
    });
  }

  return {
    klines,
    swings: swings.map((swing) => serializeSwing(swing, klines)),
    rawSwings: swings,
    states,
  };
}

function periodStart(time, duration, anchor) {
  return Math.floor((time - anchor) / duration) * duration + anchor;
}

function aggregatePeriods(klines, duration, anchor) {
  const result = [];
  let current = null;

  function appendComplete() {
    if (
      current &&
      current.firstOpenTime === current.start &&
      current.closeTime >= current.start + duration - 1
    ) {
      result.push(current);
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
  return result;
}

function firstIndexAtOrAfter(klines, time) {
  let low = 0;
  let high = klines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle].openTime < time) low = middle + 1;
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
    const availableIndex = firstIndexAtOrAfter(klines, period.end);
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
  for (const rawSwing of timeline.rawSwings) {
    const availableIndex = getSwingAvailableIndex(rawSwing);
    const side = rawSwing.type === 'HIGH'
      ? 'BUY_SIDE'
      : 'SELL_SIDE';
    result.push(createLiquidity(
      prefix + '_SWING_' + rawSwing.type,
      side,
      rawSwing.price,
      rawSwing.index,
      availableIndex
    ));
    if (
      previous[rawSwing.type] &&
      samePrice(previous[rawSwing.type].price, rawSwing.price)
    ) {
      result.push(createLiquidity(
        rawSwing.type === 'HIGH' ? 'EQUAL_HIGH' : 'EQUAL_LOW',
        side,
        (
          previous[rawSwing.type].price + rawSwing.price
        ) / 2,
        rawSwing.index,
        availableIndex
      ));
    }
    previous[rawSwing.type] = rawSwing;
  }
}

function applyLiquidityLifecycle(levels, klines) {
  for (const level of levels) {
    const start = (
      level.type === 'PDH' ||
      level.type === 'PDL' ||
      level.type === 'PWH' ||
      level.type === 'PWL'
    )
      ? level.availableIndex
      : level.availableIndex + 1;
    for (let index = start; index < klines.length; index += 1) {
      const swept = level.side === 'BUY_SIDE'
        ? klines[index].high >= level.price
        : klines[index].low <= level.price;
      if (swept) {
        level.sweptIndex = index;
        break;
      }
    }
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

function buildH1Liquidity(timeline) {
  const levels = [];
  addSwingLiquidity(levels, timeline, 'H1');
  return applyLiquidityLifecycle(levels, timeline.klines);
}

function projectLiquidity(levels, index, referencePrice) {
  const active = levels.filter((level) => (
    level.availableIndex <= index &&
    (
      !Number.isInteger(level.sweptIndex) ||
      level.sweptIndex > index
    )
  ));
  const buySideLiquidity = active
    .filter((level) => (
      level.side === 'BUY_SIDE' &&
      level.price >= referencePrice
    ))
    .map((level) => ({
      type: level.type,
      side: level.side,
      price: level.price,
      status: 'ACTIVE',
      availableIndex: level.availableIndex,
    }));
  const sellSideLiquidity = active
    .filter((level) => (
      level.side === 'SELL_SIDE' &&
      level.price <= referencePrice
    ))
    .map((level) => ({
      type: level.type,
      side: level.side,
      price: level.price,
      status: 'ACTIVE',
      availableIndex: level.availableIndex,
    }));
  return {
    buySideLiquidity,
    sellSideLiquidity,
  };
}

function distancePercent(price, referencePrice) {
  return referencePrice !== 0
    ? Math.abs(price - referencePrice) / referencePrice * 100
    : null;
}

function selectPrimaryTarget(levels, referencePrice) {
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
    price: selected.price,
    type: selected.type,
    availableIndex: selected.availableIndex,
    distancePercent: distancePercent(
      selected.price,
      referencePrice
    ),
  };
}

function resolveBias(structureState, dealingRange, liquidity, price) {
  const reasons = [];
  let direction = 'NEUTRAL';

  if (
    structureState === 'BULLISH' &&
    dealingRange.location === 'DISCOUNT'
  ) {
    direction = 'BULLISH';
    reasons.push('HH_HL_STRUCTURE', 'PRICE_IN_DISCOUNT');
  } else if (
    structureState === 'BEARISH' &&
    dealingRange.location === 'PREMIUM'
  ) {
    direction = 'BEARISH';
    reasons.push('LH_LL_STRUCTURE', 'PRICE_IN_PREMIUM');
  } else {
    reasons.push('STRUCTURE_LOCATION_CONFLICT');
  }

  const candidateLevels = direction === 'BULLISH'
    ? liquidity.buySideLiquidity
    : direction === 'BEARISH'
      ? liquidity.sellSideLiquidity
      : [];
  const primaryLiquidityTarget = selectPrimaryTarget(
    candidateLevels,
    price
  );
  if (direction !== 'NEUTRAL' && !primaryLiquidityTarget) {
    direction = 'NEUTRAL';
    reasons.push('NO_ACTIVE_DIRECTIONAL_LIQUIDITY');
  }

  return {
    direction,
    reasons,
    primaryLiquidityTarget:
      direction === 'NEUTRAL' ? null : primaryLiquidityTarget,
  };
}

function buildH4States(timeline, levels) {
  return timeline.states.map((state) => {
    const liquidity = projectLiquidity(
      levels,
      state.index,
      state.referencePrice
    );
    return {
      index: state.index,
      time: state.time,
      referencePrice: state.referencePrice,
      swings: {
        lastConfirmedSwingHigh: state.lastConfirmedSwingHigh,
        lastConfirmedSwingLow: state.lastConfirmedSwingLow,
      },
      marketStructure: {
        state: state.state,
        sequence: state.sequence,
        lastStructureEvent: state.lastStructureEvent,
      },
      dealingRange: state.dealingRange,
      liquidity,
      bias: resolveBias(
        state.state,
        state.dealingRange,
        liquidity,
        state.referencePrice
      ),
    };
  });
}

function deliveryDirection(structureState) {
  if (structureState === 'BULLISH') return 'UP';
  if (structureState === 'BEARISH') return 'DOWN';
  return 'TRANSITION';
}

function buildH1States(timeline, levels) {
  return timeline.states.map((state) => {
    const liquidity = projectLiquidity(
      levels,
      state.index,
      state.referencePrice
    );
    const direction = deliveryDirection(state.state);
    const movingTowardLiquidity = selectPrimaryTarget(
      direction === 'UP'
        ? liquidity.buySideLiquidity
        : direction === 'DOWN'
          ? liquidity.sellSideLiquidity
          : [],
      state.referencePrice
    );
    return {
      index: state.index,
      time: state.time,
      referencePrice: state.referencePrice,
      structure: {
        state: state.state,
        sequence: state.sequence,
        lastStructureEvent: state.lastStructureEvent,
      },
      delivery: {
        direction,
        movingTowardLiquidity,
      },
    };
  });
}

function latestClosedIndex(klines, timestamp) {
  let low = 0;
  let high = klines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle].closeTime <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function analyze(input) {
  input = input || {};
  const h4Klines = input.h4Klines;
  const h1Klines = input.h1Klines;
  validateClosedKlines(h4Klines, '4H');
  validateClosedKlines(h1Klines, '1H');

  const h4Timeline = buildStructureTimeline(h4Klines);
  const h1Timeline = buildStructureTimeline(h1Klines);
  const h4Levels = buildH4Liquidity(h4Timeline);
  const h1Levels = buildH1Liquidity(h1Timeline);
  const h4States = buildH4States(h4Timeline, h4Levels);
  const h1States = buildH1States(h1Timeline, h1Levels);
  const snapshots = h1States.map((h1) => {
    const h4Index = latestClosedIndex(h4Klines, h1.time);
    return {
      timestamp: h1.time,
      h4: h4Index >= 0 ? h4States[h4Index] : null,
      h1,
    };
  });

  return {
    protocol: {
      input: 'Complete closed 4H and 1H Klines only',
      causalSwings: true,
      usesAvailableIndex: true,
      reads5mSetups: false,
      readsBaselineTrades: false,
      generatesEntry: false,
      h1CanModifyH4Bias: false,
    },
    h4: {
      swings: h4Timeline.swings,
      states: h4States,
    },
    h1: {
      swings: h1Timeline.swings,
      states: h1States,
    },
    snapshots,
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
  buildDealingRange,
  buildH1Liquidity,
  buildH1States,
  buildH4Liquidity,
  buildH4States,
  buildStructureTimeline,
  classifySwing,
  deliveryDirection,
  marketState,
  projectLiquidity,
  resolveBias,
  selectPrimaryTarget,
};
