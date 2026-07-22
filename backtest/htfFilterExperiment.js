'use strict';

const FILTERS = Object.freeze({
  A: Object.freeze({ name: '4H trend filter' }),
  B: Object.freeze({ name: '1H structure filter' }),
  C: Object.freeze({ name: 'PDH/PDL location filter' }),
  D: Object.freeze({ name: '4H + 1H + PDH/PDL combination' }),
});

function normalizeDirection(value) {
  const normalized = String(value || '').toUpperCase();

  if (
    normalized === 'LONG' ||
    normalized === 'BULLISH' ||
    normalized === 'LONG_SETUP' ||
    normalized === 'LONG_ENTRY'
  ) {
    return 'LONG';
  }

  if (
    normalized === 'SHORT' ||
    normalized === 'BEARISH' ||
    normalized === 'SHORT_SETUP' ||
    normalized === 'SHORT_ENTRY'
  ) {
    return 'SHORT';
  }

  return normalized;
}

function setupKey(direction, setupIndex) {
  return `${normalizeDirection(direction)}:${setupIndex}`;
}

function matchesFourHourTrend(sample) {
  return sample.direction === 'LONG'
    ? sample.h4Trend === 'BULLISH'
    : sample.direction === 'SHORT' && sample.h4Trend === 'BEARISH';
}

function matchesOneHourStructure(sample) {
  if (sample.direction === 'LONG') {
    return sample.h1Structure === 'BULLISH_BOS' || sample.h1Structure === 'BULLISH_MSS';
  }

  return sample.direction === 'SHORT'
    && (sample.h1Structure === 'BEARISH_BOS' || sample.h1Structure === 'BEARISH_MSS');
}

function matchesPreviousDayLocation(sample) {
  return sample.direction === 'LONG'
    ? sample.pdLocation === 'BELOW_PDL'
    : sample.direction === 'SHORT' && sample.pdLocation === 'ABOVE_PDH';
}

function tradeR(trade) {
  const value = Number(trade && trade.r);
  return Number.isFinite(value) ? value : null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarize(samples) {
  const chronological = [...samples].sort((a, b) => {
    if (a.entryIndex !== b.entryIndex) return a.entryIndex - b.entryIndex;
    return a.setupIndex - b.setupIndex;
  });
  const closed = chronological.filter((sample) => sample.status === 'WIN' || sample.status === 'LOSS');
  const rValues = closed.map((sample) => sample.r).filter(Number.isFinite);
  const wins = closed.filter((sample) => sample.status === 'WIN').length;
  const losses = closed.filter((sample) => sample.status === 'LOSS').length;
  let currentLosses = 0;
  let maxConsecutiveLosses = 0;

  for (const sample of closed) {
    if (sample.status === 'LOSS') {
      currentLosses += 1;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
    } else {
      currentLosses = 0;
    }
  }

  const totalR = rValues.reduce((sum, value) => sum + value, 0);

  return {
    trades: chronological.length,
    wins,
    losses,
    open: chronological.length - closed.length,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    totalR,
    averageR: rValues.length > 0 ? totalR / rValues.length : 0,
    medianR: median(rValues),
    maxConsecutiveLosses,
  };
}

function buildSamples({ setups = [], entries = [], trades = [], klines = [] }) {
  const setupByKey = new Map();
  for (const setup of setups) {
    setupByKey.set(setupKey(setup.direction || setup.type, setup.triggerIndex), setup);
  }

  const entryByKey = new Map();
  for (const entry of entries) {
    if (entry.status !== 'ENTRY_TRIGGERED') continue;
    entryByKey.set(setupKey(entry.type || entry.direction, entry.setupIndex), entry);
  }

  return trades.map((trade) => {
    const key = setupKey(trade.type || trade.direction, trade.setupIndex);
    const setup = setupByKey.get(key);
    const entry = entryByKey.get(key);

    if (!setup) {
      throw new Error(`HTF filter experiment cannot find setup for trade ${key}`);
    }
    if (!entry) {
      throw new Error(`HTF filter experiment cannot find entry for trade ${key}`);
    }

    const availableIndex = Number.isInteger(setup.availableIndex)
      ? setup.availableIndex
      : setup.triggerIndex;
    const kline = klines[availableIndex] || klines[setup.triggerIndex];
    const time = kline && Number(kline.openTime);
    const context = setup.htfContext || {};

    return {
      direction: normalizeDirection(trade.type || trade.direction),
      setupIndex: trade.setupIndex,
      availableIndex,
      entryIndex: Number.isInteger(entry.entryIndex) ? entry.entryIndex : trade.entryIndex,
      year: Number.isFinite(time) ? new Date(time).getUTCFullYear() : null,
      h4Trend: context.h4 && context.h4.trend,
      h1Structure: context.h1 && context.h1.structure,
      pdLocation: context.previousDay && context.previousDay.location,
      status: String(trade.status || '').toUpperCase(),
      r: tradeR(trade),
    };
  });
}

function selectSamples(samples) {
  return {
    BASELINE: samples,
    A: samples.filter(matchesFourHourTrend),
    B: samples.filter(matchesOneHourStructure),
    C: samples.filter(matchesPreviousDayLocation),
    D: samples.filter((sample) => matchesFourHourTrend(sample)
      && matchesOneHourStructure(sample)
      && matchesPreviousDayLocation(sample)),
  };
}

function yearlySummaries(selected, years) {
  const result = {};
  for (const [key, samples] of Object.entries(selected)) {
    result[key] = years.map((year) => ({
      year,
      ...summarize(samples.filter((sample) => sample.year === year)),
    }));
  }
  return result;
}

function stabilitySummary(yearly) {
  const baselineByYear = new Map(yearly.BASELINE.map((row) => [row.year, row]));
  const result = {};

  for (const key of Object.keys(FILTERS)) {
    const active = yearly[key].filter((row) => row.trades > 0);
    result[key] = {
      activeYears: active.length,
      profitableYears: active.filter((row) => row.totalR > 0).length,
      yearsBeatingBaselineAverageR: active.filter((row) => {
        const baseline = baselineByYear.get(row.year);
        return baseline && row.averageR > baseline.averageR;
      }).length,
      yearsBeatingBaselineTotalR: active.filter((row) => {
        const baseline = baselineByYear.get(row.year);
        return baseline && row.totalR > baseline.totalR;
      }).length,
      worstYearAverageR: active.length > 0
        ? Math.min(...active.map((row) => row.averageR))
        : null,
    };
  }

  return result;
}

function analyzeHtfFilters({ setups, entries, trades, klines, years = [] }) {
  const samples = buildSamples({ setups, entries, trades, klines });
  const selected = selectSamples(samples);
  const normalizedYears = years.length > 0
    ? [...years]
    : [...new Set(samples.map((sample) => sample.year).filter(Number.isInteger))].sort();
  const yearly = yearlySummaries(selected, normalizedYears);

  return {
    definitions: {
      A: 'LONG requires 4H BULLISH; SHORT requires 4H BEARISH',
      B: 'LONG requires 1H BULLISH BOS/MSS; SHORT requires 1H BEARISH BOS/MSS',
      C: 'LONG requires setup below PDL; SHORT requires setup above PDH',
      D: 'A, B, and C must all pass',
    },
    overall: Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, summarize(value)])),
    yearly,
    stability: stabilitySummary(yearly),
    samples,
  };
}

module.exports = {
  FILTERS,
  analyzeHtfFilters,
  buildSamples,
  matchesFourHourTrend,
  matchesOneHourStructure,
  matchesPreviousDayLocation,
  median,
  selectSamples,
  summarize,
};
