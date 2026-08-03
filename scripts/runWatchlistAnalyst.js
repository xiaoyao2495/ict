'use strict';

const Binance = require('../api/binance');
const WatchlistLoader = require('../config/watchlistLoader');
const SymbolAvailabilityChecker = require(
  '../config/symbolAvailabilityChecker'
);
const AnalystReport = require(
  '../indicators/ictWatchlistAnalystReport'
);
const ProductionGateStateStore = require(
  '../state/ictProductionGateStateStore'
);
const ChineseFormatter = require(
  '../formatters/ictAnalystChineseFormatter'
);
const BeijingTime = require('../formatters/beijingTime');
const AnalystReportRunner = require('./runAnalystReport');

const REPORT_HEADER = '检测---ICT Watchlist';
const DEFAULT_LIMIT = AnalystReportRunner.DEFAULT_LIMIT;
const TIMEFRAMES = Object.freeze({
  h4Klines: { interval: '4h' },
  ltf5mKlines: { interval: '5m' },
});

function marketDataFetcher(marketData) {
  if (
    marketData &&
    typeof marketData.getKline === 'function'
  ) {
    return marketData.getKline.bind(marketData);
  }
  if (
    marketData &&
    typeof marketData.getKlines === 'function'
  ) {
    return marketData.getKlines.bind(marketData);
  }
  throw new Error(
    'A read-only getKline(symbol, interval) function is required.'
  );
}

async function getKline(symbol, interval, options) {
  options = options || {};
  const currentTime = Number.isFinite(options.currentTime)
    ? options.currentTime
    : Date.now();
  const limit = Number.isInteger(options.limit)
    ? options.limit
    : DEFAULT_LIMIT;
  const fetch = marketDataFetcher(
    options.marketData || Binance
  );
  const raw = await fetch(symbol, interval, limit);
  const closed = AnalystReportRunner.filterClosedKlines(
    raw,
    currentTime
  );

  if (closed.length === 0) {
    throw new Error(
      'No complete closed ' + interval +
      ' Klines are available for ' + symbol + '.'
    );
  }
  return closed;
}

async function getSymbolKlines(symbol, options) {
  options = options || {};
  const entries = Object.entries(TIMEFRAMES);
  const values = await Promise.all(entries.map(
    async ([key, timeframe]) => [
      key,
      await getKline(symbol, timeframe.interval, options),
    ]
  ));
  return Object.fromEntries(values);
}

async function analyzeSymbol(symbol, options) {
  let klines;
  try {
    klines = await getSymbolKlines(symbol, options);
  } catch (error) {
    return {
      symbol,
      status: 'FAILED',
      stage: 'DATA',
      displayMessage: '数据获取失败',
      error,
    };
  }

  try {
    const gateStateStore = options.gateStateStore ||
      ProductionGateStateStore;
    const analystReport = options.analystReport ||
      AnalystReport;
    const formatter = options.formatter ||
      ChineseFormatter;
    const previousGateState =
      await gateStateStore.load(symbol);
    const report = analystReport.analyze({
      symbol,
      h4Klines: klines.h4Klines,
      ltf5mKlines: klines.ltf5mKlines,
      previousGateState: previousGateState || null,
      retainSnapshots: false,
    });
    const formatted = formatter.format(report);
    await gateStateStore.save(
      symbol,
      report.current.decisionGate
    );
    return {
      symbol,
      status: 'SUCCESS',
      stage: 'COMPLETE',
      klines,
      report,
      formatted,
    };
  } catch (error) {
    return {
      symbol,
      status: 'FAILED',
      stage: 'ANALYSIS',
      displayMessage: '分析生成失败',
      error,
    };
  }
}

function formatWatchlistReport(
  results,
  currentTime,
  availability
) {
  const sections = [
    REPORT_HEADER,
    '',
    '时间：' + BeijingTime.formatBeijingTime(currentTime),
    '',
    '有效交易对：',
    ...availability.validSymbols,
    '',
    '跳过：',
    ...(
      availability.invalidSymbols.length > 0
        ? availability.invalidSymbols.map(
          (symbol) => (
            symbol + '（Binance不存在）'
          )
        )
        : ['无']
    ),
  ];
  if (availability.checkFailed) {
    sections.push(
      '',
      '交易对有效性检查失败，已保留原Watchlist继续分析'
    );
  }

  for (const result of results) {
    sections.push(
      '',
      '===== ' + result.symbol + ' =====',
      '',
      result.status === 'SUCCESS'
        ? result.formatted
        : result.displayMessage
    );
  }
  return sections.join('\n');
}

async function run(options) {
  options = options || {};
  const currentTime = Number.isFinite(options.currentTime)
    ? options.currentTime
    : Date.now();
  const loader = options.watchlistLoader ||
    WatchlistLoader;
  const watchlist = loader.loadWatchlist(
    options.watchlistPath
  );
  const availabilityChecker =
    options.symbolAvailabilityChecker ||
    SymbolAvailabilityChecker;
  const exchangeInfoApi = options.exchangeInfoApi ||
    (
      options.marketData &&
      typeof options.marketData.getExchangeInfo === 'function'
        ? options.marketData
        : Binance
    );
  const availability =
    await availabilityChecker.checkSymbols(
      watchlist.symbols,
      { binanceApi: exchangeInfoApi }
    );
  const analysisOptions = {
    currentTime,
    limit: options.limit,
    marketData: options.marketData || Binance,
    gateStateStore: options.gateStateStore,
    analystReport: options.analystReport,
    formatter: options.formatter,
  };
  const results = await Promise.all(
    availability.validSymbols.map(
      (symbol) => analyzeSymbol(symbol, analysisOptions)
    )
  );
  const message = formatWatchlistReport(
    results,
    currentTime,
    availability
  );
  const output = typeof options.output === 'function'
    ? options.output
    : console.log;
  output(message);

  return {
    currentTime,
    symbols: watchlist.symbols.slice(),
    availability,
    results,
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
  REPORT_HEADER,
  TIMEFRAMES,
  analyzeSymbol,
  formatWatchlistReport,
  getKline,
  getSymbolKlines,
  marketDataFetcher,
  run,
};
