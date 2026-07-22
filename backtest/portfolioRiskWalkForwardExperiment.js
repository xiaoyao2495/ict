'use strict';

const DrawdownRiskExperiment = require(
  './drawdownRiskExperiment'
);
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
const MAX_ACCOUNT_RISK_R = 1;
const COST_SCHEME = 'B';
const SLIPPAGE_RATE = 0.0001;
const YEARS = PortfolioRiskExperiment.YEARS;
const MODELS = Object.freeze({
  A: Object.freeze({ name: 'Baseline fixed 1%' }),
  B: Object.freeze({ name: 'Quality Risk C' }),
  C: Object.freeze({ name: 'Quality Risk C + 1% risk cap' }),
  D: Object.freeze({
    name: 'Portfolio Scaling',
  }),
});

function drawdownScale(drawdownPercent) {
  if (drawdownPercent > 15) return 0.25;
  if (drawdownPercent >= 10) return 0.5;
  if (drawdownPercent >= 5) return 0.75;
  return 1;
}

function modelRisk(
  model,
  qualityScore,
  consecutiveLosses,
  drawdownPercent
) {
  if (!MODELS[model]) {
    throw new Error(`Unknown portfolio walk-forward model: ${model}`);
  }
  if (model === 'A') {
    return {
      qualityRiskR: 1,
      cappedRiskR: 1,
      drawdownScale: 1,
      appliedRiskR: 1,
    };
  }

  const baseRiskR = PortfolioRiskExperiment.riskMultiplier(
    'B',
    qualityScore
  );
  const qualityProtection =
    QualityDrawdownExperiment.protectionMultiplier(
      'C',
      qualityScore,
      consecutiveLosses
    );
  const qualityRiskR = baseRiskR * qualityProtection;
  const cappedRiskR = model === 'B'
    ? qualityRiskR
    : Math.min(qualityRiskR, MAX_ACCOUNT_RISK_R);
  const scale = model === 'D'
    ? drawdownScale(drawdownPercent)
    : 1;

  return {
    baseRiskR,
    qualityProtection,
    qualityRiskR,
    cappedRiskR,
    drawdownScale: scale,
    appliedRiskR: cappedRiskR * scale,
  };
}

function prepareCostSamples(executionSamples) {
  const feeRate = TradingCostExperiment
    .COST_SCHEMES[COST_SCHEME].feeRatePerSide;
  return executionSamples.map((sample) =>
    TradingCostExperiment.calculateAdjustedTrade(
      sample,
      feeRate,
      SLIPPAGE_RATE
    )
  );
}

function simulateModel(
  costSamples,
  model,
  initialCapital = INITIAL_CAPITAL,
  years = YEARS
) {
  if (!MODELS[model]) {
    throw new Error(`Unknown portfolio walk-forward model: ${model}`);
  }
  const allowedYears = new Set(years);
  const chronological = [...costSamples].filter(
    (sample) => allowedYears.has(sample.year)
  ).sort((left, right) => left.entryIndex - right.entryIndex);
  const grouped = new Map(years.map((year) => [year, []]));
  for (const sample of chronological) grouped.get(sample.year).push(sample);

  let balance = initialCapital;
  let historicalPeak = initialCapital;
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
    let yearR = 0;

    for (const sample of grouped.get(year)) {
      const preTradeDrawdownPercent = historicalPeak > 0
        ? (historicalPeak - balance) / historicalPeak * 100
        : 0;
      const preTradeConsecutiveLosses = consecutiveLosses;
      const risk = modelRisk(
        model,
        sample.qualityScore,
        preTradeConsecutiveLosses,
        preTradeDrawdownPercent
      );
      const appliedNetR = sample.netR * risk.appliedRiskR;
      const tradeReturn = appliedNetR * ONE_R_RISK_RATE;
      const startingBalance = balance;
      const pnl = startingBalance * tradeReturn;
      balance += pnl;
      yearR += appliedNetR;

      DrawdownRiskExperiment.updatePeriod(
        yearState,
        tradeReturn,
        pnl,
        balance,
        sample.netStatus
      );
      DrawdownRiskExperiment.updatePeriod(
        overallState,
        tradeReturn,
        pnl,
        balance,
        sample.netStatus
      );

      if (balance > historicalPeak) historicalPeak = balance;
      if (sample.originalStatus === 'LOSS') consecutiveLosses += 1;
      if (sample.originalStatus === 'WIN') consecutiveLosses = 0;

      trades.push({
        ...sample,
        model,
        startingBalance,
        endingBalance: balance,
        pnl,
        appliedNetR,
        preTradeDrawdownPercent,
        preTradeConsecutiveLosses,
        ...risk,
      });
    }

    yearState.endingBalance = balance;
    yearly.push({
      year,
      totalR: yearR,
      ...DrawdownRiskExperiment.finalizePeriod(yearState),
    });
  }

  overallState.endingBalance = balance;

  return {
    model,
    name: MODELS[model].name,
    yearly,
    overall: {
      totalR: trades.reduce(
        (sum, trade) => sum + trade.appliedNetR,
        0
      ),
      ...DrawdownRiskExperiment.finalizePeriod(overallState),
    },
    audit: {
      qualityProtectionTriggers: trades.filter(
        (trade) => trade.qualityProtection < 1
      ).length,
      riskCapTriggers: trades.filter(
        (trade) => trade.cappedRiskR < trade.qualityRiskR
      ).length,
      drawdownScaleCounts: trades.reduce((counts, trade) => {
        const key = String(trade.drawdownScale);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
    },
    trades,
  };
}

function analyzeCostSamples(costSamples) {
  return {
    protocol: {
      forwardOnly: true,
      parameterTuning: false,
      baselineChanged: false,
      qualityScoreChanged: false,
      qualityRiskCChanged: false,
      productionEntryChanged: false,
      initialCapital: INITIAL_CAPITAL,
      oneRDefinition: '1% of pre-trade equity',
      maximumAccountRisk: '1% per trade for Model C and D',
      portfolioScalingBase:
        'Model C capped risk, then multiplied by historical-peak drawdown scale',
      costs:
        'Taker 0.05% per side plus 0.01% adverse slippage per side',
      stateContinuity:
        'Balance, consecutive-loss state, and historical peak continue across calendar years',
    },
    models: Object.fromEntries(Object.keys(MODELS).map((model) => [
      model,
      simulateModel(costSamples, model),
    ])),
  };
}

function analyzePortfolioRiskWalkForward({
  setups,
  entries,
  trades,
  klines,
}) {
  const quality = QualityScoreExperiment.analyzeQualityScore({
    setups,
    entries,
    trades,
    klines,
  });
  const executionSamples = TradingCostExperiment
    .attachExecutionPrices(quality.samples, trades);
  const costSamples = prepareCostSamples(executionSamples);

  return {
    ...analyzeCostSamples(costSamples),
    sampleCount: quality.sampleCount,
    scoreRules: quality.scoreRules,
    samples: costSamples,
  };
}

module.exports = {
  COST_SCHEME,
  INITIAL_CAPITAL,
  MAX_ACCOUNT_RISK_R,
  MODELS,
  ONE_R_RISK_RATE,
  SLIPPAGE_RATE,
  YEARS,
  analyzeCostSamples,
  analyzePortfolioRiskWalkForward,
  drawdownScale,
  modelRisk,
  prepareCostSamples,
  simulateModel,
};
