'use strict';

const DrawdownRiskExperiment = require(
  './drawdownRiskExperiment'
);
const PortfolioRiskExperiment = require(
  './portfolioRiskExperiment'
);
const QualityScoreExperiment = require(
  './qualityScoreExperiment'
);

const INITIAL_CAPITAL = 10000;
const ONE_R_RISK_RATE = 0.01;
const YEARS = PortfolioRiskExperiment.YEARS;
const MODELS = Object.freeze({
  A: Object.freeze({ name: 'Fixed quality risk' }),
  B: Object.freeze({ name: 'Quality risk + losing-streak protection' }),
  C: Object.freeze({ name: 'Low-quality-only protection' }),
});
const SCORE_GROUPS = Object.freeze(['0-1', '2', '3+']);

function scoreGroup(score) {
  if (score >= 3) return '3+';
  if (score === 2) return '2';
  return '0-1';
}

function protectionMultiplier(model, qualityScore, consecutiveLosses) {
  if (model === 'A') return 1;
  if (model === 'B') {
    return DrawdownRiskExperiment
      .losingStreakProtectionMultiplier(consecutiveLosses);
  }
  if (model === 'C') {
    return qualityScore <= 1 && consecutiveLosses >= 2
      ? 0.5
      : 1;
  }
  throw new Error(`Unknown quality drawdown model: ${model}`);
}

function maxLosingStreak(trades) {
  const chronological = [...trades].sort((left, right) =>
    left.entryIndex - right.entryIndex
  );
  let current = 0;
  let maximum = 0;

  for (const trade of chronological) {
    if (trade.status === 'LOSS') {
      current += 1;
      maximum = Math.max(maximum, current);
    } else if (trade.status === 'WIN') {
      current = 0;
    }
  }

  return maximum;
}

function scoreContributions(trades) {
  const result = Object.fromEntries(SCORE_GROUPS.map((group) => [
    group,
    {
      trades: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      grossProfit: 0,
      grossLoss: 0,
      appliedRContribution: 0,
    },
  ]));

  for (const trade of trades) {
    const group = scoreGroup(trade.qualityScore);
    const row = result[group];
    row.trades += 1;
    if (trade.status === 'WIN') row.wins += 1;
    if (trade.status === 'LOSS') row.losses += 1;
    row.netPnl += trade.pnl;
    if (trade.pnl > 0) row.grossProfit += trade.pnl;
    if (trade.pnl < 0) row.grossLoss += Math.abs(trade.pnl);
    row.appliedRContribution += trade.r * trade.appliedRiskR;
  }

  return result;
}

function simulateModel(
  scoredSamples,
  model,
  initialCapital = INITIAL_CAPITAL,
  years = YEARS
) {
  if (!MODELS[model]) {
    throw new Error(`Unknown quality drawdown model: ${model}`);
  }
  const allowedYears = new Set(years);
  const chronological = [...scoredSamples].filter(
    (sample) => allowedYears.has(sample.year)
  ).sort((left, right) => left.entryIndex - right.entryIndex);
  const grouped = new Map(years.map((year) => [year, []]));
  for (const sample of chronological) grouped.get(sample.year).push(sample);

  let balance = initialCapital;
  let consecutiveLosses = 0;
  const overallState = DrawdownRiskExperiment.createPeriodState(
    balance
  );
  const yearly = [];
  const trades = [];

  for (const year of years) {
    const yearState = DrawdownRiskExperiment.createPeriodState(
      balance
    );
    const yearTrades = [];

    for (const sample of grouped.get(year)) {
      if (!Number.isFinite(sample.r)) continue;
      const preTradeConsecutiveLosses = consecutiveLosses;
      const protection = protectionMultiplier(
        model,
        sample.qualityScore,
        preTradeConsecutiveLosses
      );
      const baseRiskR = PortfolioRiskExperiment.riskMultiplier(
        'B',
        sample.qualityScore
      );
      const appliedRiskR = baseRiskR * protection;
      const tradeReturn = sample.r * ONE_R_RISK_RATE * appliedRiskR;
      const startingBalance = balance;
      const pnl = startingBalance * tradeReturn;
      balance += pnl;

      DrawdownRiskExperiment.updatePeriod(
        yearState,
        tradeReturn,
        pnl,
        balance,
        sample.status
      );
      DrawdownRiskExperiment.updatePeriod(
        overallState,
        tradeReturn,
        pnl,
        balance,
        sample.status
      );

      if (sample.status === 'LOSS') consecutiveLosses += 1;
      if (sample.status === 'WIN') consecutiveLosses = 0;

      const trade = {
        ...sample,
        model,
        startingBalance,
        endingBalance: balance,
        pnl,
        baseRiskR,
        protectionMultiplier: protection,
        appliedRiskR,
        preTradeConsecutiveLosses,
      };
      trades.push(trade);
      yearTrades.push(trade);
    }

    yearState.endingBalance = balance;
    yearly.push({
      year,
      ...DrawdownRiskExperiment.finalizePeriod(yearState),
      maxLosingStreak: maxLosingStreak(yearTrades),
      scoreContributions: scoreContributions(yearTrades),
    });
  }

  overallState.endingBalance = balance;

  return {
    model,
    name: MODELS[model].name,
    yearly,
    overall: {
      ...DrawdownRiskExperiment.finalizePeriod(overallState),
      maxLosingStreak: maxLosingStreak(trades),
      scoreContributions: scoreContributions(trades),
    },
    trades,
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
      productionEntryChanged: false,
      oneRDefinition:
        '1% of pre-trade equity, compounded chronologically',
      modelA: 'Fixed 0.5R / 1R / 1.25R by Quality Score',
      modelB:
        'Model A risk *0.5 after 3 consecutive losses and *0.25 after 5; reset after a win',
      modelC:
        'Only a current Score <=1 trade is multiplied by 0.5 after 2 account-level consecutive losses; Score 2 and Score 3+ are never reduced',
      scoreContribution:
        'Net compounded USDT PnL attributed to each score group',
    },
    initialCapital,
    scoreGroups: [...SCORE_GROUPS],
    models: Object.fromEntries(Object.keys(MODELS).map((model) => [
      model,
      simulateModel(scoredSamples, model, initialCapital),
    ])),
  };
}

function analyzeQualityDrawdown(input) {
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
  MODELS,
  ONE_R_RISK_RATE,
  SCORE_GROUPS,
  YEARS,
  analyzeQualityDrawdown,
  analyzeScoredSamples,
  maxLosingStreak,
  protectionMultiplier,
  scoreContributions,
  scoreGroup,
  simulateModel,
};
