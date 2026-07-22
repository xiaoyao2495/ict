'use strict';

const BacktestEngine = require('./backtestEngine');
const MarketRegimeExperiment = require(
  './marketRegimeExperiment'
);

const MODES = Object.freeze({
  A: 'LIQUIDITY_TARGET',
  B: 'FIXED_2R',
  C: 'ONE_R_PROTECTION_RUNNER',
  D: 'HALF_2R_HALF_LIQUIDITY',
  E: 'REGIME_ADAPTIVE',
});

function getDirection(entry) {
  return entry.type === 'LONG_ENTRY' ? 'LONG' : 'SHORT';
}

function getRisk(entry, direction) {
  return direction === 'LONG'
    ? entry.entry - entry.stop
    : entry.stop - entry.entry;
}

function priceAtR(entry, direction, r) {
  const risk = getRisk(entry, direction);
  return direction === 'LONG'
    ? entry.entry + risk * r
    : entry.entry - risk * r;
}

function rAtPrice(entry, direction, price) {
  const risk = getRisk(entry, direction);
  if (risk <= 0) return 0;
  return direction === 'LONG'
    ? (price - entry.entry) / risk
    : (entry.entry - price) / risk;
}

function stopTouched(kline, direction, stop) {
  return direction === 'LONG'
    ? kline.low <= stop
    : kline.high >= stop;
}

function targetTouched(kline, direction, target) {
  return direction === 'LONG'
    ? kline.high >= target
    : kline.low <= target;
}

function statusFromR(r, isOpen) {
  if (isOpen) return 'OPEN';
  if (r > 0) return 'WIN';
  if (r < 0) return 'LOSS';
  return 'BREAKEVEN';
}

function createTrade(entry, direction, mode, target) {
  return {
    type: direction,
    mode,
    status: 'OPEN',
    entry: entry.entry,
    originalStop: entry.stop,
    stop: entry.stop,
    target,
    liquidityTarget: entry.target,
    setupIndex: entry.setupIndex,
    entryIndex: entry.triggerIndex,
    exitIndex: null,
    exitPrice: null,
    r: null,
    protectedAt: null,
    exitReason: null,
  };
}

function closeTrade(trade, entry, direction, index, price, reason) {
  trade.exitIndex = index;
  trade.exitPrice = price;
  trade.r = rAtPrice(entry, direction, price);
  trade.status = statusFromR(trade.r, false);
  trade.exitReason = reason;
  return trade;
}

function simulateSingleTarget(
  entry,
  klines,
  mode,
  target,
  protectAtOneR
) {
  const direction = getDirection(entry);
  const trade = createTrade(entry, direction, mode, target);
  const risk = getRisk(entry, direction);

  if (risk <= 0 || !klines[entry.triggerIndex]) return trade;

  if (stopTouched(
    klines[entry.triggerIndex],
    direction,
    entry.stop
  )) {
    return closeTrade(
      trade,
      entry,
      direction,
      entry.triggerIndex,
      entry.stop,
      'INITIAL_STOP'
    );
  }

  const oneRPrice = priceAtR(entry, direction, 1);

  for (
    let index = entry.triggerIndex + 1;
    index < klines.length;
    index++
  ) {
    if (stopTouched(klines[index], direction, trade.stop)) {
      return closeTrade(
        trade,
        entry,
        direction,
        index,
        trade.stop,
        trade.stop === entry.entry
          ? 'BREAKEVEN_STOP'
          : 'INITIAL_STOP'
      );
    }

    if (targetTouched(klines[index], direction, target)) {
      return closeTrade(
        trade,
        entry,
        direction,
        index,
        target,
        'TARGET'
      );
    }

    if (
      protectAtOneR &&
      trade.protectedAt === null &&
      targetTouched(klines[index], direction, oneRPrice)
    ) {
      trade.protectedAt = index;
      trade.stop = entry.entry;
    }
  }

  return trade;
}

function simulateSplitTarget(entry, klines) {
  const direction = getDirection(entry);
  const fixedTarget = priceAtR(entry, direction, 2);
  const fixedLeg = simulateSingleTarget(
    entry,
    klines,
    MODES.D,
    fixedTarget,
    false
  );
  const liquidityLeg = simulateSingleTarget(
    entry,
    klines,
    MODES.D,
    entry.target,
    false
  );
  const trade = createTrade(
    entry,
    direction,
    MODES.D,
    null
  );

  trade.legs = [
    { weight: 0.5, name: 'FIXED_2R', result: fixedLeg },
    { weight: 0.5, name: 'LIQUIDITY', result: liquidityLeg },
  ];

  if (fixedLeg.status === 'OPEN' || liquidityLeg.status === 'OPEN') {
    return trade;
  }

  trade.r = fixedLeg.r * 0.5 + liquidityLeg.r * 0.5;
  trade.status = statusFromR(trade.r, false);
  trade.exitIndex = Math.max(
    fixedLeg.exitIndex,
    liquidityLeg.exitIndex
  );
  trade.exitPrice = null;
  trade.exitReason = 'SPLIT_COMPLETE';
  return trade;
}

function simulateEntryMode(entry, klines, mode, regime) {
  const direction = getDirection(entry);

  if (mode === MODES.A) {
    return simulateSingleTarget(
      entry,
      klines,
      mode,
      entry.target,
      false
    );
  }
  if (mode === MODES.B) {
    return simulateSingleTarget(
      entry,
      klines,
      mode,
      priceAtR(entry, direction, 2),
      false
    );
  }
  if (mode === MODES.C) {
    return simulateSingleTarget(
      entry,
      klines,
      mode,
      entry.target,
      true
    );
  }
  if (mode === MODES.D) {
    return simulateSplitTarget(entry, klines);
  }
  if (mode === MODES.E) {
    const useRunner = regime === 'EXPANSION';
    const trade = simulateSingleTarget(
      entry,
      klines,
      mode,
      entry.target,
      useRunner
    );
    trade.regime = regime;
    trade.regimeExit = useRunner
      ? 'ONE_R_PROTECTION_RUNNER'
      : 'LIQUIDITY_TARGET';
    return trade;
  }

  throw new Error(`Unknown exit management mode: ${mode}`);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function calculateStats(trades) {
  const chronological = [...trades].sort((left, right) =>
    left.entryIndex - right.entryIndex
  );
  const completed = chronological.filter((trade) =>
    Number.isFinite(trade.r)
  );
  const rValues = completed.map((trade) => trade.r);
  const lossValues = rValues.filter((r) => r < 0);
  const totalR = rValues.reduce((sum, r) => sum + r, 0);
  const wins = rValues.filter((r) => r > 0).length;
  const losses = lossValues.length;
  const breakeven = rValues.filter((r) => r === 0).length;
  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let losingStreak = 0;
  let maxLosingStreak = 0;

  for (const r of rValues) {
    cumulativeR += r;
    peakR = Math.max(peakR, cumulativeR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - cumulativeR);
    if (r < 0) {
      losingStreak += 1;
      maxLosingStreak = Math.max(
        maxLosingStreak,
        losingStreak
      );
    } else {
      losingStreak = 0;
    }
  }

  const bigWinners = rValues.filter((r) => r >= 3);

  return {
    trades: chronological.length,
    completed: completed.length,
    open: chronological.length - completed.length,
    wins,
    losses,
    breakeven,
    winRate: completed.length > 0
      ? wins / completed.length
      : 0,
    totalR,
    averageR: completed.length > 0
      ? totalR / completed.length
      : 0,
    medianR: median(rValues),
    medianLossR: median(lossValues),
    maxDrawdownR,
    maxLosingStreak,
    maxWinnerR: rValues.length > 0
      ? Math.max(...rValues)
      : null,
    bigWinnerCount: bigWinners.length,
    bigWinnerTotalR: bigWinners.reduce(
      (sum, r) => sum + r,
      0
    ),
  };
}

function regimeKey(type, setupIndex, entryIndex) {
  const direction = type === 'LONG_ENTRY' || type === 'LONG'
    ? 'LONG'
    : 'SHORT';
  return `${direction}:${setupIndex}:${entryIndex}`;
}

function runModes(entries, klines, regimeSamples) {
  const triggered = entries.filter((entry) =>
    entry.status === 'ENTRY_TRIGGERED' &&
    Number.isInteger(entry.triggerIndex)
  );
  const regimeByTrade = new Map((regimeSamples || []).map(
    (sample) => [
      regimeKey(
        sample.direction,
        sample.setupIndex,
        sample.entryIndex
      ),
      sample.regime,
    ]
  ));
  const result = {};

  for (const mode of Object.keys(MODES)) {
    const trades = triggered.map((entry) => simulateEntryMode(
      entry,
      klines,
      MODES[mode],
      regimeByTrade.get(regimeKey(
        entry.type,
        entry.setupIndex,
        entry.triggerIndex
      )) || 'RANGING'
    ));
    result[mode] = {
      definition: MODES[mode],
      trades,
      stats: calculateStats(trades),
    };
  }

  return result;
}

function analyzeExitManagement({ setups, entries, klines, years = [] }) {
  const baseline = BacktestEngine.analyze({ entries, klines });
  const regime = MarketRegimeExperiment.analyzeMarketRegimes({
    setups,
    entries,
    trades: baseline.trades,
    klines,
    years,
  });

  return {
    definitions: {
      A: 'Current Liquidity Target with original Sweep Stop',
      B: 'Fixed 2R target with original Sweep Stop',
      C: 'Liquidity Target runner; after +1R is reached, move stop to Entry from the next bar',
      D: '50% at 2R and 50% at Liquidity Target; both legs retain the original Sweep Stop',
      E: 'Use C in EXPANSION; otherwise use A',
      conservativeExecution: 'Entry bar audits Stop only; later bars evaluate current Stop before profit targets; protection activated on a bar applies from the next bar',
    },
    baselineTrades: baseline.trades,
    regimes: regime.samples,
    modes: runModes(entries, klines, regime.samples),
  };
}

module.exports = {
  MODES,
  analyzeExitManagement,
  calculateStats,
  getDirection,
  getRisk,
  median,
  priceAtR,
  rAtPrice,
  runModes,
  simulateEntryMode,
  simulateSingleTarget,
  simulateSplitTarget,
};
