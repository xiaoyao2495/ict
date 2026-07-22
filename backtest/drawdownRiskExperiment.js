'use strict';

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
  B: Object.freeze({ name: 'Drawdown protection' }),
  C: Object.freeze({ name: 'Losing-streak protection' }),
});

function drawdownProtectionMultiplier(drawdownPercent) {
  if (drawdownPercent >= 10) return 0.5;
  if (drawdownPercent >= 5) return 0.75;
  return 1;
}

function losingStreakProtectionMultiplier(consecutiveLosses) {
  if (consecutiveLosses >= 5) return 0.25;
  if (consecutiveLosses >= 3) return 0.5;
  return 1;
}

function protectionMultiplier(model, state) {
  if (model === 'A') return 1;
  if (model === 'B') {
    return drawdownProtectionMultiplier(
      state.preTradeDrawdownPercent
    );
  }
  if (model === 'C') {
    return losingStreakProtectionMultiplier(
      state.consecutiveLosses
    );
  }
  throw new Error(`Unknown drawdown risk model: ${model}`);
}

function createPeriodState(startingBalance) {
  return {
    startingBalance,
    endingBalance: startingBalance,
    peakBalance: startingBalance,
    peakTradeNumber: 0,
    inDrawdown: false,
    drawdownPeakTradeNumber: null,
    processedTrades: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    longestRecoveryTrades: 0,
    grossProfit: 0,
    grossLoss: 0,
    wins: 0,
    losses: 0,
    returns: [],
  };
}

function updatePeriod(state, tradeReturn, pnl, endingBalance, status) {
  state.processedTrades += 1;
  state.endingBalance = endingBalance;
  state.returns.push(tradeReturn);

  if (pnl > 0) state.grossProfit += pnl;
  if (pnl < 0) state.grossLoss += Math.abs(pnl);
  if (status === 'WIN') state.wins += 1;
  if (status === 'LOSS') state.losses += 1;

  if (endingBalance >= state.peakBalance) {
    if (state.inDrawdown) {
      state.longestRecoveryTrades = Math.max(
        state.longestRecoveryTrades,
        state.processedTrades - state.drawdownPeakTradeNumber
      );
      state.inDrawdown = false;
      state.drawdownPeakTradeNumber = null;
    }
    if (endingBalance > state.peakBalance) {
      state.peakBalance = endingBalance;
      state.peakTradeNumber = state.processedTrades;
    }
    return;
  }

  if (!state.inDrawdown) {
    state.inDrawdown = true;
    state.drawdownPeakTradeNumber = state.peakTradeNumber;
  }

  const drawdown = state.peakBalance - endingBalance;
  const drawdownPercent = state.peakBalance > 0
    ? drawdown / state.peakBalance * 100
    : 0;
  state.maxDrawdown = Math.max(state.maxDrawdown, drawdown);
  state.maxDrawdownPercent = Math.max(
    state.maxDrawdownPercent,
    drawdownPercent
  );
  state.longestRecoveryTrades = Math.max(
    state.longestRecoveryTrades,
    state.processedTrades - state.drawdownPeakTradeNumber
  );
}

function finalizePeriod(state) {
  const trades = state.wins + state.losses;
  const netProfit = state.endingBalance - state.startingBalance;

  return {
    startingBalance: state.startingBalance,
    endingBalance: state.endingBalance,
    returnPercent: state.startingBalance > 0
      ? netProfit / state.startingBalance * 100
      : null,
    maxDrawdown: state.maxDrawdown,
    maxDrawdownPercent: state.maxDrawdownPercent,
    sharpe: PortfolioRiskExperiment.calculateSharpe(
      state.returns
    ),
    profitFactor: state.grossLoss > 0
      ? state.grossProfit / state.grossLoss
      : null,
    recoveryFactor: state.maxDrawdown > 0
      ? netProfit / state.maxDrawdown
      : null,
    longestRecoveryTrades: state.longestRecoveryTrades,
    trades,
    wins: state.wins,
    losses: state.losses,
    winRate: trades > 0 ? state.wins / trades : 0,
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
  if (!MODELS[model]) {
    throw new Error(`Unknown drawdown risk model: ${model}`);
  }
  const allowedYears = new Set(years);
  const chronological = [...scoredSamples].filter(
    (sample) => allowedYears.has(sample.year)
  ).sort((left, right) => left.entryIndex - right.entryIndex);
  const grouped = new Map(years.map((year) => [year, []]));
  for (const sample of chronological) grouped.get(sample.year).push(sample);

  let balance = initialCapital;
  let historicalPeak = initialCapital;
  let consecutiveLosses = 0;
  const overallState = createPeriodState(balance);
  const yearly = [];
  const trades = [];

  for (const year of years) {
    const yearState = createPeriodState(balance);

    for (const sample of grouped.get(year)) {
      if (!Number.isFinite(sample.r)) continue;
      const preTradeConsecutiveLosses = consecutiveLosses;
      const preTradeDrawdownPercent = historicalPeak > 0
        ? (historicalPeak - balance) / historicalPeak * 100
        : 0;
      const protection = protectionMultiplier(model, {
        preTradeDrawdownPercent,
        consecutiveLosses,
      });
      const baseRiskR = PortfolioRiskExperiment.riskMultiplier(
        'B',
        sample.qualityScore
      );
      const appliedRiskR = baseRiskR * protection;
      const tradeReturn = sample.r * ONE_R_RISK_RATE * appliedRiskR;
      const startingBalance = balance;
      const pnl = startingBalance * tradeReturn;
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

      if (balance > historicalPeak) historicalPeak = balance;
      if (sample.status === 'LOSS') consecutiveLosses += 1;
      if (sample.status === 'WIN') consecutiveLosses = 0;

      trades.push({
        ...sample,
        model,
        startingBalance,
        endingBalance: balance,
        pnl,
        baseRiskR,
        protectionMultiplier: protection,
        appliedRiskR,
        preTradeDrawdownPercent,
        preTradeConsecutiveLosses,
      });
    }

    yearState.endingBalance = balance;
    yearly.push({ year, ...finalizePeriod(yearState) });
  }

  overallState.endingBalance = balance;

  return {
    model,
    name: MODELS[model].name,
    yearly,
    overall: finalizePeriod(overallState),
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
      entryExitChanged: false,
      oneRDefinition:
        '1% of pre-trade equity, compounded chronologically',
      modelA: 'Fixed 0.5R / 1R / 1.25R by Quality Score',
      modelB:
        'Model A risk multiplied by 0.75 at >=5% historical-peak drawdown and 0.5 at >=10%; normal after a new high',
      modelC:
        'Model A risk multiplied by 0.5 after 3 consecutive losses and 0.25 after 5; reset after a win',
      recoveryFactor:
        'Period net profit / period maximum drawdown in USDT',
      recoveryTime:
        'Maximum number of trades from an equity peak until recovery or period end',
    },
    initialCapital,
    models: Object.fromEntries(Object.keys(MODELS).map((model) => [
      model,
      simulateModel(scoredSamples, model, initialCapital),
    ])),
  };
}

function analyzeDrawdownRisk(input) {
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
  YEARS,
  analyzeDrawdownRisk,
  analyzeScoredSamples,
  createPeriodState,
  drawdownProtectionMultiplier,
  finalizePeriod,
  losingStreakProtectionMultiplier,
  protectionMultiplier,
  simulateModel,
  updatePeriod,
};
