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

const INITIAL_CAPITAL = 10000;
const ONE_R_RISK_RATE = 0.01;
const YEARS = PortfolioRiskExperiment.YEARS;
const COST_SCHEMES = Object.freeze({
  A: Object.freeze({ name: 'No cost', feeRatePerSide: 0 }),
  B: Object.freeze({
    name: 'Binance Futures taker',
    feeRatePerSide: 0.0005,
  }),
  C: Object.freeze({
    name: 'Maker',
    feeRatePerSide: 0.0002,
  }),
});
const SLIPPAGES = Object.freeze([0, 0.0001, 0.0003]);
const PORTFOLIO_MODELS = Object.freeze({
  BASELINE: 'Baseline',
  QUALITY_RISK_C: 'Quality Risk C',
});

function executionKey(trade) {
  return `${trade.setupIndex}:${trade.entryIndex}`;
}

function attachExecutionPrices(scoredSamples, trades) {
  const tradeByKey = new Map(trades.map((trade) => [
    executionKey(trade),
    trade,
  ]));

  return scoredSamples.map((sample) => {
    const trade = tradeByKey.get(executionKey(sample));
    if (!trade) {
      throw new Error(
        `Trading cost experiment cannot find trade ${executionKey(sample)}`
      );
    }
    if (
      !Number.isFinite(trade.entry) ||
      !Number.isFinite(trade.stop) ||
      !Number.isFinite(trade.exitPrice)
    ) {
      throw new Error(
        `Trading cost experiment requires closed execution prices for ${executionKey(sample)}`
      );
    }

    return {
      ...sample,
      direction: String(trade.type || sample.direction).toUpperCase(),
      entryPrice: trade.entry,
      stopPrice: trade.stop,
      exitPrice: trade.exitPrice,
      originalR: trade.r,
      originalStatus: String(trade.status).toUpperCase(),
    };
  });
}

function calculateAdjustedTrade(sample, feeRate, slippageRate) {
  const direction = String(sample.direction).toUpperCase();
  const isLong = direction === 'LONG';
  const isShort = direction === 'SHORT';
  if (!isLong && !isShort) {
    throw new Error(`Unsupported trade direction: ${direction}`);
  }
  const adjustedEntryPrice = isLong
    ? sample.entryPrice * (1 + slippageRate)
    : sample.entryPrice * (1 - slippageRate);
  const adjustedExitPrice = isLong
    ? sample.exitPrice * (1 - slippageRate)
    : sample.exitPrice * (1 + slippageRate);
  const riskPerUnit = Math.abs(
    sample.entryPrice - sample.stopPrice
  );
  if (!(riskPerUnit > 0)) {
    throw new Error(
      `Trading cost experiment has invalid risk distance for ${executionKey(sample)}`
    );
  }
  const grossPnlPerUnit = isLong
    ? adjustedExitPrice - adjustedEntryPrice
    : adjustedEntryPrice - adjustedExitPrice;
  const feesPerUnit = feeRate * (
    Math.abs(adjustedEntryPrice) + Math.abs(adjustedExitPrice)
  );
  const netPnlPerUnit = grossPnlPerUnit - feesPerUnit;
  const netR = netPnlPerUnit / riskPerUnit;

  return {
    ...sample,
    adjustedEntryPrice,
    adjustedExitPrice,
    riskPerUnit,
    grossPnlPerUnit,
    feesPerUnit,
    netPnlPerUnit,
    netR,
    netStatus: netR > 0 ? 'WIN' : 'LOSS',
  };
}

function baseAndProtectionRisk(
  portfolioModel,
  qualityScore,
  consecutiveLosses
) {
  if (portfolioModel === 'BASELINE') {
    return { baseRiskR: 1, protectionMultiplier: 1 };
  }
  if (portfolioModel === 'QUALITY_RISK_C') {
    return {
      baseRiskR: PortfolioRiskExperiment.riskMultiplier(
        'B',
        qualityScore
      ),
      protectionMultiplier:
        QualityDrawdownExperiment.protectionMultiplier(
          'C',
          qualityScore,
          consecutiveLosses
        ),
    };
  }
  throw new Error(`Unknown trading cost portfolio model: ${portfolioModel}`);
}

function simulateScenario(
  executionSamples,
  portfolioModel,
  costScheme,
  slippageRate,
  initialCapital = INITIAL_CAPITAL,
  years = YEARS
) {
  const scheme = COST_SCHEMES[costScheme];
  if (!scheme) throw new Error(`Unknown cost scheme: ${costScheme}`);
  if (!SLIPPAGES.includes(slippageRate)) {
    throw new Error(`Unsupported slippage rate: ${slippageRate}`);
  }
  const allowedYears = new Set(years);
  const adjusted = executionSamples.filter(
    (sample) => allowedYears.has(sample.year)
  ).map((sample) => calculateAdjustedTrade(
    sample,
    scheme.feeRatePerSide,
    slippageRate
  )).sort((left, right) => left.entryIndex - right.entryIndex);
  const grouped = new Map(years.map((year) => [year, []]));
  for (const sample of adjusted) grouped.get(sample.year).push(sample);

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
    let yearR = 0;

    for (const sample of grouped.get(year)) {
      const preTradeConsecutiveLosses = consecutiveLosses;
      const risk = baseAndProtectionRisk(
        portfolioModel,
        sample.qualityScore,
        preTradeConsecutiveLosses
      );
      const appliedRiskR = risk.baseRiskR *
        risk.protectionMultiplier;
      const appliedNetR = sample.netR * appliedRiskR;
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

      if (sample.originalStatus === 'LOSS') consecutiveLosses += 1;
      if (sample.originalStatus === 'WIN') consecutiveLosses = 0;

      trades.push({
        ...sample,
        portfolioModel,
        costScheme,
        slippageRate,
        startingBalance,
        endingBalance: balance,
        pnl,
        baseRiskR: risk.baseRiskR,
        protectionMultiplier: risk.protectionMultiplier,
        appliedRiskR,
        appliedNetR,
        preTradeConsecutiveLosses,
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
    portfolioModel,
    portfolioName: PORTFOLIO_MODELS[portfolioModel],
    costScheme,
    costName: scheme.name,
    feeRatePerSide: scheme.feeRatePerSide,
    slippageRate,
    yearly,
    overall: {
      totalR: trades.reduce(
        (sum, trade) => sum + trade.appliedNetR,
        0
      ),
      ...DrawdownRiskExperiment.finalizePeriod(overallState),
    },
    trades,
  };
}

function analyzeExecutionSamples(executionSamples) {
  const scenarios = {};

  for (const portfolioModel of Object.keys(PORTFOLIO_MODELS)) {
    scenarios[portfolioModel] = [];
    for (const costScheme of Object.keys(COST_SCHEMES)) {
      for (const slippageRate of SLIPPAGES) {
        scenarios[portfolioModel].push(simulateScenario(
          executionSamples,
          portfolioModel,
          costScheme,
          slippageRate
        ));
      }
    }
  }

  return {
    protocol: {
      postProcessingOnly: true,
      baselineChanged: false,
      qualityScoreChanged: false,
      riskModelChanged: false,
      productionEntryChanged: false,
      adverseSlippage:
        'LONG entry up / exit down; SHORT entry down / exit up',
      rDenominator:
        'Original planned absolute Entry-to-Stop distance',
      fees:
        'Applied to adjusted entry and adjusted exit notional per unit',
      riskState:
        'Quality Risk C protection continues to use original trade WIN/LOSS, not cost-adjusted status',
    },
    costSchemes: COST_SCHEMES,
    slippages: [...SLIPPAGES],
    scenarios,
  };
}

function analyzeTradingCosts({
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
  const executionSamples = attachExecutionPrices(
    quality.samples,
    trades
  );

  return {
    ...analyzeExecutionSamples(executionSamples),
    sampleCount: quality.sampleCount,
    scoreRules: quality.scoreRules,
    samples: executionSamples,
  };
}

module.exports = {
  COST_SCHEMES,
  INITIAL_CAPITAL,
  ONE_R_RISK_RATE,
  PORTFOLIO_MODELS,
  SLIPPAGES,
  YEARS,
  analyzeExecutionSamples,
  analyzeTradingCosts,
  attachExecutionPrices,
  baseAndProtectionRisk,
  calculateAdjustedTrade,
  executionKey,
  simulateScenario,
};
