'use strict';

const HTFContextAnalyzer = require(
  '../indicators/htfContextAnalyzer'
);

const HORIZONS = Object.freeze([24, 48, 72]);
const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function isBosOrMss(event) {
  return event && (
    event.type === 'BULLISH_BOS' ||
    event.type === 'BEARISH_BOS' ||
    event.type === 'BULLISH_MSS' ||
    event.type === 'BEARISH_MSS'
  );
}

function structureKind(type) {
  return String(type).endsWith('_MSS') ? 'MSS' : 'BOS';
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

function buildDealingRangeTimeline(structureTimeline) {
  const swings = structureTimeline.swings
    .map((swing, order) => ({ swing, order }))
    .sort((left, right) => {
      const availableDifference =
        getSwingAvailableIndex(left.swing) -
        getSwingAvailableIndex(right.swing);
      if (availableDifference !== 0) return availableDifference;
      return left.order - right.order;
    })
    .map((item) => item.swing);
  const snapshots = [];
  let latestHigh = null;
  let latestLow = null;
  let cursor = 0;

  for (
    let index = 0;
    index < structureTimeline.klines.length;
    index += 1
  ) {
    while (
      cursor < swings.length &&
      getSwingAvailableIndex(swings[cursor]) <= index
    ) {
      if (swings[cursor].type === 'HIGH') {
        latestHigh = swings[cursor];
      }
      if (swings[cursor].type === 'LOW') {
        latestLow = swings[cursor];
      }
      cursor += 1;
    }
    snapshots.push({ high: latestHigh, low: latestLow });
  }

  return {
    klines: structureTimeline.klines,
    snapshots,
  };
}

function getPremiumDiscount(timeline, index, price) {
  const snapshot = timeline.snapshots[index];

  if (
    !snapshot ||
    !snapshot.high ||
    !snapshot.low ||
    !Number.isFinite(price)
  ) {
    return {
      high: null,
      low: null,
      equilibrium: null,
      position: 'UNKNOWN',
    };
  }

  const high = snapshot.high.price;
  const low = snapshot.low.price;
  const equilibrium = (high + low) / 2;

  return {
    high,
    low,
    equilibrium,
    position: price < equilibrium
      ? 'DISCOUNT'
      : price > equilibrium
        ? 'PREMIUM'
        : 'EQUILIBRIUM',
  };
}

function isRangeAligned(direction, position) {
  if (direction === 'BULLISH') {
    return position === 'DISCOUNT' || position === 'EQUILIBRIUM';
  }
  if (direction === 'BEARISH') {
    return position === 'PREMIUM' || position === 'EQUILIBRIUM';
  }
  return false;
}

function buildStructureEvents(
  timeline,
  timeframe,
  rawKlines,
  dealingRangeTimeline
) {
  return timeline.events.filter(isBosOrMss).map((event) => {
    const aggregated = timeline.klines[event.availableIndex];
    const sourceIndex = aggregated.sourceEndIndex;
    const sourceKline = rawKlines[sourceIndex];
    const premiumDiscount = dealingRangeTimeline
      ? getPremiumDiscount(
        dealingRangeTimeline,
        event.availableIndex,
        sourceKline.close
      )
      : null;

    if (premiumDiscount) {
      premiumDiscount.aligned = isRangeAligned(
        event.direction,
        premiumDiscount.position
      );
    }

    return {
      category: timeframe + '_STRUCTURE',
      timeframe,
      type: event.type,
      structure: structureKind(event.type),
      direction: event.direction,
      trend: timeline.snapshots[event.availableIndex].trend,
      htfIndex: event.availableIndex,
      sourceIndex,
      eventTime: sourceKline.closeTime,
      referenceOpenTime: sourceKline.openTime,
      referencePrice: sourceKline.close,
      premiumDiscount,
    };
  });
}

function buildDailyLiquidityEvents(klines) {
  const levels = HTFContextAnalyzer.buildPreviousDayLevels(klines);
  const touchedByDay = {};
  const events = [];

  for (let index = 0; index < klines.length; index += 1) {
    const kline = klines[index];
    const dayStart = Math.floor(
      kline.openTime / HTFContextAnalyzer.ONE_DAY
    ) * HTFContextAnalyzer.ONE_DAY;
    const previousDay = levels[dayStart - HTFContextAnalyzer.ONE_DAY];

    if (!previousDay) continue;
    if (!touchedByDay[dayStart]) {
      touchedByDay[dayStart] = { pdh: false, pdl: false };
    }

    if (!touchedByDay[dayStart].pdh && kline.high >= previousDay.pdh) {
      touchedByDay[dayStart].pdh = true;
      events.push({
        category: 'DAILY_LIQUIDITY',
        timeframe: 'DAILY',
        type: 'PDH_TOUCH',
        level: 'PDH',
        levelPrice: previousDay.pdh,
        direction: 'BEARISH',
        sourceIndex: index,
        eventTime: kline.closeTime,
        referenceOpenTime: kline.openTime,
        referencePrice: kline.close,
      });
    }

    if (!touchedByDay[dayStart].pdl && kline.low <= previousDay.pdl) {
      touchedByDay[dayStart].pdl = true;
      events.push({
        category: 'DAILY_LIQUIDITY',
        timeframe: 'DAILY',
        type: 'PDL_TOUCH',
        level: 'PDL',
        levelPrice: previousDay.pdl,
        direction: 'BULLISH',
        sourceIndex: index,
        eventTime: kline.closeTime,
        referenceOpenTime: kline.openTime,
        referencePrice: kline.close,
      });
    }
  }

  return events;
}

function isCombinationAligned(context) {
  const bullish = context.direction === 'BULLISH';
  const bearish = context.direction === 'BEARISH';
  const trendAligned = context.fourHourTrend === context.direction;
  const rangeAligned = bullish
    ? context.premiumDiscount === 'DISCOUNT' ||
      context.premiumDiscount === 'EQUILIBRIUM'
    : bearish && (
      context.premiumDiscount === 'PREMIUM' ||
      context.premiumDiscount === 'EQUILIBRIUM'
    );
  const liquidityAligned = bullish
    ? context.previousDayLocation === 'BELOW_PDL'
    : bearish && context.previousDayLocation === 'ABOVE_PDH';

  return trendAligned && rangeAligned && liquidityAligned;
}

function buildCombinationEvents(
  oneHourEvents,
  fourHourTimeline,
  fourHourDealingRange,
  previousDayLevels,
  klines
) {
  const result = [];

  for (const event of oneHourEvents) {
    const kline = klines[event.sourceIndex];
    const h4 = HTFContextAnalyzer.getTimeframeContext(
      fourHourTimeline,
      event.sourceIndex
    );
    const h4Index = findLatestClosedIndex(
      fourHourTimeline.klines,
      event.sourceIndex
    );
    const range = getPremiumDiscount(
      fourHourDealingRange,
      h4Index,
      event.referencePrice
    );
    const previousDay = HTFContextAnalyzer.getPreviousDayContext(
      previousDayLevels,
      kline
    );
    const context = {
      direction: event.direction,
      fourHourTrend: h4.trend,
      premiumDiscount: range.position,
      previousDayLocation: previousDay.location,
    };

    if (!isCombinationAligned(context)) continue;

    result.push({
      category: 'HTF_COMBINATION',
      timeframe: '1H_TRIGGER',
      type: 'HTF_ALIGNMENT',
      structure: event.structure,
      direction: event.direction,
      sourceIndex: event.sourceIndex,
      eventTime: event.eventTime,
      referenceOpenTime: event.referenceOpenTime,
      referencePrice: event.referencePrice,
      h1Structure: event.type,
      fourHourTrend: h4.trend,
      fourHourStructure: h4.structure,
      premiumDiscount: range.position,
      previousDayLocation: previousDay.location,
    });
  }

  return result;
}

function findLatestClosedIndex(aggregatedKlines, sourceIndex) {
  let low = 0;
  let high = aggregatedKlines.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (aggregatedKlines[middle].sourceEndIndex <= sourceIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low - 1;
}

function findExactOpenTime(klines, openTime) {
  let low = 0;
  let high = klines.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle].openTime === openTime) return middle;
    if (klines[middle].openTime < openTime) low = middle + 1;
    else high = middle - 1;
  }

  return -1;
}

function evaluateEvent(event, klines, horizonHours) {
  const endIndex = findExactOpenTime(
    klines,
    event.referenceOpenTime + horizonHours * ONE_HOUR
  );

  if (endIndex < 0 || endIndex <= event.sourceIndex) return null;

  let maximumHigh = -Infinity;
  let minimumLow = Infinity;

  for (
    let index = event.sourceIndex + 1;
    index <= endIndex;
    index += 1
  ) {
    maximumHigh = Math.max(maximumHigh, klines[index].high);
    minimumLow = Math.min(minimumLow, klines[index].low);
  }

  const rawReturn = (
    klines[endIndex].close / event.referencePrice - 1
  ) * 100;
  const directionalReturn = event.direction === 'BULLISH'
    ? rawReturn
    : -rawReturn;
  const favorable = event.direction === 'BULLISH'
    ? (maximumHigh / event.referencePrice - 1) * 100
    : (event.referencePrice - minimumLow) /
      event.referencePrice * 100;
  const adverse = event.direction === 'BULLISH'
    ? (event.referencePrice - minimumLow) /
      event.referencePrice * 100
    : (maximumHigh / event.referencePrice - 1) * 100;

  return {
    horizonHours,
    endIndex,
    endTime: klines[endIndex].closeTime,
    endPrice: klines[endIndex].close,
    directionCorrect: directionalReturn > 0,
    rawReturn,
    return: directionalReturn,
    mfe: Math.max(0, favorable),
    mae: Math.max(0, adverse),
  };
}

function attachOutcomes(events, klines, horizons) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateEvent(event, klines, hours),
    ])),
  }));
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function summarize(events, horizonHours) {
  const key = horizonHours + 'h';
  const outcomes = events
    .map((event) => event.outcomes[key])
    .filter(Boolean);

  return {
    events: outcomes.length,
    directionAccuracy: outcomes.length > 0
      ? outcomes.filter((outcome) => outcome.directionCorrect).length /
        outcomes.length
      : null,
    averageReturn: average(outcomes.map((outcome) => outcome.return)),
    averageRawReturn: average(
      outcomes.map((outcome) => outcome.rawReturn)
    ),
    averageMFE: average(outcomes.map((outcome) => outcome.mfe)),
    averageMAE: average(outcomes.map((outcome) => outcome.mae)),
    maximumMFE: outcomes.length > 0
      ? Math.max(...outcomes.map((outcome) => outcome.mfe))
      : null,
    maximumMAE: outcomes.length > 0
      ? Math.max(...outcomes.map((outcome) => outcome.mae))
      : null,
  };
}

function summarizeHorizons(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => [
    hours + 'h',
    summarize(events, hours),
  ]));
}

function summarizeGroups(events, property, horizons) {
  const values = [...new Set(events.map((event) => event[property]))]
    .filter((value) => value !== null && value !== undefined)
    .sort();

  return Object.fromEntries(values.map((value) => [
    value,
    summarizeHorizons(
      events.filter((event) => event[property] === value),
      horizons
    ),
  ]));
}

function validateKlines(klines) {
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error('BTCUSDT 5m Klines are required.');
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
  const horizons = settings.horizons || HORIZONS;
  const oneHourTimeline = HTFContextAnalyzer.buildStructureTimeline(
    HTFContextAnalyzer.aggregateClosedKlines(
      klines,
      HTFContextAnalyzer.ONE_HOUR
    )
  );
  const fourHourTimeline = HTFContextAnalyzer.buildStructureTimeline(
    HTFContextAnalyzer.aggregateClosedKlines(
      klines,
      HTFContextAnalyzer.FOUR_HOURS
    )
  );
  const fourHourDealingRange = buildDealingRangeTimeline(
    fourHourTimeline
  );
  const previousDayLevels =
    HTFContextAnalyzer.buildPreviousDayLevels(klines);
  const fourHourEvents = attachOutcomes(
    buildStructureEvents(
      fourHourTimeline,
      '4H',
      klines,
      fourHourDealingRange
    ),
    klines,
    horizons
  );
  const oneHourEvents = attachOutcomes(
    buildStructureEvents(oneHourTimeline, '1H', klines),
    klines,
    horizons
  );
  const dailyEvents = attachOutcomes(
    buildDailyLiquidityEvents(klines),
    klines,
    horizons
  );
  const combinationEvents = attachOutcomes(
    buildCombinationEvents(
      oneHourEvents,
      fourHourTimeline,
      fourHourDealingRange,
      previousDayLevels,
      klines
    ),
    klines,
    horizons
  );
  const result = {
    protocol: {
      standalone: true,
      symbol: 'BTCUSDT',
      sourceTimeframe: '5m',
      reads5mSetups: false,
      usesBaselineTrades: false,
      usesEntryOrExit: false,
      eventAvailability:
        'BOS/MSS uses availableIndex; premium/discount uses confirmed swings only',
      pdhPdlDefinition:
        'First touch per UTC day of the previous complete day high/low',
      pdhPdlDirection:
        'PDH touch tests bearish reaction; PDL touch tests bullish reaction',
      combinationDefinition:
        '1H BOS/MSS direction aligned with 4H trend, 4H premium/discount and PDH/PDL location',
      forwardWindow:
        'Starts on the first 5m bar after event availability',
      units: 'Return, MFE and MAE are percentages',
    },
    data: {
      klineCount: klines.length,
      startTime: new Date(klines[0].openTime).toISOString(),
      endTime: new Date(
        klines[klines.length - 1].openTime
      ).toISOString(),
    },
    eventCounts: {
      fourHour: fourHourEvents.length,
      oneHour: oneHourEvents.length,
      dailyLiquidity: dailyEvents.length,
      combination: combinationEvents.length,
    },
    fourHour: {
      overall: summarizeHorizons(fourHourEvents, horizons),
      byStructure: summarizeGroups(
        fourHourEvents,
        'structure',
        horizons
      ),
      byTrend: summarizeGroups(fourHourEvents, 'trend', horizons),
      byPremiumDiscount: summarizeGroups(
        fourHourEvents.map((event) => ({
          ...event,
          position: event.premiumDiscount.position,
        })),
        'position',
        horizons
      ),
      byRangeAlignment: summarizeGroups(
        fourHourEvents.map((event) => ({
          ...event,
          rangeAlignment: event.premiumDiscount.position === 'UNKNOWN'
            ? 'UNKNOWN'
            : event.premiumDiscount.aligned
              ? 'ALIGNED'
              : 'MISALIGNED',
        })),
        'rangeAlignment',
        horizons
      ),
    },
    oneHour: {
      overall: summarizeHorizons(oneHourEvents, horizons),
      byStructure: summarizeGroups(
        oneHourEvents,
        'structure',
        horizons
      ),
      byTrend: summarizeGroups(oneHourEvents, 'trend', horizons),
    },
    daily: {
      overall: summarizeHorizons(dailyEvents, horizons),
      byLevel: summarizeGroups(dailyEvents, 'level', horizons),
    },
    combination: {
      overall: summarizeHorizons(combinationEvents, horizons),
      byDirection: summarizeGroups(
        combinationEvents,
        'direction',
        horizons
      ),
      byStructure: summarizeGroups(
        combinationEvents,
        'structure',
        horizons
      ),
    },
  };

  if (settings.includeEvents !== false) {
    result.events = {
      fourHour: fourHourEvents,
      oneHour: oneHourEvents,
      dailyLiquidity: dailyEvents,
      combination: combinationEvents,
    };
  }

  return result;
}

module.exports = {
  FIVE_MINUTES,
  HORIZONS,
  analyze,
  attachOutcomes,
  buildCombinationEvents,
  buildDailyLiquidityEvents,
  buildDealingRangeTimeline,
  buildStructureEvents,
  evaluateEvent,
  findExactOpenTime,
  getPremiumDiscount,
  isBosOrMss,
  isCombinationAligned,
  isRangeAligned,
  structureKind,
  summarize,
  summarizeGroups,
  summarizeHorizons,
};
