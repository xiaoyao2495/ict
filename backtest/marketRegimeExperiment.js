'use strict';

const HTFContextAnalyzer = require(
  '../indicators/htfContextAnalyzer'
);
const HTFFilterExperiment = require(
  './htfFilterExperiment'
);

const REGIMES = Object.freeze([
  'TRENDING',
  'RANGING',
  'EXPANSION',
  'CONTRACTION',
]);
const ATR_LENGTH = 14;
const EMA_FAST_LENGTH = 20;
const EMA_SLOW_LENGTH = 50;
const PERCENTILE_LOOKBACK = 100;
const VOLATILITY_LENGTH = 20;
const BREAKOUT_LOOKBACK = 20;

function trueRange(klines, index) {
  if (!klines[index]) return null;
  if (index === 0 || !klines[index - 1]) {
    return klines[index].high - klines[index].low;
  }

  return Math.max(
    klines[index].high - klines[index].low,
    Math.abs(klines[index].high - klines[index - 1].close),
    Math.abs(klines[index].low - klines[index - 1].close)
  );
}

function calculateTrueRanges(klines) {
  return klines.map((unused, index) => trueRange(klines, index));
}

function calculateEmaSeries(klines, length) {
  const result = new Array(klines.length).fill(null);
  if (klines.length < length || length <= 0) return result;

  let seed = 0;
  for (let index = 0; index < length; index++) {
    seed += klines[index].close;
  }
  result[length - 1] = seed / length;

  const multiplier = 2 / (length + 1);
  for (let index = length; index < klines.length; index++) {
    result[index] = (klines[index].close - result[index - 1]) *
      multiplier + result[index - 1];
  }

  return result;
}

function calculateWilderAtrSeries(klines, length) {
  const ranges = calculateTrueRanges(klines);
  const result = new Array(klines.length).fill(null);
  if (klines.length < length || length <= 0) {
    return { ranges, values: result };
  }

  let seed = 0;
  for (let index = 0; index < length; index++) {
    seed += ranges[index];
  }
  result[length - 1] = seed / length;

  for (let index = length; index < klines.length; index++) {
    result[index] = (
      result[index - 1] * (length - 1) + ranges[index]
    ) / length;
  }

  return { ranges, values: result };
}

function calculateRollingMean(values, length) {
  const result = new Array(values.length).fill(null);
  let sum = 0;

  for (let index = 0; index < values.length; index++) {
    sum += Number.isFinite(values[index]) ? values[index] : 0;
    if (index >= length) {
      sum -= Number.isFinite(values[index - length])
        ? values[index - length]
        : 0;
    }
    if (index >= length - 1) result[index] = sum / length;
  }

  return result;
}

function calculateVolatilitySeries(klines, length) {
  const returns = new Array(klines.length).fill(null);
  const result = new Array(klines.length).fill(null);

  for (let index = 1; index < klines.length; index++) {
    if (klines[index - 1].close > 0 && klines[index].close > 0) {
      returns[index] = Math.log(
        klines[index].close / klines[index - 1].close
      );
    }
  }

  for (let index = length; index < klines.length; index++) {
    const window = returns.slice(index - length + 1, index + 1)
      .filter(Number.isFinite);
    if (window.length !== length) continue;
    const mean = window.reduce((sum, value) => sum + value, 0) /
      window.length;
    const variance = window.reduce(
      (sum, value) => sum + Math.pow(value - mean, 2),
      0
    ) / window.length;
    result[index] = Math.sqrt(variance) * 100;
  }

  return result;
}

function percentileRank(values, index, lookback) {
  if (!Number.isFinite(values[index])) return null;
  const start = Math.max(0, index - lookback + 1);
  const window = values.slice(start, index + 1)
    .filter(Number.isFinite);
  if (window.length === 0) return null;
  const atOrBelow = window.filter(
    (value) => value <= values[index]
  ).length;
  return atOrBelow / window.length * 100;
}

function calculateAdxSeries(klines, length) {
  const result = new Array(klines.length).fill(null);
  const dx = new Array(klines.length).fill(null);
  if (klines.length < length * 2) return result;

  let smoothedTr = 0;
  let smoothedPlusDm = 0;
  let smoothedMinusDm = 0;

  function directionalMovement(index) {
    const upMove = klines[index].high - klines[index - 1].high;
    const downMove = klines[index - 1].low - klines[index].low;
    return {
      plus: upMove > downMove && upMove > 0 ? upMove : 0,
      minus: downMove > upMove && downMove > 0 ? downMove : 0,
    };
  }

  function updateDx(index) {
    const plusDi = smoothedTr > 0
      ? 100 * smoothedPlusDm / smoothedTr
      : 0;
    const minusDi = smoothedTr > 0
      ? 100 * smoothedMinusDm / smoothedTr
      : 0;
    const denominator = plusDi + minusDi;
    dx[index] = denominator > 0
      ? 100 * Math.abs(plusDi - minusDi) / denominator
      : 0;
  }

  for (let index = 1; index <= length; index++) {
    const movement = directionalMovement(index);
    smoothedTr += trueRange(klines, index);
    smoothedPlusDm += movement.plus;
    smoothedMinusDm += movement.minus;
  }
  updateDx(length);

  for (let index = length + 1; index < klines.length; index++) {
    const movement = directionalMovement(index);
    smoothedTr = smoothedTr - smoothedTr / length +
      trueRange(klines, index);
    smoothedPlusDm = smoothedPlusDm - smoothedPlusDm / length +
      movement.plus;
    smoothedMinusDm = smoothedMinusDm - smoothedMinusDm / length +
      movement.minus;
    updateDx(index);
  }

  const firstAdxIndex = length * 2 - 1;
  let seed = 0;
  for (let index = length; index <= firstAdxIndex; index++) {
    seed += dx[index];
  }
  result[firstAdxIndex] = seed / length;

  for (
    let index = firstAdxIndex + 1;
    index < klines.length;
    index++
  ) {
    result[index] = (
      result[index - 1] * (length - 1) + dx[index]
    ) / length;
  }

  return result;
}

function getEmaTrend(fast, slow) {
  if (!Number.isFinite(fast) || !Number.isFinite(slow)) {
    return 'UNKNOWN';
  }
  if (fast > slow) return 'BULLISH';
  if (fast < slow) return 'BEARISH';
  return 'FLAT';
}

function buildTimeframeTimeline(klines) {
  const ema20 = calculateEmaSeries(klines, EMA_FAST_LENGTH);
  const ema50 = calculateEmaSeries(klines, EMA_SLOW_LENGTH);
  const atr = calculateWilderAtrSeries(klines, ATR_LENGTH);
  const volatility = calculateVolatilitySeries(
    klines,
    VOLATILITY_LENGTH
  );

  return {
    klines,
    ema20,
    ema50,
    trueRanges: atr.ranges,
    atr14: atr.values,
    volatility20: volatility,
  };
}

function findLatestClosedIndex(klines, sourceIndex) {
  let low = 0;
  let high = klines.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle].sourceEndIndex <= sourceIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
}

function getTimeframeState(timeline, sourceIndex, includeVolatility) {
  const index = findLatestClosedIndex(timeline.klines, sourceIndex);
  if (index < 0) {
    return {
      emaTrend: 'UNKNOWN',
      ema20: null,
      ema50: null,
      emaDistancePercent: null,
      atr14: null,
      atrPercentile: null,
      volatility20Percent: null,
      volatilityPercentile: null,
      rangeExpansion: false,
      lastClosedBarTime: null,
    };
  }

  const close = timeline.klines[index].close;
  const volatility20Percent = includeVolatility
    ? timeline.volatility20[index]
    : null;

  return {
    emaTrend: getEmaTrend(
      timeline.ema20[index],
      timeline.ema50[index]
    ),
    ema20: timeline.ema20[index],
    ema50: timeline.ema50[index],
    emaDistancePercent: Number.isFinite(timeline.ema20[index]) &&
      Number.isFinite(timeline.ema50[index]) && close !== 0
      ? (timeline.ema20[index] - timeline.ema50[index]) /
        close * 100
      : null,
    atr14: timeline.atr14[index],
    atrPercentile: percentileRank(
      timeline.atr14,
      index,
      PERCENTILE_LOOKBACK
    ),
    volatility20Percent,
    volatilityPercentile: includeVolatility
      ? percentileRank(
        timeline.volatility20,
        index,
        PERCENTILE_LOOKBACK
      )
      : null,
    rangeExpansion: Number.isFinite(timeline.atr14[index]) &&
      timeline.trueRanges[index] > timeline.atr14[index] * 1.5,
    lastClosedBarTime: timeline.klines[index].closeTime,
  };
}

function getBreakout(klines, preEntryIndex, lookback) {
  if (preEntryIndex < lookback) return 'UNKNOWN';
  let recentHigh = -Infinity;
  let recentLow = Infinity;

  for (
    let index = preEntryIndex - lookback;
    index < preEntryIndex;
    index++
  ) {
    recentHigh = Math.max(recentHigh, klines[index].high);
    recentLow = Math.min(recentLow, klines[index].low);
  }

  if (klines[preEntryIndex].close > recentHigh) return 'UP';
  if (klines[preEntryIndex].close < recentLow) return 'DOWN';
  return 'NONE';
}

function buildDailyTimeline(klines) {
  const days = HTFContextAnalyzer.aggregateClosedKlines(
    klines,
    HTFContextAnalyzer.ONE_DAY
  );
  const indexByOpenTime = new Map();
  const rangePercents = days.map((day, index) => {
    indexByOpenTime.set(day.openTime, index);
    return day.open !== 0
      ? (day.high - day.low) / day.open * 100
      : null;
  });

  return { days, indexByOpenTime, rangePercents };
}

function percentileAgainstHistory(
  values,
  endExclusive,
  currentValue,
  lookback
) {
  if (!Number.isFinite(currentValue)) return null;
  const start = Math.max(0, endExclusive - lookback);
  const window = values.slice(start, endExclusive)
    .filter(Number.isFinite);
  if (window.length === 0) return null;
  return window.filter((value) => value <= currentValue).length /
    window.length * 100;
}

function getDailyState(dailyTimeline, klines, preEntryIndex) {
  const kline = klines[preEntryIndex];
  if (!kline) {
    return {
      dayOpen: null,
      pdh: null,
      pdl: null,
      openToPdhPercent: null,
      openToPdlPercent: null,
      intradayRangePercent: null,
      intradayRangePercentile: null,
    };
  }

  const dayStart = Math.floor(
    kline.openTime / HTFContextAnalyzer.ONE_DAY
  ) * HTFContextAnalyzer.ONE_DAY;
  const dayStartIndex = Math.max(
    0,
    preEntryIndex - Math.floor(
      (kline.openTime - dayStart) /
      (5 * 60 * 1000)
    )
  );
  const dayOpen = klines[dayStartIndex].open;
  let intradayHigh = -Infinity;
  let intradayLow = Infinity;

  for (let index = dayStartIndex; index <= preEntryIndex; index++) {
    intradayHigh = Math.max(intradayHigh, klines[index].high);
    intradayLow = Math.min(intradayLow, klines[index].low);
  }

  const previousDayIndex = dailyTimeline.indexByOpenTime.get(
    dayStart - HTFContextAnalyzer.ONE_DAY
  );
  const previousDay = Number.isInteger(previousDayIndex)
    ? dailyTimeline.days[previousDayIndex]
    : null;
  const currentRangePercent = dayOpen !== 0
    ? (intradayHigh - intradayLow) / dayOpen * 100
    : null;
  const currentDayHistoryIndex = Number.isInteger(previousDayIndex)
    ? previousDayIndex + 1
    : 0;

  return {
    dayOpen,
    pdh: previousDay ? previousDay.high : null,
    pdl: previousDay ? previousDay.low : null,
    openToPdhPercent: previousDay && dayOpen !== 0
      ? (previousDay.high - dayOpen) / dayOpen * 100
      : null,
    openToPdlPercent: previousDay && dayOpen !== 0
      ? (dayOpen - previousDay.low) / dayOpen * 100
      : null,
    intradayRangePercent: currentRangePercent,
    intradayRangePercentile: percentileAgainstHistory(
      dailyTimeline.rangePercents,
      currentDayHistoryIndex,
      currentRangePercent,
      PERCENTILE_LOOKBACK
    ),
  };
}

function buildIndicatorTimelines(klines) {
  const oneHourKlines = HTFContextAnalyzer.aggregateClosedKlines(
    klines,
    HTFContextAnalyzer.ONE_HOUR
  );
  const fourHourKlines = HTFContextAnalyzer.aggregateClosedKlines(
    klines,
    HTFContextAnalyzer.FOUR_HOURS
  );
  const fiveMinuteAtr = calculateWilderAtrSeries(klines, 20);

  return {
    h4: buildTimeframeTimeline(fourHourKlines),
    h1: buildTimeframeTimeline(oneHourKlines),
    fiveMinute: {
      atr20: fiveMinuteAtr.values,
      adx14: calculateAdxSeries(klines, 14),
    },
    daily: buildDailyTimeline(klines),
  };
}

function getPreEntryState(timelines, klines, entryIndex) {
  const preEntryIndex = entryIndex - 1;
  const kline = klines[preEntryIndex];

  if (!kline) {
    throw new Error(
      `Market regime experiment has no pre-entry bar for ${entryIndex}`
    );
  }

  return {
    availableIndex: preEntryIndex,
    availableTime: kline.closeTime,
    h4: getTimeframeState(timelines.h4, preEntryIndex, false),
    h1: getTimeframeState(timelines.h1, preEntryIndex, true),
    fiveMinute: {
      atr20: timelines.fiveMinute.atr20[preEntryIndex],
      atr20Percent: kline.close !== 0 &&
        Number.isFinite(timelines.fiveMinute.atr20[preEntryIndex])
        ? timelines.fiveMinute.atr20[preEntryIndex] /
          kline.close * 100
        : null,
      breakout: getBreakout(
        klines,
        preEntryIndex,
        BREAKOUT_LOOKBACK
      ),
      adx14: timelines.fiveMinute.adx14[preEntryIndex],
    },
    daily: getDailyState(
      timelines.daily,
      klines,
      preEntryIndex
    ),
  };
}

function classifyRegime(state) {
  const expansion = Number.isFinite(state.h4.atrPercentile) &&
    state.h4.atrPercentile >= 75 &&
    (
      state.h1.rangeExpansion ||
      state.fiveMinute.breakout === 'UP' ||
      state.fiveMinute.breakout === 'DOWN'
    );
  if (expansion) return 'EXPANSION';

  const contraction = Number.isFinite(state.h4.atrPercentile) &&
    state.h4.atrPercentile <= 25 &&
    Number.isFinite(state.h1.volatilityPercentile) &&
    state.h1.volatilityPercentile <= 25 &&
    Number.isFinite(state.fiveMinute.adx14) &&
    state.fiveMinute.adx14 < 20 &&
    !state.h1.rangeExpansion &&
    state.fiveMinute.breakout === 'NONE';
  if (contraction) return 'CONTRACTION';

  const trending = state.h4.emaTrend !== 'UNKNOWN' &&
    state.h4.emaTrend !== 'FLAT' &&
    state.h4.emaTrend === state.h1.emaTrend &&
    Number.isFinite(state.h4.emaDistancePercent) &&
    Math.abs(state.h4.emaDistancePercent) >= 0.25 &&
    Number.isFinite(state.fiveMinute.adx14) &&
    state.fiveMinute.adx14 >= 25;
  if (trending) return 'TRENDING';

  return 'RANGING';
}

function summarizeRegimes(samples) {
  return Object.fromEntries(REGIMES.map((regime) => [
    regime,
    HTFFilterExperiment.summarize(
      samples.filter((sample) => sample.regime === regime)
    ),
  ]));
}

function analyzeMarketRegimes({
  setups,
  entries,
  trades,
  klines,
  years = [],
}) {
  const baseSamples = HTFFilterExperiment.buildSamples({
    setups,
    entries,
    trades,
    klines,
  });
  const timelines = buildIndicatorTimelines(klines);
  const samples = baseSamples.map((sample) => {
    const state = getPreEntryState(
      timelines,
      klines,
      sample.entryIndex
    );
    const entryKline = klines[sample.entryIndex];

    return {
      ...sample,
      year: entryKline
        ? new Date(entryKline.openTime).getUTCFullYear()
        : sample.year,
      regime: classifyRegime(state),
      preEntryState: state,
    };
  });
  const normalizedYears = years.length > 0
    ? [...years]
    : [...new Set(samples.map((sample) => sample.year))].sort();
  const yearly = Object.fromEntries(normalizedYears.map((year) => [
    String(year),
    summarizeRegimes(samples.filter(
      (sample) => sample.year === year
    )),
  ]));

  return {
    definitions: {
      EXPANSION: '4H ATR percentile >= 75 and (1H range > 1.5 ATR14 or 5m close breaks the prior 20-bar range)',
      CONTRACTION: '4H ATR percentile <= 25, 1H 20-return volatility percentile <= 25, 5m ADX14 < 20, and no local expansion/breakout',
      TRENDING: '4H and 1H EMA20/50 point the same way, absolute 4H EMA distance >= 0.25%, and 5m ADX14 >= 25',
      RANGING: 'All remaining observations',
    },
    overall: summarizeRegimes(samples),
    yearly,
    samples,
  };
}

module.exports = {
  REGIMES,
  analyzeMarketRegimes,
  buildDailyTimeline,
  buildIndicatorTimelines,
  buildTimeframeTimeline,
  calculateAdxSeries,
  calculateEmaSeries,
  calculateVolatilitySeries,
  calculateWilderAtrSeries,
  classifyRegime,
  findLatestClosedIndex,
  getDailyState,
  getPreEntryState,
  getTimeframeState,
  percentileRank,
  summarizeRegimes,
  trueRange,
};
