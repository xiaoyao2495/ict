'use strict';

const Pivot = require('../indicators/pivot');
const Swing = require('../indicators/swing');
const HTFContextAnalyzer = require(
  '../indicators/htfContextAnalyzer'
);
const HTFFilterExperiment = require(
  './htfFilterExperiment'
);

const SCORE_BUCKETS = Object.freeze([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5+',
]);

function normalizeDirection(value) {
  const normalized = String(value || '').toUpperCase();

  if (
    normalized === 'LONG' ||
    normalized === 'BULLISH' ||
    normalized === 'LONG_SETUP' ||
    normalized === 'LONG_ENTRY'
  ) {
    return 'LONG';
  }

  if (
    normalized === 'SHORT' ||
    normalized === 'BEARISH' ||
    normalized === 'SHORT_SETUP' ||
    normalized === 'SHORT_ENTRY'
  ) {
    return 'SHORT';
  }

  return normalized;
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

function buildFourHourDealingRangeTimeline(klines) {
  const aggregatedKlines =
    HTFContextAnalyzer.aggregateClosedKlines(
      klines,
      HTFContextAnalyzer.FOUR_HOURS
    );
  const swings = Swing.filterSwings(
    Pivot.findPivots(aggregatedKlines, 2, 2)
  ).map((swing, order) => ({ swing, order }))
    .sort((left, right) => {
      const availableDifference =
        getSwingAvailableIndex(left.swing) -
        getSwingAvailableIndex(right.swing);
      if (availableDifference !== 0) {
        return availableDifference;
      }
      return left.order - right.order;
    })
    .map((item) => item.swing);
  const snapshots = [];
  let latestHigh = null;
  let latestLow = null;
  let cursor = 0;

  for (let index = 0; index < aggregatedKlines.length; index++) {
    while (
      cursor < swings.length &&
      getSwingAvailableIndex(swings[cursor]) <= index
    ) {
      if (swings[cursor].type === 'HIGH') {
        latestHigh = swings[cursor];
      } else if (swings[cursor].type === 'LOW') {
        latestLow = swings[cursor];
      }
      cursor += 1;
    }

    snapshots.push({
      high: latestHigh,
      low: latestLow,
    });
  }

  return {
    klines: aggregatedKlines,
    swings,
    snapshots,
  };
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

function getFourHourLocation(
  timeline,
  sourceIndex,
  direction,
  referencePrice
) {
  const index = findLatestClosedIndex(
    timeline.klines,
    sourceIndex
  );
  const normalizedDirection = normalizeDirection(direction);

  if (
    index < 0 ||
    !timeline.snapshots[index] ||
    !timeline.snapshots[index].high ||
    !timeline.snapshots[index].low ||
    !Number.isFinite(referencePrice)
  ) {
    return {
      high: null,
      low: null,
      equilibrium: null,
      position: 'UNKNOWN',
      aligned: false,
      lastClosedBarTime: index >= 0
        ? timeline.klines[index].closeTime
        : null,
    };
  }

  const high = timeline.snapshots[index].high.price;
  const low = timeline.snapshots[index].low.price;
  const equilibrium = (high + low) / 2;
  const position = referencePrice < equilibrium
    ? 'DISCOUNT'
    : referencePrice > equilibrium
      ? 'PREMIUM'
      : 'EQUILIBRIUM';

  return {
    high,
    low,
    equilibrium,
    position,
    aligned: normalizedDirection === 'LONG'
      ? referencePrice <= equilibrium
      : normalizedDirection === 'SHORT' &&
        referencePrice >= equilibrium,
    lastClosedBarTime: timeline.klines[index].closeTime,
  };
}

function getOneHourPoints(sample) {
  if (
    (sample.direction === 'LONG' &&
      sample.h1Structure === 'BULLISH_BOS') ||
    (sample.direction === 'SHORT' &&
      sample.h1Structure === 'BEARISH_BOS')
  ) {
    return 2;
  }

  if (
    (sample.direction === 'LONG' &&
      sample.h1Structure === 'BULLISH_MSS') ||
    (sample.direction === 'SHORT' &&
      sample.h1Structure === 'BEARISH_MSS')
  ) {
    return 1;
  }

  return 0;
}

function scoreSample(sample, fourHourLocation) {
  const components = {
    fourHourDirection:
      HTFFilterExperiment.matchesFourHourTrend(sample)
        ? 1
        : 0,
    fourHourLocation: fourHourLocation.aligned ? 1 : 0,
    oneHourStructure: getOneHourPoints(sample),
    directionalLiquidity:
      HTFFilterExperiment.matchesPreviousDayLocation(sample)
        ? 1
        : 0,
  };
  const score = Object.values(components)
    .reduce((sum, value) => sum + value, 0);

  return {
    ...sample,
    score,
    scoreBucket: score >= 5 ? '5+' : String(score),
    scoreComponents: components,
    fourHourLocation,
  };
}

function summarizeBuckets(scoredSamples) {
  return Object.fromEntries(SCORE_BUCKETS.map((bucket) => [
    bucket,
    HTFFilterExperiment.summarize(
      scoredSamples.filter(
        (sample) => sample.scoreBucket === bucket
      )
    ),
  ]));
}

function buildStability(yearly) {
  const result = {};

  for (const bucket of SCORE_BUCKETS) {
    const active = Object.values(yearly)
      .map((groups) => groups[bucket])
      .filter((summary) => summary.trades > 0);

    result[bucket] = {
      activeYears: active.length,
      profitableYears: active.filter(
        (summary) => summary.totalR > 0
      ).length,
      losingYears: active.filter(
        (summary) => summary.totalR < 0
      ).length,
      worstYearAverageR: active.length > 0
        ? Math.min(...active.map(
          (summary) => summary.averageR
        ))
        : null,
      bestYearAverageR: active.length > 0
        ? Math.max(...active.map(
          (summary) => summary.averageR
        ))
        : null,
    };
  }

  return result;
}

function analyzeHtfScores({
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
  const timeline = buildFourHourDealingRangeTimeline(klines);
  const scoredSamples = baseSamples.map((sample) => {
    const kline = klines[sample.availableIndex];
    const referencePrice = kline
      ? Number(kline.close)
      : NaN;
    const location = getFourHourLocation(
      timeline,
      sample.availableIndex,
      sample.direction,
      referencePrice
    );

    return scoreSample(sample, location);
  });
  const normalizedYears = years.length > 0
    ? [...years]
    : [...new Set(scoredSamples
      .map((sample) => sample.year)
      .filter(Number.isInteger))].sort();
  const yearly = Object.fromEntries(normalizedYears.map(
    (year) => [
      String(year),
      summarizeBuckets(scoredSamples.filter(
        (sample) => sample.year === year
      )),
    ]
  ));

  return {
    definitions: {
      fourHourDirection: 'Same-direction 4H trend: +1',
      fourHourLocation: 'LONG at/below the latest confirmed 4H swing-range equilibrium, or SHORT at/above it: +1',
      oneHourBos: 'Same-direction 1H BOS: +2',
      oneHourMss: 'Same-direction 1H MSS: +1',
      directionalLiquidity: 'LONG below PDL, or SHORT above PDH: +1',
    },
    overall: summarizeBuckets(scoredSamples),
    yearly,
    stability: buildStability(yearly),
    samples: scoredSamples,
  };
}

module.exports = {
  SCORE_BUCKETS,
  analyzeHtfScores,
  buildFourHourDealingRangeTimeline,
  buildStability,
  findLatestClosedIndex,
  getFourHourLocation,
  getOneHourPoints,
  scoreSample,
  summarizeBuckets,
};
