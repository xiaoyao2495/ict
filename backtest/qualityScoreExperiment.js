'use strict';

const SetupFeatureExperiment = require(
  './setupFeatureExperiment'
);

const SCORE_VALUES = Object.freeze([0, 1, 2, 3, 4, 5]);
const HIGH_QUALITY_THRESHOLD = 3;
const BASE_POSITION_MULTIPLIER = 1;
const HIGH_QUALITY_POSITION_MULTIPLIER = 1.5;

function scoreComponents(sample) {
  const features = sample.features || {};

  return {
    bodyRatio: Number.isFinite(features.bodyRatio) &&
      features.bodyRatio >= 0.60 &&
      features.bodyRatio < 0.70,
    bearishBos1h: sample.h1Structure === 'BEARISH_BOS',
    smallFvg: Number.isFinite(features.fvgSizePercent) &&
      features.fvgSizePercent < 0.025,
    youngSetup: Number.isFinite(features.setupAgeBars) &&
      features.setupAgeBars <= 3,
    expansionRegime:
      features.volatilityState === 'EXPANSION',
  };
}

function scoreSample(sample) {
  const components = scoreComponents(sample);
  const qualityScore = Object.values(components).filter(Boolean).length;

  return {
    ...sample,
    qualityScore,
    qualityScoreComponents: components,
  };
}

function summarize(samples) {
  const summary = SetupFeatureExperiment.summarizeSamples(samples);

  return {
    trades: summary.trades,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    totalR: summary.totalR,
    averageR: summary.averageR,
    medianR: summary.medianR,
    maxDrawdownR: summary.maxDrawdownR,
    maxLosingStreak: summary.maxConsecutiveLosses,
  };
}

function buildScoreDistribution(scoredSamples) {
  return Object.fromEntries(SCORE_VALUES.map((score) => [
    String(score),
    summarize(scoredSamples.filter(
      (sample) => sample.qualityScore === score
    )),
  ]));
}

function calculateDrawdown(samples, rSelector) {
  const chronological = [...samples].sort((left, right) =>
    left.entryIndex - right.entryIndex
  );
  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  for (const sample of chronological) {
    const r = rSelector(sample);
    if (!Number.isFinite(r)) continue;
    cumulativeR += r;
    peakR = Math.max(peakR, cumulativeR);
    maxDrawdownR = Math.max(
      maxDrawdownR,
      peakR - cumulativeR
    );
  }

  return maxDrawdownR;
}

function applyPositionSizing(scoredSamples) {
  const weightedSamples = scoredSamples.map((sample) => {
    const positionMultiplier = sample.qualityScore >=
      HIGH_QUALITY_THRESHOLD
      ? HIGH_QUALITY_POSITION_MULTIPLIER
      : BASE_POSITION_MULTIPLIER;

    return {
      ...sample,
      positionMultiplier,
      weightedR: Number.isFinite(sample.r)
        ? sample.r * positionMultiplier
        : null,
    };
  });
  const originalTotalR = scoredSamples.reduce(
    (sum, sample) => sum +
      (Number.isFinite(sample.r) ? sample.r : 0),
    0
  );
  const weightedTotalR = weightedSamples.reduce(
    (sum, sample) => sum +
      (Number.isFinite(sample.weightedR)
        ? sample.weightedR
        : 0),
    0
  );
  const originalMaxDrawdownR = calculateDrawdown(
    scoredSamples,
    (sample) => sample.r
  );
  const weightedMaxDrawdownR = calculateDrawdown(
    weightedSamples,
    (sample) => sample.weightedR
  );

  return {
    rule: {
      scoreAtLeast: HIGH_QUALITY_THRESHOLD,
      highQualityMultiplier: HIGH_QUALITY_POSITION_MULTIPLIER,
      otherMultiplier: BASE_POSITION_MULTIPLIER,
    },
    originalTotalR,
    weightedTotalR,
    totalRChange: weightedTotalR - originalTotalR,
    originalMaxDrawdownR,
    weightedMaxDrawdownR,
    maxDrawdownChangeR:
      weightedMaxDrawdownR - originalMaxDrawdownR,
    maxDrawdownChangePercent: originalMaxDrawdownR > 0
      ? (weightedMaxDrawdownR / originalMaxDrawdownR - 1) * 100
      : null,
    weightedSamples,
  };
}

function analyzeFeatureSamples(samples) {
  const scoredSamples = samples.map(scoreSample);

  return {
    scoreRules: Object.freeze({
      bodyRatio: '+1 for 0.60 <= bodyRatio < 0.70',
      bearishBos1h: '+1 for 1H BEARISH_BOS',
      smallFvg: '+1 for FVG size < 0.025% of Entry',
      youngSetup: '+1 for setupAgeBars <= 3',
      expansionRegime: '+1 for pre-entry Market Regime EXPANSION',
    }),
    sampleCount: scoredSamples.length,
    baseline: summarize(scoredSamples),
    scores: buildScoreDistribution(scoredSamples),
    positionSizing: applyPositionSizing(scoredSamples),
    samples: scoredSamples,
  };
}

function analyzeQualityScore({
  setups,
  entries,
  trades,
  klines,
}) {
  const features = SetupFeatureExperiment.analyzeSetupFeatures({
    setups,
    entries,
    trades,
    klines,
    years: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
  });

  return {
    protocol: {
      scoreRulesFrozen: true,
      entryExitChanged: false,
      baselineChanged: false,
      marketRegimeTiming: 'Pre-entry bar only',
    },
    ...analyzeFeatureSamples(features.samples),
  };
}

module.exports = {
  BASE_POSITION_MULTIPLIER,
  HIGH_QUALITY_POSITION_MULTIPLIER,
  HIGH_QUALITY_THRESHOLD,
  SCORE_VALUES,
  analyzeFeatureSamples,
  analyzeQualityScore,
  applyPositionSizing,
  buildScoreDistribution,
  calculateDrawdown,
  scoreComponents,
  scoreSample,
  summarize,
};
