'use strict';

const QualityScoreExperiment = require(
  './qualityScoreExperiment'
);

const INITIAL_CAPITAL = 10000;
const ONE_R_RISK_RATE = 0.01;
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);
const RISK_MODELS = Object.freeze({
  A: Object.freeze({
    name: 'Original Baseline',
    score0To1: 1,
    score2: 1,
    score3Plus: 1,
  }),
  B: Object.freeze({
    name: 'Risk Model B',
    score0To1: 0.5,
    score2: 1,
    score3Plus: 1.25,
  }),
  C: Object.freeze({
    name: 'Risk Model C',
    score0To1: 0.5,
    score2: 1,
    score3Plus: 1.5,
  }),
});

function riskMultiplier(model, qualityScore) {
  if (!RISK_MODELS[model]) {
    throw new Error(`Unknown portfolio risk model: ${model}`);
  }
  if (qualityScore >= 3) return RISK_MODELS[model].score3Plus;
  if (qualityScore === 2) return RISK_MODELS[model].score2;
  return RISK_MODELS[model].score0To1;
}

function calculateSharpe(returns) {
  const finite = returns.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) /
    finite.length;
  const variance = finite.reduce(
    (sum, value) => sum + Math.pow(value - mean, 2),
    0
  ) / (finite.length - 1);
  const standardDeviation = Math.sqrt(variance);
  if (standardDeviation === 0) return null;
  return mean / standardDeviation * Math.sqrt(finite.length);
}

function createPeriodState(startingBalance) {
  return {
    startingBalance,
    endingBalance: startingBalance,
    peakBalance: startingBalance,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    grossProfit: 0,
    grossLoss: 0,
    wins: 0,
    losses: 0,
    returns: [],
  };
}

function updatePeriod(state, tradeReturn, pnl, endingBalance, status) {
  state.endingBalance = endingBalance;
  state.peakBalance = Math.max(state.peakBalance, endingBalance);
  const drawdown = state.peakBalance - endingBalance;
  const drawdownPercent = state.peakBalance > 0
    ? drawdown / state.peakBalance * 100
    : 0;
  state.maxDrawdown = Math.max(state.maxDrawdown, drawdown);
  state.maxDrawdownPercent = Math.max(
    state.maxDrawdownPercent,
    drawdownPercent
  );
  state.returns.push(tradeReturn);

  if (pnl > 0) state.grossProfit += pnl;
  if (pnl < 0) state.grossLoss += Math.abs(pnl);
  if (status === 'WIN') state.wins += 1;
  if (status === 'LOSS') state.losses += 1;
}

function finalizePeriod(state) {
  const trades = state.wins + state.losses;
  return {
    startingBalance: state.startingBalance,
    endingBalance: state.endingBalance,
    returnPercent: state.startingBalance > 0
      ? (state.endingBalance / state.startingBalance - 1) * 100
      : null,
    maxDrawdown: state.maxDrawdown,
    maxDrawdownPercent: state.maxDrawdownPercent,
    sharpe: calculateSharpe(state.returns),
    profitFactor: state.grossLoss > 0
      ? state.grossProfit / state.grossLoss
      : null,
    winRate: trades > 0 ? state.wins / trades : 0,
    trades,
    wins: state.wins,
    losses: state.losses,
    grossProfit: state.grossProfit,
    grossLoss: state.grossLoss,
  };
}

function simulateModel(
  scoredSamples,
  model,
  initialCapital = INITIAL_CAPITAL,
  years = YEARS
) {
  const chronological = [...scoredSamples].sort((left, right) =>
    left.entryIndex - right.entryIndex
  );
  const allowedYears = new Set(years);
  const samples = chronological.filter(
    (sample) => allowedYears.has(sample.year)
  );
  const grouped = new Map(years.map((year) => [year, []]));

  for (const sample of samples) grouped.get(sample.year).push(sample);

  let balance = initialCapital;
  const overallState = createPeriodState(balance);
  const yearly = [];

  for (const year of years) {
    const yearState = createPeriodState(balance);

    for (const sample of grouped.get(year)) {
      if (!Number.isFinite(sample.r)) continue;
      const multiplier = riskMultiplier(model, sample.qualityScore);
      const tradeReturn = sample.r * ONE_R_RISK_RATE * multiplier;
      const pnl = balance * tradeReturn;
      balance += pnl;

      updatePeriod(
        yearState,
        tradeReturn,
        pnl,
        balance,
        sample.status
      );
      updatePeriod(
        overallState,
        tradeReturn,
        pnl,
        balance,
        sample.status
      );
    }

    yearState.endingBalance = balance;
    yearly.push({
      year,
      ...finalizePeriod(yearState),
    });
  }

  overallState.endingBalance = balance;

  return {
    model,
    name: RISK_MODELS[model].name,
    multipliers: { ...RISK_MODELS[model] },
    yearly,
    overall: finalizePeriod(overallState),
  };
}

function analyzeScoredSamples(
  scoredSamples,
  initialCapital = INITIAL_CAPITAL
) {
  return {
    protocol: {
      postProcessingOnly: true,
      baselineChanged: false,
      qualityScoreChanged: false,
      entryExitChanged: false,
      oneRDefinition:
        '1% of pre-trade equity, compounded chronologically',
      sharpeDefinition:
        'Mean per-trade return / sample standard deviation * sqrt(number of trades), zero risk-free rate',
      profitFactorDefinition:
        'Gross winning USDT PnL / absolute gross losing USDT PnL',
    },
    initialCapital,
    models: Object.fromEntries(Object.keys(RISK_MODELS).map(
      (model) => [
        model,
        simulateModel(scoredSamples, model, initialCapital),
      ]
    )),
  };
}

function analyzePortfolioRisk(input) {
  const quality = QualityScoreExperiment.analyzeQualityScore(input);

  return {
    ...analyzeScoredSamples(quality.samples),
    sampleCount: quality.sampleCount,
    scoreRules: quality.scoreRules,
    samples: quality.samples,
  };
}

module.exports = {
  INITIAL_CAPITAL,
  ONE_R_RISK_RATE,
  RISK_MODELS,
  YEARS,
  analyzePortfolioRisk,
  analyzeScoredSamples,
  calculateSharpe,
  createPeriodState,
  finalizePeriod,
  riskMultiplier,
  simulateModel,
  updatePeriod,
};
