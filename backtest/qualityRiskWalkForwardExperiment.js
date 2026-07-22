'use strict';

const PortfolioRiskExperiment = require(
  './portfolioRiskExperiment'
);
const QualityDrawdownExperiment = require(
  './qualityDrawdownExperiment'
);
const QualityScoreExperiment = require(
  './qualityScoreExperiment'
);

const INITIAL_CAPITAL = 10000;
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

function samplesForYears(samples, years) {
  const allowed = new Set(years);
  return samples.filter((sample) => allowed.has(sample.year));
}

function recoveryFactor(overall) {
  const netProfit = overall.endingBalance - overall.startingBalance;
  return overall.maxDrawdown > 0
    ? netProfit / overall.maxDrawdown
    : null;
}

function compactPortfolio(overall, weightedR, protectionTriggers) {
  return {
    weightedR,
    endingBalance: overall.endingBalance,
    returnPercent: overall.returnPercent,
    maxDrawdown: overall.maxDrawdown,
    maxDrawdownPercent: overall.maxDrawdownPercent,
    sharpe: overall.sharpe,
    profitFactor: overall.profitFactor,
    recoveryFactor: Number.isFinite(overall.recoveryFactor)
      ? overall.recoveryFactor
      : recoveryFactor(overall),
    protectionTriggers,
  };
}

function sumOriginalR(samples) {
  return samples.reduce(
    (sum, sample) => sum +
      (Number.isFinite(sample.r) ? sample.r : 0),
    0
  );
}

function sumAppliedR(trades) {
  return trades.reduce(
    (sum, trade) => sum +
      (Number.isFinite(trade.r)
        ? trade.r * trade.appliedRiskR
        : 0),
    0
  );
}

function evaluateTestYear(
  testSamples,
  testYear,
  initialCapital = INITIAL_CAPITAL
) {
  const original = PortfolioRiskExperiment.simulateModel(
    testSamples,
    'A',
    initialCapital,
    [testYear]
  );
  const modelA = QualityDrawdownExperiment.simulateModel(
    testSamples,
    'A',
    initialCapital,
    [testYear]
  );
  const modelC = QualityDrawdownExperiment.simulateModel(
    testSamples,
    'C',
    initialCapital,
    [testYear]
  );
  const originalR = sumOriginalR(testSamples);
  const modelAR = sumAppliedR(modelA.trades);
  const modelCR = sumAppliedR(modelC.trades);
  const protectionTriggers = modelC.trades.filter(
    (trade) => trade.protectionMultiplier < 1
  ).length;

  return {
    testYear,
    trades: testSamples.length,
    originalR,
    modelAR,
    modelCR,
    portfolios: {
      ORIGINAL: compactPortfolio(
        original.overall,
        originalR,
        0
      ),
      A: compactPortfolio(modelA.overall, modelAR, 0),
      C: compactPortfolio(
        modelC.overall,
        modelCR,
        protectionTriggers
      ),
    },
    modelCTradeAudit: modelC.trades.map((trade) => ({
      entryIndex: trade.entryIndex,
      qualityScore: trade.qualityScore,
      status: trade.status,
      preTradeConsecutiveLosses:
        trade.preTradeConsecutiveLosses,
      baseRiskR: trade.baseRiskR,
      protectionMultiplier: trade.protectionMultiplier,
      appliedRiskR: trade.appliedRiskR,
    })),
  };
}

function evaluateFold(
  scoredSamples,
  fold,
  initialCapital = INITIAL_CAPITAL
) {
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
    trainingTrades: trainingSamples.length,
    trainingEntryIndexes: trainingSamples.map(
      (sample) => sample.entryIndex
    ),
    testEntryIndexes: testSamples.map(
      (sample) => sample.entryIndex
    ),
    result: evaluateTestYear(
      testSamples,
      fold.testYear,
      initialCapital
    ),
  };
}

function analyzeScoredSamples(
  scoredSamples,
  initialCapital = INITIAL_CAPITAL
) {
  return {
    protocol: {
      strictWalkForward: true,
      trainingYearsUsedOnlyForSplitting: true,
      parameterTuning: false,
      thresholdChanges: false,
      baselineChanged: false,
      qualityScoreChanged: false,
      productionEntryChanged: false,
      testAccountReset:
        'Each test year independently starts at 10,000 USDT with zero consecutive losses',
      originalR:
        'Sum of unweighted Baseline trade R in the test year',
      modelR:
        'Sum of trade R multiplied by the fixed model risk in the test year; no compounding',
    },
    initialCapital,
    folds: FOLDS.map((fold) =>
      evaluateFold(scoredSamples, fold, initialCapital)
    ),
  };
}

function analyzeQualityRiskWalkForward(input) {
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
  INITIAL_CAPITAL,
  analyzeQualityRiskWalkForward,
  analyzeScoredSamples,
  compactPortfolio,
  evaluateFold,
  evaluateTestYear,
  recoveryFactor,
  samplesForYears,
  sumAppliedR,
  sumOriginalR,
};
