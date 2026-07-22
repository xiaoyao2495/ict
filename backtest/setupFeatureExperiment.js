'use strict';

const HTFFilterExperiment = require(
  './htfFilterExperiment'
);
const MarketRegimeExperiment = require(
  './marketRegimeExperiment'
);

const FEATURE_ORDER = Object.freeze([
  'displacementScore',
  'bodyRatio',
  'fvgSizePercent',
  'fvgSizeAtr',
  'sweepSizePercent',
  'mssDistanceBars',
  'setupAgeBars',
  'h4Trend',
  'h1Structure',
  'pdLocation',
  'atrPercentile',
  'volatilityState',
  'dailyRangePercentile',
]);

function normalizeDirection(value) {
  const normalized = String(value || '').toUpperCase();
  if (
    normalized === 'LONG' ||
    normalized === 'BULLISH' ||
    normalized === 'LONG_SETUP' ||
    normalized === 'LONG_ENTRY'
  ) return 'LONG';
  if (
    normalized === 'SHORT' ||
    normalized === 'BEARISH' ||
    normalized === 'SHORT_SETUP' ||
    normalized === 'SHORT_ENTRY'
  ) return 'SHORT';
  return normalized;
}

function tradeKey(direction, setupIndex) {
  return `${normalizeDirection(direction)}:${setupIndex}`;
}

function eventAvailableIndex(event) {
  if (!event) return null;
  if (Number.isInteger(event.availableIndex)) {
    return event.availableIndex;
  }
  if (Number.isInteger(event.breakIndex)) return event.breakIndex;
  return Number.isInteger(event.index) ? event.index : null;
}

function numericBucket(value, boundaries, labels) {
  if (!Number.isFinite(value)) return 'UNKNOWN';
  for (let index = 0; index < boundaries.length; index++) {
    if (value < boundaries[index]) return labels[index];
  }
  return labels[labels.length - 1];
}

function bucketFeature(name, value) {
  if (name === 'displacementScore') {
    if (!Number.isFinite(value)) return 'UNKNOWN';
    return value >= 4 ? '4+' : String(value);
  }
  if (name === 'bodyRatio') {
    return numericBucket(
      value,
      [0.7, 0.8, 0.9],
      ['0.60-0.70', '0.70-0.80', '0.80-0.90', '0.90+']
    );
  }
  if (name === 'fvgSizePercent') {
    return numericBucket(
      value,
      [0.025, 0.05, 0.1],
      ['<0.025%', '0.025-0.05%', '0.05-0.10%', '0.10%+']
    );
  }
  if (name === 'fvgSizeAtr') {
    return numericBucket(
      value,
      [0.25, 0.5, 1],
      ['<0.25', '0.25-0.50', '0.50-1.00', '1.00+']
    );
  }
  if (name === 'sweepSizePercent') {
    return numericBucket(
      value,
      [0.05, 0.1, 0.25],
      ['<0.05%', '0.05-0.10%', '0.10-0.25%', '0.25%+']
    );
  }
  if (name === 'mssDistanceBars') {
    return numericBucket(
      value,
      [3, 6, 11],
      ['0-2', '3-5', '6-10', '11+']
    );
  }
  if (name === 'setupAgeBars') {
    return numericBucket(
      value,
      [4, 8, 13],
      ['0-3', '4-7', '8-12', '13-16']
    );
  }
  if (
    name === 'atrPercentile' ||
    name === 'dailyRangePercentile'
  ) {
    return numericBucket(
      value,
      [25, 50, 75],
      ['0-25', '25-50', '50-75', '75-100']
    );
  }
  return value || 'UNKNOWN';
}

function calculateMaxDrawdown(samples) {
  const chronological = [...samples].sort((left, right) =>
    left.entryIndex - right.entryIndex
  );
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const sample of chronological) {
    if (!Number.isFinite(sample.r)) continue;
    cumulative += sample.r;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  return maxDrawdown;
}

function summarizeSamples(samples) {
  const summary = HTFFilterExperiment.summarize(samples);
  const finiteR = samples.filter((sample) =>
    Number.isFinite(sample.r)
  ).map((sample) => sample.r);
  const maxWinnerR = finiteR.length > 0
    ? Math.max(...finiteR)
    : null;
  const totalRWithoutMaxWinner = finiteR.length > 1
    ? summary.totalR - maxWinnerR
    : 0;
  const bigWinners = samples.filter(
    (sample) => Number.isFinite(sample.r) && sample.r >= 3
  );
  const minusOne = samples.filter(
    (sample) => sample.r === -1
  );
  const yearly = new Map();

  for (const sample of samples) {
    if (!Number.isInteger(sample.year)) continue;
    if (!yearly.has(sample.year)) yearly.set(sample.year, []);
    yearly.get(sample.year).push(sample);
  }
  const yearlyStats = [...yearly.entries()].map(([year, rows]) => ({
    year,
    ...HTFFilterExperiment.summarize(rows),
  })).sort((left, right) => left.year - right.year);

  return {
    ...summary,
    maxDrawdownR: calculateMaxDrawdown(samples),
    maxWinnerR,
    totalRWithoutMaxWinner,
    averageRWithoutMaxWinner: finiteR.length > 1
      ? totalRWithoutMaxWinner / (finiteR.length - 1)
      : null,
    bigWinnerCount: bigWinners.length,
    bigWinnerRate: samples.length > 0
      ? bigWinners.length / samples.length
      : 0,
    bigWinnerTotalR: bigWinners.reduce(
      (sum, sample) => sum + sample.r,
      0
    ),
    minusOneCount: minusOne.length,
    minusOneRate: samples.length > 0
      ? minusOne.length / samples.length
      : 0,
    activeYears: yearlyStats.length,
    profitableYears: yearlyStats.filter(
      (row) => row.totalR > 0
    ).length,
    yearly: yearlyStats,
  };
}

function getVolatilityState(regime) {
  if (regime === 'EXPANSION') return 'EXPANSION';
  if (regime === 'CONTRACTION') return 'CONTRACTION';
  return 'NEUTRAL';
}

function createFeatureSample(
  base,
  setup,
  entry,
  marketSample,
  atr14,
  klines
) {
  const fvg = setup.fvg || {};
  const sweep = setup.sweep || {};
  const fvgSize = Number.isFinite(fvg.size)
    ? Math.abs(fvg.size)
    : Number.isFinite(fvg.top) && Number.isFinite(fvg.bottom)
      ? Math.abs(fvg.top - fvg.bottom)
      : null;
  const fvgIndex = eventAvailableIndex(fvg);
  const fvgAtr = Number.isInteger(fvgIndex)
    ? atr14[fvgIndex]
    : null;
  const sweepSize = Number.isFinite(sweep.extreme) &&
    Number.isFinite(sweep.price)
    ? Math.abs(sweep.extreme - sweep.price)
    : null;
  const sweepIndex = eventAvailableIndex(sweep);
  const mssIndex = eventAvailableIndex(setup.mss);
  const entryKline = klines[base.entryIndex];
  const marketState = marketSample
    ? marketSample.preEntryState
    : null;
  const features = {
    displacementScore: setup.displacement
      ? setup.displacement.score
      : null,
    bodyRatio: setup.displacement
      ? setup.displacement.bodyRatio
      : null,
    fvgSize,
    fvgSizePercent: Number.isFinite(fvgSize) && entry.entry !== 0
      ? fvgSize / entry.entry * 100
      : null,
    fvgSizeAtr: Number.isFinite(fvgSize) &&
      Number.isFinite(fvgAtr) && fvgAtr > 0
      ? fvgSize / fvgAtr
      : null,
    sweepSize,
    sweepSizePercent: Number.isFinite(sweepSize) &&
      Number.isFinite(sweep.price) && sweep.price !== 0
      ? sweepSize / sweep.price * 100
      : null,
    mssDistanceBars: Number.isInteger(sweepIndex) &&
      Number.isInteger(mssIndex)
      ? mssIndex - sweepIndex
      : null,
    setupAgeBars: entry.setupAgeBars,
    h4Trend: base.h4Trend || 'UNKNOWN',
    h1Structure: base.h1Structure || 'UNKNOWN',
    pdLocation: base.pdLocation || 'UNKNOWN',
    atrPercentile: marketState
      ? marketState.h4.atrPercentile
      : null,
    volatilityState: getVolatilityState(
      marketSample ? marketSample.regime : 'UNKNOWN'
    ),
    dailyRangePercentile: marketState
      ? marketState.daily.intradayRangePercentile
      : null,
  };
  const featureBuckets = Object.fromEntries(FEATURE_ORDER.map(
    (name) => [name, bucketFeature(name, features[name])]
  ));

  return {
    ...base,
    year: entryKline
      ? new Date(entryKline.openTime).getUTCFullYear()
      : base.year,
    features,
    featureBuckets,
  };
}

function buildFeatureDistributions(samples) {
  return Object.fromEntries(FEATURE_ORDER.map((feature) => {
    const groups = new Map();
    for (const sample of samples) {
      const bucket = sample.featureBuckets[feature];
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push(sample);
    }
    return [
      feature,
      [...groups.entries()].map(([bucket, rows]) => ({
        bucket,
        ...summarizeSamples(rows),
      })),
    ];
  }));
}

function enumeratePairCombinations(samples) {
  const combinations = [];

  for (let left = 0; left < FEATURE_ORDER.length; left++) {
    for (let right = left + 1; right < FEATURE_ORDER.length; right++) {
      const leftFeature = FEATURE_ORDER[left];
      const rightFeature = FEATURE_ORDER[right];
      const groups = new Map();

      for (const sample of samples) {
        const leftBucket = sample.featureBuckets[leftFeature];
        const rightBucket = sample.featureBuckets[rightFeature];
        const key = `${leftBucket}\u0000${rightBucket}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(sample);
      }

      for (const [key, rows] of groups.entries()) {
        const buckets = key.split('\u0000');
        combinations.push({
          features: [leftFeature, rightFeature],
          buckets,
          ...summarizeSamples(rows),
        });
      }
    }
  }

  return combinations;
}

function findCombinationSignals(samples) {
  const baseline = summarizeSamples(samples);
  const combinations = enumeratePairCombinations(samples);
  const stableHighQuality = combinations.filter((row) =>
    row.trades >= 8 &&
    row.activeYears >= 4 &&
    row.profitableYears / row.activeYears >= 0.6 &&
    row.averageR > baseline.averageR &&
    row.medianR > baseline.medianR
  ).sort((left, right) =>
    right.averageR - left.averageR ||
    right.trades - left.trades
  );
  const bigWinnerCombinations = combinations.filter((row) =>
    row.trades >= 4 && row.bigWinnerCount >= 2
  ).sort((left, right) =>
    right.bigWinnerRate - left.bigWinnerRate ||
    right.bigWinnerCount - left.bigWinnerCount ||
    right.averageR - left.averageR
  );
  const minusOneCombinations = combinations.filter((row) =>
    row.trades >= 5 && row.minusOneCount >= 3
  ).sort((left, right) =>
    right.minusOneRate - left.minusOneRate ||
    right.minusOneCount - left.minusOneCount ||
    left.averageR - right.averageR
  );

  return {
    criteria: {
      stableHighQuality: 'Pair only; trades >= 8; active years >= 4; profitable years >= 60%; average R above baseline; median R above baseline',
      bigWinner: 'R >= 3; pair trades >= 4 and big-winner count >= 2',
      minusOne: 'R = -1; pair trades >= 5 and minus-one count >= 3',
    },
    stableHighQuality,
    bigWinnerCombinations,
    minusOneCombinations,
  };
}

function analyzeSetupFeatures({
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
  const market = MarketRegimeExperiment.analyzeMarketRegimes({
    setups,
    entries,
    trades,
    klines,
    years,
  });
  const setupByKey = new Map(setups.map((setup) => [
    tradeKey(setup.direction || setup.type, setup.triggerIndex),
    setup,
  ]));
  const entryByKey = new Map(entries.filter((entry) =>
    entry.status === 'ENTRY_TRIGGERED'
  ).map((entry) => [
    tradeKey(entry.type, entry.setupIndex),
    entry,
  ]));
  const marketByKey = new Map(market.samples.map((sample) => [
    tradeKey(sample.direction, sample.setupIndex),
    sample,
  ]));
  const atr14 = MarketRegimeExperiment.calculateWilderAtrSeries(
    klines,
    14
  ).values;
  const samples = baseSamples.map((base) => {
    const key = tradeKey(base.direction, base.setupIndex);
    return createFeatureSample(
      base,
      setupByKey.get(key),
      entryByKey.get(key),
      marketByKey.get(key),
      atr14,
      klines
    );
  });

  return {
    definitions: {
      fvgSizePercent: 'Absolute FVG size divided by Entry price',
      fvgSizeAtr: 'Absolute FVG size divided by causal 5m Wilder ATR14 at FVG availability',
      sweepSizePercent: 'Absolute sweep extreme beyond swept price, divided by swept price',
      mssDistanceBars: 'MSS availableIndex minus Sweep availableIndex',
      setupAgeBars: 'Entry index minus Setup availableIndex',
      atrPercentile: 'Pre-entry 4H ATR14 percentile over the latest 100 closed 4H bars',
      volatilityState: 'EXPANSION, CONTRACTION, or NEUTRAL from the fixed Market Regime classifier',
      dailyRangePercentile: 'Pre-entry intraday range percentile versus up to 100 prior complete UTC days',
    },
    baseline: summarizeSamples(samples),
    distributions: buildFeatureDistributions(samples),
    combinations: findCombinationSignals(samples),
    samples,
  };
}

module.exports = {
  FEATURE_ORDER,
  analyzeSetupFeatures,
  bucketFeature,
  buildFeatureDistributions,
  calculateMaxDrawdown,
  createFeatureSample,
  enumeratePairCombinations,
  eventAvailableIndex,
  findCombinationSignals,
  numericBucket,
  summarizeSamples,
};
