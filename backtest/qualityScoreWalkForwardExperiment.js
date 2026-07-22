'use strict';

const QualityScoreExperiment = require(
  './qualityScoreExperiment'
);

const FOLDS = Object.freeze([
  Object.freeze({
    trainingYears: Object.freeze([2020, 2021, 2022]),
    testYear: 2023,
  }),
  Object.freeze({
    trainingYears: Object.freeze([2020, 2021, 2022, 2023]),
    testYear: 2024,
  }),
  Object.freeze({
    trainingYears: Object.freeze([
      2020, 2021, 2022, 2023, 2024,
    ]),
    testYear: 2025,
  }),
  Object.freeze({
    trainingYears: Object.freeze([
      2020, 2021, 2022, 2023, 2024, 2025,
    ]),
    testYear: 2026,
  }),
]);

const SCORE_GROUPS = Object.freeze(['0', '1', '2', '3+']);

function scoreGroup(score) {
  if (score >= 3) return '3+';
  return String(score);
}

function samplesForYears(samples, years) {
  const allowed = new Set(years);
  return samples.filter((sample) => allowed.has(sample.year));
}

function compactSummary(samples) {
  const summary = QualityScoreExperiment.summarize(samples);
  return {
    trades: summary.trades,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    totalR: summary.totalR,
    averageR: summary.averageR,
    medianR: summary.medianR,
  };
}

function summarizeScoreGroups(samples) {
  return Object.fromEntries(SCORE_GROUPS.map((group) => [
    group,
    compactSummary(samples.filter(
      (sample) => scoreGroup(sample.qualityScore) === group
    )),
  ]));
}

function compactPositionSizing(samples) {
  const result = QualityScoreExperiment.applyPositionSizing(samples);
  return {
    originalR: result.originalTotalR,
    weightedR: result.weightedTotalR,
    rChange: result.totalRChange,
    originalMaxDrawdownR: result.originalMaxDrawdownR,
    weightedMaxDrawdownR: result.weightedMaxDrawdownR,
    maxDrawdownChangeR: result.maxDrawdownChangeR,
    maxDrawdownChangePercent: result.maxDrawdownChangePercent,
    highScoreTrades: samples.filter(
      (sample) => sample.qualityScore >= 3
    ).length,
    otherTrades: samples.filter(
      (sample) => sample.qualityScore < 3
    ).length,
  };
}

function evaluateFold(scoredSamples, fold) {
  const trainingSamples = samplesForYears(
    scoredSamples,
    fold.trainingYears
  );
  const testSamples = samplesForYears(
    scoredSamples,
    [fold.testYear]
  );

  return {
    trainingYears: [...fold.trainingYears],
    testYear: fold.testYear,
    training: {
      total: compactSummary(trainingSamples),
      scores: summarizeScoreGroups(trainingSamples),
    },
    test: {
      total: compactSummary(testSamples),
      scores: summarizeScoreGroups(testSamples),
      positionSizing: compactPositionSizing(testSamples),
    },
    trainingEntryIndexes: trainingSamples.map(
      (sample) => sample.entryIndex
    ),
    testEntryIndexes: testSamples.map(
      (sample) => sample.entryIndex
    ),
  };
}

function analyzeScoredSamples(scoredSamples) {
  const folds = FOLDS.map((fold) =>
    evaluateFold(scoredSamples, fold)
  );
  const outOfSample = samplesForYears(
    scoredSamples,
    FOLDS.map((fold) => fold.testYear)
  );

  return {
    protocol: {
      scoringImplementation:
        'qualityScoreExperiment.scoreSample',
      scoreRulesChanged: false,
      thresholdTuning: false,
      testYearsUsedForScoring: false,
      positionSizing: 'Score >= 3: 1.5x; Score < 3: 1x',
      yearAssignment: 'Entry UTC year',
    },
    scoreGroups: [...SCORE_GROUPS],
    folds,
    outOfSample: {
      years: FOLDS.map((fold) => fold.testYear),
      total: compactSummary(outOfSample),
      scores: summarizeScoreGroups(outOfSample),
      positionSizing: compactPositionSizing(outOfSample),
    },
  };
}

function analyzeWalkForward(input) {
  const quality = QualityScoreExperiment.analyzeQualityScore(input);

  return {
    ...analyzeScoredSamples(quality.samples),
    sampleCount: quality.sampleCount,
    scoreRules: quality.scoreRules,
    samples: quality.samples,
  };
}

module.exports = {
  FOLDS,
  SCORE_GROUPS,
  analyzeScoredSamples,
  analyzeWalkForward,
  compactPositionSizing,
  compactSummary,
  evaluateFold,
  samplesForYears,
  scoreGroup,
  summarizeScoreGroups,
};
