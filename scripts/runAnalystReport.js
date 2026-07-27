'use strict';

const Binance = require('../api/binance');
const AnalystReport = require(
  '../indicators/ictHtfAnalystReport'
);
const ChineseFormatter = require(
  '../formatters/ictAnalystChineseFormatter'
);

const SYMBOL = 'BTCUSDT';
const DEFAULT_LIMIT = 1000;
const TIMEFRAMES = Object.freeze({
  h4Klines: Object.freeze({
    interval: '4h',
    label: '4H',
  }),
  h1Klines: Object.freeze({
    interval: '1h',
    label: '1H',
  }),
  ltf5mKlines: Object.freeze({
    interval: '5m',
    label: '5m',
  }),
});

function isFiniteKline(kline) {
  return (
    kline &&
    Number.isFinite(kline.openTime) &&
    Number.isFinite(kline.closeTime) &&
    Number.isFinite(kline.open) &&
    Number.isFinite(kline.high) &&
    Number.isFinite(kline.low) &&
    Number.isFinite(kline.close)
  );
}

function filterClosedKlines(klines, currentTime) {
  if (!Array.isArray(klines)) return [];
  return klines.filter((kline) => (
    isFiniteKline(kline) &&
    kline.closeTime < currentTime
  ));
}

async function fetchClosedTimeframes(options) {
  options = options || {};
  const marketData = options.marketData || Binance;
  const currentTime = Number.isFinite(options.currentTime)
    ? options.currentTime
    : Date.now();
  const limit = Number.isInteger(options.limit)
    ? options.limit
    : DEFAULT_LIMIT;

  if (
    !marketData ||
    typeof marketData.getKlines !== 'function'
  ) {
    throw new Error(
      'A read-only market data getKlines function is required.'
    );
  }

  const entries = Object.entries(TIMEFRAMES);
  const values = await Promise.all(entries.map(
    async ([key, timeframe]) => {
      const raw = await marketData.getKlines(
        SYMBOL,
        timeframe.interval,
        limit
      );
      const closed = filterClosedKlines(raw, currentTime);
      if (closed.length === 0) {
        throw new Error(
          'No complete closed ' + timeframe.label +
          ' Klines are available for ' + SYMBOL + '.'
        );
      }
      return [key, closed];
    }
  ));

  return Object.fromEntries(values);
}

async function run(options) {
  options = options || {};
  const currentTime = Number.isFinite(options.currentTime)
    ? options.currentTime
    : Date.now();
  const klines = await fetchClosedTimeframes({
    marketData: options.marketData || Binance,
    currentTime,
    limit: options.limit,
  });
  const report = AnalystReport.analyze({
    symbol: SYMBOL,
    h4Klines: klines.h4Klines,
    h1Klines: klines.h1Klines,
    ltf5mKlines: klines.ltf5mKlines,
    retainSnapshots: false,
  });
  const message = ChineseFormatter.format(report);
  const output = typeof options.output === 'function'
    ? options.output
    : console.log;

  output(message);

  return {
    symbol: SYMBOL,
    currentTime,
    klines,
    report,
    message,
  };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_LIMIT,
  SYMBOL,
  TIMEFRAMES,
  fetchClosedTimeframes,
  filterClosedKlines,
  isFiniteKline,
  run,
};
