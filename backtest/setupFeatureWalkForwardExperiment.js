'use strict';

const SetupFeatureExperiment = require(
  './setupFeatureExperiment'
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

const RULES = Object.freeze({
  A: Object.freeze({
    name: 'bodyRatio 0.60-0.70',
    matches: (sample) =>
      sample.featureBuckets.bodyRatio === '0.60-0.70',
  }),
  B: Object.freeze({
    name: '1H BEARISH_BOS',
    matches: (sample) =>
      sample.featureBuckets.h1Structure === 'BEARISH_BOS',
  }),
  C: Object.freeze({
    name: 'FVG size <0.025%',
    matches: (sample) =>
      sample.featureBuckets.fvgSizePercent === '<0.025%',
  }),
  D: Object.freeze({
    name: 'bodyRatio 0.60-0.70 + 1H BEARISH_BOS',
    matches: (sample) =>
      sample.featureBuckets.bodyRatio === '0.60-0.70' &&
      sample.featureBuckets.h1Structure === 'BEARISH_BOS',
  }),
});

function compactSummary(samples) {
  const summary = SetupFeatureExperiment.summarizeSamples(samples);
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

function samplesForYears(samples, years) {
  const allowed = new Set(years);
  return samples.filter((sample) => allowed.has(sample.year));
}

function evaluateRule(rule, samples) {
  return samples.filter(rule.matches);
}

function evaluateFold(samples, fold) {
  const trainingUniverse = samplesForYears(
    samples,
    fold.trainingYears
  );
  const testUniverse = samplesForYears(
    samples,
    [fold.testYear]
  );
  const rules = {};

  for (const [key, rule] of Object.entries(RULES)) {
    const trainingSamples = evaluateRule(rule, trainingUniverse);
    const testSamples = evaluateRule(rule, testUniverse);
    rules[key] = {
      name: rule.name,
      training: compactSummary(trainingSamples),
      test: compactSummary(testSamples),
      trainingSampleIndexes: trainingSamples.map(
        (sample) => sample.entryIndex
      ),
      testSampleIndexes: testSamples.map(
        (sample) => sample.entryIndex
      ),
    };
  }

  return {
    trainingYears: [...fold.trainingYears],
    testYear: fold.testYear,
    trainingUniverse: compactSummary(trainingUniverse),
    testUniverse: compactSummary(testUniverse),
    rules,
  };
}

function summarizeOutOfSample(samples, folds) {
  const result = {};

  for (const [key, rule] of Object.entries(RULES)) {
    const testSamples = [];
    const yearly = [];

    for (const fold of folds) {
      const rows = evaluateRule(
        rule,
        samplesForYears(samples, [fold.testYear])
      );
      testSamples.push(...rows);
      yearly.push({
        year: fold.testYear,
        ...compactSummary(rows),
      });
    }

    const activeYears = yearly.filter((row) => row.trades > 0);
    result[key] = {
      name: rule.name,
      combined: compactSummary(testSamples),
      yearly,
      activeTestYears: activeYears.length,
      profitableTestYears: activeYears.filter(
        (row) => row.totalR > 0
      ).length,
      losingTestYears: activeYears.filter(
        (row) => row.totalR < 0
      ).length,
    };
  }

  return result;
}

function analyzeWalkForward({
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
  const folds = FOLDS.map((fold) =>
    evaluateFold(features.samples, fold)
  );

  return {
    protocol: {
      candidateRulesFrozenBeforeTesting: true,
      testYearsUsedForRuleDefinition: false,
      selectionOrThresholdTuning: false,
      yearAssignment: 'Entry UTC year',
    },
    rules: Object.fromEntries(Object.entries(RULES).map(
      ([key, rule]) => [key, rule.name]
    )),
    baseline: compactSummary(features.samples),
    folds,
    outOfSample: summarizeOutOfSample(
      features.samples,
      FOLDS
    ),
    samples: features.samples,
  };
}

module.exports = {
  FOLDS,
  RULES,
  analyzeWalkForward,
  compactSummary,
  evaluateFold,
  evaluateRule,
  samplesForYears,
  summarizeOutOfSample,
};
