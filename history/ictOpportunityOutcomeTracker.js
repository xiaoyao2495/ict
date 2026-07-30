'use strict';

const fs = require('fs/promises');
const path = require('path');
const OpportunityHistory = require(
  './ictOpportunityHistory'
);

const FIVE_MINUTES = 5 * 60 * 1000;
const DEFAULT_OUTCOME_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-opportunity-outcome.json'
);

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function emptyOutcomeState() {
  return {
    version: 1,
    outcomes: [],
  };
}

function isoTime(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function eventId(event) {
  return [
    event.symbol,
    event.confirmedAt,
    event.direction,
    event.liquidityType || '',
    Number.isFinite(event.liquidityPrice)
      ? event.liquidityPrice
      : '',
  ].join('|');
}

function extractConfirmedEvents(input) {
  const history = OpportunityHistory.normalizeHistory(input);
  const events = [];
  const identities = new Set();

  for (const [symbol, record] of Object.entries(
    history.symbols
  )) {
    for (const transition of record.transitions) {
      if (
        transition.status !== 'CONFIRMED' ||
        (
          transition.direction !== 'BULLISH' &&
          transition.direction !== 'BEARISH'
        )
      ) {
        continue;
      }
      const event = {
        symbol,
        h4Bias: transition.h4Bias,
        confirmedAt: transition.changedAt,
        direction: transition.direction,
        liquidityType: transition.liquidityType,
        liquidityPrice: transition.liquidityPrice,
      };
      event.id = eventId(event);
      if (identities.has(event.id)) continue;
      identities.add(event.id);
      events.push(event);
    }
  }

  return events.sort((left, right) => (
    Date.parse(left.confirmedAt) -
      Date.parse(right.confirmedAt) ||
    left.symbol.localeCompare(right.symbol)
  ));
}

function normalizeKlines(klines) {
  return (Array.isArray(klines) ? klines : [])
    .map((kline) => ({
      openTime: new Date(kline.openTime).getTime(),
      closeTime: new Date(kline.closeTime).getTime(),
      high: Number(kline.high),
      low: Number(kline.low),
      close: Number(kline.close),
    }))
    .filter((kline) => (
      Number.isFinite(kline.openTime) &&
      Number.isFinite(kline.closeTime) &&
      Number.isFinite(kline.high) &&
      Number.isFinite(kline.low) &&
      Number.isFinite(kline.close)
    ))
    .sort((left, right) => (
      left.closeTime - right.closeTime
    ));
}

function findReferenceBar(klines, confirmedAt) {
  const confirmedTime = Date.parse(confirmedAt);
  if (!Number.isFinite(confirmedTime)) return null;

  return klines.find((kline) => (
    kline.closeTime >= confirmedTime &&
    (
      kline.openTime <= confirmedTime ||
      kline.openTime - confirmedTime <= FIVE_MINUTES
    )
  )) || null;
}

function riskUnitFor(event, entryNearbyPrice) {
  if (
    !Number.isFinite(entryNearbyPrice) ||
    !Number.isFinite(event.liquidityPrice)
  ) {
    return null;
  }
  const riskUnit = event.direction === 'BULLISH'
    ? entryNearbyPrice - event.liquidityPrice
    : event.liquidityPrice - entryNearbyPrice;
  return riskUnit > 0 ? riskUnit : null;
}

function targetPrice(direction, entryPrice, riskUnit, r) {
  return direction === 'BULLISH'
    ? entryPrice + riskUnit * r
    : entryPrice - riskUnit * r;
}

function failurePrice(direction, entryPrice, riskUnit) {
  return direction === 'BULLISH'
    ? entryPrice - riskUnit
    : entryPrice + riskUnit;
}

function baseOutcome(event) {
  return {
    id: event.id,
    symbol: event.symbol,
    h4Bias: event.h4Bias,
    confirmedAt: event.confirmedAt,
    direction: event.direction,
    liquidityType: event.liquidityType,
    liquidityPrice: event.liquidityPrice,
    entryNearbyPrice: null,
    riskUnit: null,
    oneRAt: null,
    twoRAt: null,
    threeRAt: null,
    failed: false,
    failedAt: null,
    trackingStatus: 'AWAITING_REFERENCE_PRICE',
    lastEvaluatedAt: null,
  };
}

function touchesFailure(outcome, kline) {
  const price = failurePrice(
    outcome.direction,
    outcome.entryNearbyPrice,
    outcome.riskUnit
  );
  return outcome.direction === 'BULLISH'
    ? kline.low <= price
    : kline.high >= price;
}

function touchesTarget(outcome, kline, r) {
  const price = targetPrice(
    outcome.direction,
    outcome.entryNearbyPrice,
    outcome.riskUnit,
    r
  );
  return outcome.direction === 'BULLISH'
    ? kline.high >= price
    : kline.low <= price;
}

function evaluate(event, rawKlines, previous) {
  const klines = normalizeKlines(rawKlines);
  const outcome = previous
    ? { ...previous }
    : baseOutcome(event);

  if (
    outcome.failed ||
    outcome.threeRAt
  ) {
    return outcome;
  }

  if (
    !Number.isFinite(outcome.entryNearbyPrice) ||
    !Number.isFinite(outcome.riskUnit)
  ) {
    const referenceBar = findReferenceBar(
      klines,
      event.confirmedAt
    );
    if (!referenceBar) return outcome;

    const riskUnit = riskUnitFor(
      event,
      referenceBar.close
    );
    outcome.entryNearbyPrice = referenceBar.close;
    outcome.riskUnit = riskUnit;
    outcome.lastEvaluatedAt =
      isoTime(referenceBar.closeTime);
    if (!Number.isFinite(riskUnit)) {
      outcome.trackingStatus =
        'INVALID_RISK_REFERENCE';
      return outcome;
    }
    outcome.trackingStatus = 'TRACKING';
  }

  let lastEvaluatedTime = outcome.lastEvaluatedAt
    ? Date.parse(outcome.lastEvaluatedAt)
    : Date.parse(outcome.confirmedAt);

  for (const kline of klines) {
    if (kline.closeTime <= lastEvaluatedTime) continue;
    const time = isoTime(kline.closeTime);

    if (touchesFailure(outcome, kline)) {
      outcome.failed = true;
      outcome.failedAt = time;
      outcome.trackingStatus = 'FAILED';
      outcome.lastEvaluatedAt = time;
      break;
    }
    if (!outcome.oneRAt && touchesTarget(
      outcome,
      kline,
      1
    )) {
      outcome.oneRAt = time;
    }
    if (!outcome.twoRAt && touchesTarget(
      outcome,
      kline,
      2
    )) {
      outcome.twoRAt = time;
    }
    if (!outcome.threeRAt && touchesTarget(
      outcome,
      kline,
      3
    )) {
      outcome.threeRAt = time;
      outcome.trackingStatus = 'COMPLETED';
      outcome.lastEvaluatedAt = time;
      break;
    }
    outcome.lastEvaluatedAt = time;
    lastEvaluatedTime = kline.closeTime;
  }
  return outcome;
}

function normalizeOutcomeState(input) {
  const outcomes = input &&
    Array.isArray(input.outcomes)
    ? input.outcomes
      .filter((outcome) => outcome && outcome.id)
      .map((outcome) => ({ ...outcome }))
    : [];
  return {
    version: 1,
    outcomes,
  };
}

async function loadSymbolKlines(symbols, options) {
  const result = {};
  for (const symbol of symbols) {
    if (
      options.klinesBySymbol &&
      Array.isArray(options.klinesBySymbol[symbol])
    ) {
      result[symbol] =
        options.klinesBySymbol[symbol];
      continue;
    }
    if (typeof options.getKlines === 'function') {
      result[symbol] = await options.getKlines(
        symbol,
        '5m'
      );
      continue;
    }
    result[symbol] = [];
  }
  return result;
}

async function track(options) {
  options = options || {};
  const events = extractConfirmedEvents(options.history);
  const store = options.store ||
    createFileStore(options.outcomeFilePath);
  const previousState = normalizeOutcomeState(
    await store.load()
  );
  const outcomeById = new Map(
    previousState.outcomes.map(
      (outcome) => [outcome.id, outcome]
    )
  );
  const symbols = Array.from(new Set(
    events.map((event) => event.symbol)
  ));
  const klinesBySymbol = await loadSymbolKlines(
    symbols,
    options
  );
  const changes = [];

  for (const event of events) {
    const previous = outcomeById.get(event.id) || null;
    const current = evaluate(
      event,
      klinesBySymbol[event.symbol],
      previous
    );
    outcomeById.set(event.id, current);
    if (
      JSON.stringify(previous) !==
      JSON.stringify(current)
    ) {
      changes.push({
        id: event.id,
        symbol: event.symbol,
        previous,
        current,
      });
    }
  }

  const state = {
    version: 1,
    outcomes: Array.from(outcomeById.values())
      .sort((left, right) => (
        Date.parse(left.confirmedAt) -
          Date.parse(right.confirmedAt) ||
        left.symbol.localeCompare(right.symbol)
      )),
  };
  if (changes.length > 0) {
    await store.save(state);
  }
  return {
    changed: changes.length > 0,
    changes,
    state,
  };
}

function createMemoryStore(initialState) {
  let value = initialState
    ? clone(initialState)
    : null;
  return {
    async load() {
      return clone(value);
    },
    async save(nextState) {
      value = clone(nextState);
    },
  };
}

function createFileStore(filePath) {
  const resolvedPath = path.resolve(
    filePath || DEFAULT_OUTCOME_PATH
  );
  return {
    filePath: resolvedPath,
    async load() {
      try {
        const content = await fs.readFile(
          resolvedPath,
          'utf8'
        );
        return JSON.parse(content);
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(nextState) {
      await fs.mkdir(path.dirname(resolvedPath), {
        recursive: true,
      });
      await fs.writeFile(
        resolvedPath,
        JSON.stringify(nextState, null, 2) + '\n',
        'utf8'
      );
    },
  };
}

module.exports = {
  DEFAULT_OUTCOME_PATH,
  FIVE_MINUTES,
  baseOutcome,
  createFileStore,
  createMemoryStore,
  emptyOutcomeState,
  evaluate,
  eventId,
  extractConfirmedEvents,
  failurePrice,
  findReferenceBar,
  normalizeKlines,
  normalizeOutcomeState,
  riskUnitFor,
  targetPrice,
  track,
};
