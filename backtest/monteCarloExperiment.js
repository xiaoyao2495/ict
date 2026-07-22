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
const TradingCostExperiment = require(
  './tradingCostExperiment'
);

const INITIAL_CAPITAL = 10000;
const ONE_R_RISK_RATE = 0.01;
const SIMULATIONS = 10000;
const RANDOM_SEED = 20260722;
const COST_SCHEME = 'B';
const SLIPPAGE_RATE = 0.0001;

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffledIndexes(length, random) {
  const indexes = Array.from({ length }, (unused, index) => index);
  for (let index = length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    const value = indexes[index];
    indexes[index] = indexes[target];
    indexes[target] = value;
  }
  return indexes;
}

function percentile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  if (probability <= 0) return sortedValues[0];
  if (probability >= 1) return sortedValues[sortedValues.length - 1];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) +
    sortedValues[upper] * weight;
}

function summarizeDistribution(values) {
  const finite = values.filter(Number.isFinite).sort(
    (left, right) => left - right
  );
  const mean = finite.length > 0
    ? finite.reduce((sum, value) => sum + value, 0) /
      finite.length
    : null;

  return {
    count: finite.length,
    mean,
    min: percentile(finite, 0),
    p05: percentile(finite, 0.05),
    p25: percentile(finite, 0.25),
    median: percentile(finite, 0.5),
    p75: percentile(finite, 0.75),
    p95: percentile(finite, 0.95),
    p99: percentile(finite, 0.99),
    max: percentile(finite, 1),
  };
}

function simulatePermutation(
  costSamples,
  order,
  initialCapital = INITIAL_CAPITAL
) {
  let balance = initialCapital;
  let peakBalance = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let consecutiveOriginalLosses = 0;
  let consecutiveNetLosses = 0;
  let maxConsecutiveNetLosses = 0;
  let minimumBalance = initialCapital;
  let totalR = 0;
  let breached90 = false;
  let breached80 = false;

  for (const index of order) {
    const sample = costSamples[index];
    const baseRiskR = PortfolioRiskExperiment.riskMultiplier(
      'B',
      sample.qualityScore
    );
    const protection =
      QualityDrawdownExperiment.protectionMultiplier(
        'C',
        sample.qualityScore,
        consecutiveOriginalLosses
      );
    const appliedRiskR = baseRiskR * protection;
    const appliedNetR = sample.netR * appliedRiskR;
    const tradeReturn = appliedNetR * ONE_R_RISK_RATE;
    balance *= 1 + tradeReturn;
    totalR += appliedNetR;
    peakBalance = Math.max(peakBalance, balance);
    minimumBalance = Math.min(minimumBalance, balance);

    const drawdown = peakBalance - balance;
    const drawdownPercent = peakBalance > 0
      ? drawdown / peakBalance * 100
      : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPercent = Math.max(
      maxDrawdownPercent,
      drawdownPercent
    );
    if (balance < initialCapital * 0.9) breached90 = true;
    if (balance < initialCapital * 0.8) breached80 = true;

    if (sample.netR < 0) {
      consecutiveNetLosses += 1;
      maxConsecutiveNetLosses = Math.max(
        maxConsecutiveNetLosses,
        consecutiveNetLosses
      );
    } else {
      consecutiveNetLosses = 0;
    }

    if (sample.originalStatus === 'LOSS') {
      consecutiveOriginalLosses += 1;
    }
    if (sample.originalStatus === 'WIN') {
      consecutiveOriginalLosses = 0;
    }
  }

  return {
    endingBalance: balance,
    returnPercent: (balance / initialCapital - 1) * 100,
    totalR,
    maxDrawdown,
    maxDrawdownPercent,
    maxConsecutiveLosses: maxConsecutiveNetLosses,
    minimumBalance,
    breached90,
    breached80,
  };
}

function frequencyDistribution(values) {
  const counts = values.reduce((result, value) => {
    const key = String(value);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  return Object.fromEntries(Object.entries(counts).sort(
    (left, right) => Number(left[0]) - Number(right[0])
  ).map(([value, count]) => [
    value,
    {
      count,
      probability: values.length > 0 ? count / values.length : 0,
    },
  ]));
}

function analyzeCostSamples(
  costSamples,
  options = {}
) {
  const simulations = options.simulations || SIMULATIONS;
  const seed = options.seed === undefined
    ? RANDOM_SEED
    : options.seed;
  const initialCapital = options.initialCapital || INITIAL_CAPITAL;
  const random = createSeededRandom(seed);
  const runs = [];

  for (let index = 0; index < simulations; index++) {
    runs.push(simulatePermutation(
      costSamples,
      shuffledIndexes(costSamples.length, random),
      initialCapital
    ));
  }

  const returns = runs.map((run) => run.returnPercent);
  const endingBalances = runs.map((run) => run.endingBalance);
  const totalRs = runs.map((run) => run.totalR);
  const drawdownAmounts = runs.map((run) => run.maxDrawdown);
  const drawdownPercents = runs.map(
    (run) => run.maxDrawdownPercent
  );
  const losingStreaks = runs.map(
    (run) => run.maxConsecutiveLosses
  );
  const minimumBalances = runs.map((run) => run.minimumBalance);

  return {
    protocol: {
      simulations,
      seed,
      randomization: 'Seeded Fisher-Yates permutation',
      samplesPerSimulation: costSamples.length,
      initialCapital,
      costs:
        'Taker 0.05% per side plus 0.01% adverse slippage per side',
      riskModel:
        'Quality Risk C recalculated on each randomized original WIN/LOSS order',
      losingStreakDefinition:
        'Consecutive cost-adjusted net losing trades',
    },
    returns: summarizeDistribution(returns),
    endingBalances: summarizeDistribution(endingBalances),
    totalR: summarizeDistribution(totalRs),
    maxDrawdown: {
      amount: summarizeDistribution(drawdownAmounts),
      percent: summarizeDistribution(drawdownPercents),
    },
    maxConsecutiveLosses: {
      summary: summarizeDistribution(losingStreaks),
      frequencies: frequencyDistribution(losingStreaks),
    },
    minimumBalance: summarizeDistribution(minimumBalances),
    breachProbability: {
      below90Percent: runs.filter(
        (run) => run.breached90
      ).length / simulations,
      below80Percent: runs.filter(
        (run) => run.breached80
      ).length / simulations,
    },
    runs,
  };
}

function analyzeMonteCarlo({
  setups,
  entries,
  trades,
  klines,
}, options) {
  const quality = QualityScoreExperiment.analyzeQualityScore({
    setups,
    entries,
    trades,
    klines,
  });
  const executions = TradingCostExperiment.attachExecutionPrices(
    quality.samples,
    trades
  );
  const feeRate = TradingCostExperiment
    .COST_SCHEMES[COST_SCHEME].feeRatePerSide;
  const costSamples = executions.map((sample) =>
    TradingCostExperiment.calculateAdjustedTrade(
      sample,
      feeRate,
      SLIPPAGE_RATE
    )
  );

  return {
    ...analyzeCostSamples(costSamples, options),
    sampleCount: quality.sampleCount,
    scoreRules: quality.scoreRules,
    samples: costSamples,
  };
}

module.exports = {
  COST_SCHEME,
  INITIAL_CAPITAL,
  ONE_R_RISK_RATE,
  RANDOM_SEED,
  SIMULATIONS,
  SLIPPAGE_RATE,
  analyzeCostSamples,
  analyzeMonteCarlo,
  createSeededRandom,
  frequencyDistribution,
  percentile,
  shuffledIndexes,
  simulatePermutation,
  summarizeDistribution,
};
