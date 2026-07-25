'use strict';

const Pivot = require('./pivot');
const Swing = require('./swing');
const HtfBiasV2 = require('./ictHtfBiasEngineV2');

const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const EQUAL_TOLERANCE = 0.001;
const DISPLACEMENT_BODY_RATIO = 0.65;
const PRIOR_BODY_RATIO = 0.6;
const RANGE_EXPANSION_MULTIPLIER = 1.5;
const RANGE_AVERAGE_LENGTH = 20;
const MAX_ACTIVE_LEVELS = 24;
const MAX_SWEPT_LEVELS = 12;

const EXTERNAL_TYPES = new Set([
  'PDH',
  'PDL',
  'H4_SWING_HIGH',
  'H4_SWING_LOW',
]);

const LIQUIDITY_PRIORITY = Object.freeze({
  PDH: 5,
  PDL: 5,
  H4_SWING_HIGH: 4,
  H4_SWING_LOW: 4,
  H1_SWING_HIGH: 3,
  H1_SWING_LOW: 3,
  EQUAL_HIGH: 3,
  EQUAL_LOW: 3,
  LTF_SWING_HIGH: 2,
  LTF_SWING_LOW: 2,
});

function inferDuration(klines, requestedDuration) {
  if (
    requestedDuration === FIVE_MINUTES ||
    requestedDuration === FIFTEEN_MINUTES
  ) {
    return requestedDuration;
  }
  if (klines.length < 2) {
    throw new Error('At least two LTF Klines are required.');
  }
  const duration = klines[1].openTime - klines[0].openTime;
  if (duration !== FIVE_MINUTES && duration !== FIFTEEN_MINUTES) {
    throw new Error('LTF Klines must be 5m or 15m.');
  }
  return duration;
}

function validateClosedLtfKlines(klines, requestedDuration) {
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error('Complete closed 5m/15m Klines are required.');
  }
  const duration = inferDuration(klines, requestedDuration);
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
      throw new Error('LTF Kline is invalid at ' + index);
    }
    if (bar.closeTime < bar.openTime + duration - 1) {
      throw new Error('LTF Kline is not fully closed at ' + index);
    }
    if (
      index > 0 &&
      bar.openTime - klines[index - 1].openTime !== duration
    ) {
      throw new Error('LTF Klines must be continuous.');
    }
  }
  return duration;
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

function buildLtfStructureTimeline(klines, options) {
  options = options || {};
  const compactStates = options.compactStates === true;
  const swings = Swing.filterSwings(
    Pivot.findPivots(klines, 2, 2)
  ).map((swing, order) => ({ swing, order }))
    .sort((left, right) => {
      const difference =
        getAvailableIndex(left.swing) -
        getAvailableIndex(right.swing);
      return difference || left.order - right.order;
    })
    .map((item) => item.swing);
  const byAvailability = {};
  for (const swing of swings) {
    const availableIndex = getAvailableIndex(swing);
    if (!byAvailability[availableIndex]) {
      byAvailability[availableIndex] = [];
    }
    byAvailability[availableIndex].push(swing);
  }

  const sequence = [];
  const states = [];
  let previousHigh = null;
  let previousLow = null;
  let lastHigh = null;
  let lastLow = null;
  let highLabel = null;
  let lowLabel = null;
  let lastLH = null;
  let lastHL = null;

  for (let index = 0; index < klines.length; index += 1) {
    for (const swing of byAvailability[index] || []) {
      const previous = swing.type === 'HIGH'
        ? previousHigh
        : previousLow;
      const label = classifySwing(swing, previous);
      const item = Object.freeze({
        label,
        type: swing.type,
        price: swing.price,
        index: swing.index,
        availableIndex: getAvailableIndex(swing),
        time: klines[swing.index].openTime,
      });
      if (label !== 'H' && label !== 'L') sequence.push(item);
      if (label === 'LH') lastLH = item;
      if (label === 'HL') lastHL = item;
      if (swing.type === 'HIGH') {
        previousHigh = swing;
        lastHigh = item;
        highLabel = label;
      } else {
        previousLow = swing;
        lastLow = item;
        lowLabel = label;
      }
    }
    states.push(compactStates
      ? {
        state: resolveStructureState(highLabel, lowLabel),
        lastLH,
        lastHL,
      }
      : {
        state: resolveStructureState(highLabel, lowLabel),
        swingSequence: sequence.slice(-12),
        lastConfirmedSwingHigh: lastHigh,
        lastConfirmedSwingLow: lastLow,
      });
  }
  return {
    rawSwings: swings,
    swings: swings.map((swing) => ({
      type: swing.type === 'HIGH' ? 'SWING_HIGH' : 'SWING_LOW',
      price: swing.price,
      index: swing.index,
      availableIndex: getAvailableIndex(swing),
      time: klines[swing.index].openTime,
    })),
    states,
  };
}

function samePrice(left, right) {
  const reference = Math.max(Math.abs(left), Math.abs(right));
  if (reference === 0) return left === right;
  return Math.abs(left - right) / reference <= EQUAL_TOLERANCE;
}

function createLevel(
  type,
  side,
  price,
  source,
  formedIndex,
  availableIndex,
  sweepStartIndex
) {
  return {
    id: [
      source,
      type,
      price,
      availableIndex,
    ].join(':'),
    type,
    side,
    price,
    source,
    formedIndex,
    availableIndex,
    sweepStartIndex,
    sweptIndex: null,
  };
}

function buildInternalLiquidity(structureTimeline) {
  const levels = [];
  const previous = { HIGH: null, LOW: null };
  for (const swing of structureTimeline.rawSwings) {
    const availableIndex = getAvailableIndex(swing);
    const side = swing.type === 'HIGH'
      ? 'BUY_SIDE'
      : 'SELL_SIDE';
    levels.push(createLevel(
      'LTF_SWING_' + swing.type,
      side,
      swing.price,
      'INTERNAL',
      swing.index,
      availableIndex,
      availableIndex + 1
    ));
    if (
      previous[swing.type] &&
      samePrice(previous[swing.type].price, swing.price)
    ) {
      levels.push(createLevel(
        swing.type === 'HIGH' ? 'EQUAL_HIGH' : 'EQUAL_LOW',
        side,
        (previous[swing.type].price + swing.price) / 2,
        'INTERNAL',
        swing.index,
        availableIndex,
        availableIndex + 1
      ));
    }
    previous[swing.type] = swing;
  }
  return levels;
}

function latestSnapshotIndex(snapshots, timestamp) {
  let low = 0;
  let high = snapshots.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (snapshots[middle].time <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function firstLtfIndexAtOrAfter(klines, timestamp) {
  let low = 0;
  let high = klines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle].closeTime < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

function externalAvailabilityTime(level, h4States, fallbackTime) {
  return Number.isInteger(level.availableIndex) &&
    h4States[level.availableIndex]
    ? h4States[level.availableIndex].time
    : fallbackTime;
}

function buildExternalLiquidity(h4States, ltfKlines) {
  const result = [];
  const seen = new Set();
  for (const state of h4States) {
    const liquidity = state.liquidity || {};
    const levels = (liquidity.buySideLiquidity || [])
      .concat(liquidity.sellSideLiquidity || []);
    for (const level of levels) {
      if (!EXTERNAL_TYPES.has(level.type)) continue;
      const key = [
        level.type,
        level.side,
        level.price,
        level.availableIndex,
      ].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const availableTime = externalAvailabilityTime(
        level,
        h4States,
        state.time
      );
      const availableIndex = firstLtfIndexAtOrAfter(
        ltfKlines,
        availableTime
      );
      if (availableIndex >= ltfKlines.length) continue;
      result.push(createLevel(
        level.type,
        level.side,
        level.price,
        'EXTERNAL',
        availableIndex,
        availableIndex,
        availableIndex + 1
      ));
    }
  }
  return result;
}

function buildIntermediateLiquidity(h1States, ltfKlines) {
  const result = [];
  const seen = new Set();
  for (const state of h1States) {
    const structure = state.structure || {};
    for (const swing of structure.swingSequence || []) {
      const key = [
        swing.type,
        swing.index,
        swing.availableIndex,
      ].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const side = swing.type === 'HIGH'
        ? 'BUY_SIDE'
        : 'SELL_SIDE';
      const availableTime = h1States[swing.availableIndex]
        ? h1States[swing.availableIndex].time
        : state.time;
      const availableIndex = firstLtfIndexAtOrAfter(
        ltfKlines,
        availableTime
      );
      if (availableIndex >= ltfKlines.length) continue;
      result.push(createLevel(
        'H1_SWING_' + swing.type,
        side,
        swing.price,
        'INTERMEDIATE',
        availableIndex,
        availableIndex,
        availableIndex + 1
      ));
    }
  }
  return result;
}

function applyLiquidityLifecycle(levels, klines) {
  const priceIndex = HtfBiasV2.buildPriceRangeIndex(klines);
  for (const level of levels) {
    level.sweptIndex = level.side === 'BUY_SIDE'
      ? HtfBiasV2.firstRangeMatch(
        priceIndex.highs,
        level.sweepStartIndex,
        (maximum) => maximum >= level.price
      )
      : HtfBiasV2.firstRangeMatch(
        priceIndex.lows,
        level.sweepStartIndex,
        (minimum) => minimum <= level.price
      );
  }
  return levels;
}

function publicLevel(level, status, klines) {
  return Object.freeze({
    id: level.id,
    type: level.type,
    side: level.side,
    price: level.price,
    source: level.source,
    status,
    availableIndex: level.availableIndex,
    sweptIndex: status === 'SWEPT' ? level.sweptIndex : null,
    time: status === 'SWEPT' && Number.isInteger(level.sweptIndex)
      ? klines[level.sweptIndex].closeTime
      : null,
  });
}

function distance(level, price) {
  return Math.abs(level.price - price);
}

function selectVisibleActive(active, referencePrice, maximum) {
  return [...active.values()]
    .sort((left, right) => {
      const distanceDifference =
        distance(left.raw, referencePrice) -
        distance(right.raw, referencePrice);
      if (distanceDifference !== 0) return distanceDifference;
      return (
        (LIQUIDITY_PRIORITY[right.raw.type] || 0) -
        (LIQUIDITY_PRIORITY[left.raw.type] || 0)
      );
    })
    .slice(0, maximum)
    .map((item) => item.public);
}

function buildLiquidityTimeline(levels, klines, options) {
  options = options || {};
  const maxActive = options.maxActiveLevels || MAX_ACTIVE_LEVELS;
  const maxSwept = options.maxSweptLevels || MAX_SWEPT_LEVELS;
  const eventsOnly = options.eventsOnly === true;
  const availableAt = {};
  const sweptAt = {};
  for (const level of levels) {
    if (!availableAt[level.availableIndex]) {
      availableAt[level.availableIndex] = [];
    }
    availableAt[level.availableIndex].push(level);
    if (Number.isInteger(level.sweptIndex)) {
      if (!sweptAt[level.sweptIndex]) sweptAt[level.sweptIndex] = [];
      sweptAt[level.sweptIndex].push(level);
    }
  }

  const active = new Map();
  const swept = [];
  const snapshots = [];
  const sweepEvents = [];
  for (let index = 0; index < klines.length; index += 1) {
    for (const level of availableAt[index] || []) {
      active.set(level.id, {
        raw: level,
        public: publicLevel(level, 'ACTIVE', klines),
      });
    }
    const currentSweeps = [];
    for (const level of sweptAt[index] || []) {
      active.delete(level.id);
      const event = publicLevel(level, 'SWEPT', klines);
      swept.unshift(event);
      currentSweeps.push(event);
      sweepEvents.push(event);
    }
    snapshots.push(eventsOnly
      ? { currentSweeps }
      : {
        activeLevels: selectVisibleActive(
          active,
          klines[index].close,
          maxActive
        ),
        activeLevelCount: active.size,
        sweptLevels: swept.slice(0, maxSwept),
        currentSweeps,
      });
  }
  return { snapshots, sweepEvents };
}

function candleDirection(bar) {
  if (bar.close > bar.open) return 'BULLISH';
  if (bar.close < bar.open) return 'BEARISH';
  return 'NEUTRAL';
}

function bodyRatio(bar) {
  const range = bar.high - bar.low;
  return range > 0 ? Math.abs(bar.close - bar.open) / range : 0;
}

function averagePriorRange(klines, index, length) {
  if (index < length) return null;
  let total = 0;
  for (let offset = index - length; offset < index; offset += 1) {
    total += klines[offset].high - klines[offset].low;
  }
  return total / length;
}

function detectDisplacement(klines, index, options) {
  options = options || {};
  const averageLength = options.averageLength ||
    RANGE_AVERAGE_LENGTH;
  const minimumBodyRatio = options.minimumBodyRatio ||
    DISPLACEMENT_BODY_RATIO;
  const expansionMultiplier = options.expansionMultiplier ||
    RANGE_EXPANSION_MULTIPLIER;
  if (index < Math.max(1, averageLength)) return null;
  const current = klines[index];
  const previous = klines[index - 1];
  const direction = candleDirection(current);
  const previousDirection = candleDirection(previous);
  const averageRange = averagePriorRange(
    klines,
    index,
    averageLength
  );
  const range = current.high - current.low;
  const ratio = bodyRatio(current);
  const expansion = averageRange > 0 ? range / averageRange : 0;
  const consecutive = (
    direction !== 'NEUTRAL' &&
    direction === previousDirection &&
    bodyRatio(previous) >= PRIOR_BODY_RATIO
  );
  if (
    ratio < minimumBodyRatio ||
    expansion < expansionMultiplier ||
    !consecutive
  ) {
    return null;
  }
  return Object.freeze({
    direction,
    strength: ratio * expansion,
    bodyRatio: ratio,
    rangeExpansion: expansion,
    consecutive: true,
    index,
    time: current.closeTime,
  });
}

function detectFvg(klines, index) {
  if (index < 2) return null;
  const first = klines[index - 2];
  const third = klines[index];
  if (first.high < third.low) {
    return Object.freeze({
      id: 'BULLISH:' + index + ':' + first.high + ':' + third.low,
      direction: 'BULLISH',
      top: third.low,
      bottom: first.high,
      index,
      createdAt: third.closeTime,
      status: 'ACTIVE',
    });
  }
  if (first.low > third.high) {
    return Object.freeze({
      id: 'BEARISH:' + index + ':' + third.high + ':' + first.low,
      direction: 'BEARISH',
      top: first.low,
      bottom: third.high,
      index,
      createdAt: third.closeTime,
      status: 'ACTIVE',
    });
  }
  return null;
}

function latestStructureLevel(structure, label) {
  if (label === 'LH' && structure.lastLH) return structure.lastLH;
  if (label === 'HL' && structure.lastHL) return structure.lastHL;
  if (!Array.isArray(structure.swingSequence)) return null;
  for (
    let index = structure.swingSequence.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (structure.swingSequence[index].label === label) {
      return structure.swingSequence[index];
    }
  }
  return null;
}

function confirmMss(input) {
  const displacement = input.displacement;
  const pendingSweep = input.pendingSweep;
  const structure = input.structure;
  const bar = input.bar;
  const index = input.index;
  if (
    !displacement ||
    !pendingSweep ||
    index <= pendingSweep.index
  ) {
    return null;
  }
  if (
    displacement.direction === 'BULLISH' &&
    pendingSweep.side === 'SELL_SIDE'
  ) {
    const level = latestStructureLevel(structure, 'LH');
    if (level && bar.close > level.price) {
      return Object.freeze({
        direction: 'BULLISH',
        level,
        time: bar.closeTime,
        index,
        sweep: pendingSweep,
      });
    }
  }
  if (
    displacement.direction === 'BEARISH' &&
    pendingSweep.side === 'BUY_SIDE'
  ) {
    const level = latestStructureLevel(structure, 'HL');
    if (level && bar.close < level.price) {
      return Object.freeze({
        direction: 'BEARISH',
        level,
        time: bar.closeTime,
        index,
        sweep: pendingSweep,
      });
    }
  }
  return null;
}

function h4BiasOf(snapshot) {
  if (!snapshot) return 'UNAVAILABLE';
  if (
    snapshot.narrative &&
    typeof snapshot.narrative.bias === 'string'
  ) {
    return snapshot.narrative.bias;
  }
  if (typeof snapshot.bias === 'string') return snapshot.bias;
  if (
    snapshot.bias &&
    typeof snapshot.bias.direction === 'string'
  ) {
    return snapshot.bias.direction;
  }
  return 'NEUTRAL';
}

function h1RelationOf(snapshot) {
  if (!snapshot) return 'UNCLEAR';
  if (typeof snapshot.relationToH4 === 'string') {
    return snapshot.relationToH4;
  }
  if (
    snapshot.relationTo4H &&
    typeof snapshot.relationTo4H.state === 'string'
  ) {
    return snapshot.relationTo4H.state;
  }
  return 'UNCLEAR';
}

function contextDirectionMatches(direction, h4, h1) {
  const h4Bias = h4BiasOf(h4);
  const h1Direction = h1 ? h1.deliveryDirection : null;
  return (
    h4Bias === direction &&
    h1RelationOf(h1) === 'ALIGNED' &&
    h1Direction === direction
  );
}

function selectSweep(currentSweeps, h4Bias, referencePrice) {
  if (currentSweeps.length === 0) return null;
  const preferredSide = h4Bias === 'BULLISH'
    ? 'SELL_SIDE'
    : h4Bias === 'BEARISH'
      ? 'BUY_SIDE'
      : null;
  const preferred = preferredSide
    ? currentSweeps.filter((level) => level.side === preferredSide)
    : [];
  const candidates = preferred.length > 0
    ? preferred
    : currentSweeps;
  return candidates.slice().sort((left, right) => {
    const priorityDifference =
      (LIQUIDITY_PRIORITY[right.type] || 0) -
      (LIQUIDITY_PRIORITY[left.type] || 0);
    if (priorityDifference !== 0) return priorityDifference;
    return distance(left, referencePrice) -
      distance(right, referencePrice);
  })[0];
}

function sweepOutput(level) {
  return level
    ? {
      occurred: true,
      side: level.side,
      level,
      time: level.time,
    }
    : {
      occurred: false,
      side: null,
      level: null,
      time: null,
    };
}

function buildFvgLifecycle(klines) {
  const active = new Map();
  const created = [];
  const mitigations = [];
  const snapshots = [];
  for (let index = 0; index < klines.length; index += 1) {
    const currentMitigations = [];
    for (const fvg of active.values()) {
      const mitigated = fvg.direction === 'BULLISH'
        ? klines[index].low <= fvg.top
        : klines[index].high >= fvg.bottom;
      if (!mitigated) continue;
      const event = Object.freeze({
        id: fvg.id,
        direction: fvg.direction,
        index,
        time: klines[index].closeTime,
        createdIndex: fvg.index,
        barsToMitigation: index - fvg.index,
      });
      active.delete(fvg.id);
      mitigations.push(event);
      currentMitigations.push(event);
    }
    const fvg = detectFvg(klines, index);
    if (fvg) {
      active.set(fvg.id, fvg);
      created.push(fvg);
    }
    snapshots.push({
      created: fvg,
      mitigated: currentMitigations,
      activeCount: active.size,
    });
  }
  return { snapshots, created, mitigations };
}

function analyze(input) {
  input = input || {};
  const klines = input.ltfKlines;
  const retainStates = input.retainStates !== false;
  const duration = validateClosedLtfKlines(
    klines,
    input.intervalMilliseconds
  );
  const h4States = input.h4BiasSnapshots || [];
  const h1States = input.h1DeliverySnapshots || [];
  const structureTimeline = buildLtfStructureTimeline(
    klines,
    { compactStates: !retainStates }
  );
  const internalLevels = buildInternalLiquidity(structureTimeline);
  const externalLevels = buildExternalLiquidity(h4States, klines);
  const intermediateLevels = buildIntermediateLiquidity(
    h1States,
    klines
  );
  const levels = applyLiquidityLifecycle(
    internalLevels.concat(externalLevels, intermediateLevels),
    klines
  );
  const liquidityTimeline = buildLiquidityTimeline(
    levels,
    klines,
    {
      ...(input.liquidityOptions || {}),
      eventsOnly: !retainStates,
    }
  );
  const fvgLifecycle = buildFvgLifecycle(klines);
  const displacementEvents = [];
  const mssEvents = [];
  const setupEvents = [];
  const states = [];
  const pendingSweeps = {
    BUY_SIDE: null,
    SELL_SIDE: null,
  };

  for (let index = 0; index < klines.length; index += 1) {
    const bar = klines[index];
    const h4Index = latestSnapshotIndex(h4States, bar.closeTime);
    const h1Index = latestSnapshotIndex(h1States, bar.closeTime);
    const h4 = h4Index >= 0 ? h4States[h4Index] : null;
    const h1 = h1Index >= 0 ? h1States[h1Index] : null;
    const h4Bias = h4BiasOf(h4);
    const liquidity = liquidityTimeline.snapshots[index];
    for (const level of liquidity.currentSweeps) {
      pendingSweeps[level.side] = Object.freeze({
        side: level.side,
        level,
        index,
        time: bar.closeTime,
      });
    }
    const selectedSweep = selectSweep(
      liquidity.currentSweeps,
      h4Bias,
      bar.close
    );
    const displacement = detectDisplacement(
      klines,
      index,
      input.displacementOptions
    );
    if (displacement) displacementEvents.push(displacement);
    const pendingSweep = displacement &&
      displacement.direction === 'BULLISH'
      ? pendingSweeps.SELL_SIDE
      : displacement &&
        displacement.direction === 'BEARISH'
        ? pendingSweeps.BUY_SIDE
        : null;
    const mss = confirmMss({
      displacement,
      pendingSweep,
      structure: structureTimeline.states[index],
      bar,
      index,
    });
    if (mss) {
      mssEvents.push(mss);
      if (mss.direction === 'BULLISH') {
        pendingSweeps.SELL_SIDE = null;
      } else {
        pendingSweeps.BUY_SIDE = null;
      }
    }
    const fvg = fvgLifecycle.snapshots[index].created;
    const setup = mss &&
      contextDirectionMatches(mss.direction, h4, h1)
      ? Object.freeze({
        direction: mss.direction,
        index,
        time: bar.closeTime,
        referencePrice: bar.close,
        h4Bias,
        h1Delivery: h1 ? h1.deliveryState : null,
        sweep: mss.sweep,
        mss,
        displacement,
        fvg: fvg && fvg.direction === mss.direction ? fvg : null,
      })
      : null;
    if (setup) setupEvents.push(setup);

    if (retainStates) {
      states.push({
        index,
        availableIndex: index,
        time: bar.closeTime,
        referencePrice: bar.close,
        h4Context: {
          snapshotTime: h4 ? h4.time : null,
          bias: h4Bias,
        },
        h1Context: {
          snapshotTime: h1 ? h1.time : null,
          deliveryDirection: h1 ? h1.deliveryDirection : null,
          deliveryState: h1 ? h1.deliveryState : null,
          relationToH4: h1RelationOf(h1),
        },
        structure: structureTimeline.states[index],
        liquidity: {
          activeLevels: liquidity.activeLevels,
          activeLevelCount: liquidity.activeLevelCount,
          sweptLevels: liquidity.sweptLevels,
        },
        sweep: sweepOutput(selectedSweep),
        displacement,
        mss,
        fvg,
        fvgMitigations:
          fvgLifecycle.snapshots[index].mitigated,
        setup,
      });
    }
  }

  return {
    protocol: {
      version: 'ICT_LTF_EXECUTION_ENGINE_V1',
      input: 'Published 4H/1H snapshots and closed 5m/15m Klines',
      intervalMilliseconds: duration,
      usesConfirmedSwings: true,
      usesAvailableIndex: true,
      mssOnlyOnLtf: true,
      readsTrades: false,
      readsBaseline: false,
      generatesEntry: false,
      generatesStop: false,
      generatesTarget: false,
      canModifyHtf: false,
      retainsStates: retainStates,
    },
    swings: structureTimeline.swings,
    states,
    events: {
      sweeps: liquidityTimeline.sweepEvents,
      displacements: displacementEvents,
      mss: mssEvents,
      fvgs: fvgLifecycle.created,
      fvgMitigations: fvgLifecycle.mitigations,
      setups: setupEvents,
    },
  };
}

module.exports = {
  DISPLACEMENT_BODY_RATIO,
  EQUAL_TOLERANCE,
  FIFTEEN_MINUTES,
  FIVE_MINUTES,
  LIQUIDITY_PRIORITY,
  RANGE_AVERAGE_LENGTH,
  RANGE_EXPANSION_MULTIPLIER,
  analyze,
  applyLiquidityLifecycle,
  bodyRatio,
  buildExternalLiquidity,
  buildFvgLifecycle,
  buildInternalLiquidity,
  buildIntermediateLiquidity,
  buildLiquidityTimeline,
  buildLtfStructureTimeline,
  candleDirection,
  confirmMss,
  contextDirectionMatches,
  detectDisplacement,
  detectFvg,
  h1RelationOf,
  h4BiasOf,
  inferDuration,
  latestSnapshotIndex,
  latestStructureLevel,
  selectSweep,
  sweepOutput,
  validateClosedLtfKlines,
};
