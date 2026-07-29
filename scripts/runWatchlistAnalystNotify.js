'use strict';

const WatchlistAnalyst = require('./runWatchlistAnalyst');
const WatchlistFilter = require(
  '../notifications/ictWatchlistNotificationFilter'
);
const DingTalk = require('./runAnalystReportNotify');
const BeijingTime = require('../formatters/beijingTime');

const CHANGE_REPORT_HEADER =
  '检测---ICT Watchlist 状态变化';

function changedAvailability(availability, changes) {
  return {
    validSymbols: changes.map((change) => change.symbol),
    invalidSymbols: (
      availability &&
      Array.isArray(availability.invalidSymbols)
        ? availability.invalidSymbols.slice()
        : []
    ),
    checkFailed: Boolean(
      availability && availability.checkFailed
    ),
    error: availability ? availability.error : null,
  };
}

function orderNotificationSymbols(
  watchlistSymbols,
  changedSymbols
) {
  const changed = new Set(changedSymbols);
  const ordered = [];

  for (const symbol of watchlistSymbols || []) {
    if (!changed.has(symbol)) continue;
    ordered.push(symbol);
    changed.delete(symbol);
  }
  for (const symbol of changedSymbols) {
    if (!changed.has(symbol)) continue;
    ordered.push(symbol);
    changed.delete(symbol);
  }
  return ordered;
}

function selectNotificationResults(
  changes,
  notificationSymbols
) {
  const resultBySymbol = new Map();
  for (const change of changes) {
    if (change && change.symbol) {
      resultBySymbol.set(change.symbol, change.result);
    }
  }

  return notificationSymbols.map((symbol) => {
    const result = resultBySymbol.get(symbol);
    if (result) return result;
    return {
      symbol,
      status: 'FAILED',
      displayMessage:
        '状态发生变化，但当前无可用分析报告',
    };
  });
}

function formatChangeNotification(
  results,
  currentTime,
  notificationSymbols
) {
  const sections = [
    CHANGE_REPORT_HEADER,
    '',
    '时间：' + BeijingTime.formatBeijingTime(currentTime),
    '',
    '发生变化：',
    ...notificationSymbols,
  ];

  for (const result of results) {
    sections.push(
      '',
      '===== ' + result.symbol + ' =====',
      '',
      result.status === 'SUCCESS' &&
        typeof result.formatted === 'string'
        ? result.formatted
        : result.displayMessage ||
          '状态发生变化，但当前无可用分析报告'
    );
  }
  return sections.join('\n');
}

function logRenderedNotificationSymbols(
  options,
  symbols
) {
  if (!WatchlistFilter.debugNotificationEnabled(options)) {
    return;
  }
  const logger = options.logger || console;
  if (!logger || typeof logger.log !== 'function') return;
  logger.log('');
  logger.log('Rendered Notification Symbols:');
  logger.log(JSON.stringify(symbols, null, 2));
}

async function run(options) {
  options = options || {};
  const watchlistRunner =
    options.watchlistRunner || WatchlistAnalyst;
  const analysis = await watchlistRunner.run({
    currentTime: options.currentTime,
    limit: options.limit,
    marketData: options.marketData,
    watchlistLoader: options.watchlistLoader,
    watchlistPath: options.watchlistPath,
    symbolAvailabilityChecker:
      options.symbolAvailabilityChecker,
    exchangeInfoApi: options.exchangeInfoApi,
    output() {},
  });
  const stateStore = options.stateStore ||
    WatchlistFilter.createFileStore(
      options.stateFilePath
    );
  const webhookUrl = options.webhookUrl ||
    process.env[DingTalk.WEBHOOK_ENV_NAME];
  let message = null;
  let payload = null;
  let notificationSymbols = [];
  let renderedNotificationSymbols = [];

  const notification =
    await WatchlistFilter.processNotifications({
      results: analysis.results,
      store: stateStore,
      debugNotification: options.debugNotification,
      logger: options.logger,
      async send(changes, decision) {
        notificationSymbols = orderNotificationSymbols(
          analysis.symbols,
          decision.notificationSymbols
        );
        const changedResults = selectNotificationResults(
          changes,
          notificationSymbols
        );
        renderedNotificationSymbols = changedResults.map(
          (result) => result.symbol
        );
        message = formatChangeNotification(
          changedResults,
          analysis.currentTime,
          renderedNotificationSymbols
        );
        logRenderedNotificationSymbols(
          options,
          renderedNotificationSymbols
        );
        payload = DingTalk.buildDingTalkPayload(message);
        return DingTalk.sendNotification({
          webhookUrl,
          payload,
          httpClient: options.httpClient,
        });
      },
    });

  return {
    ...analysis,
    watchlistMessage: analysis.message,
    notification,
    changedSymbols: notification.changedSymbols,
    notificationSymbols,
    renderedNotificationSymbols,
    sent: notification.sent,
    message: notification.sent ? message : null,
    payload: notification.sent ? payload : null,
    response: notification.response,
  };
}

if (require.main === module) {
  run().then((result) => {
    console.log(result.sent
      ? 'ICT Watchlist state changed; notification sent.'
      : 'ICT Watchlist state unchanged; notification skipped.'
    );
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CHANGE_REPORT_HEADER,
  changedAvailability,
  formatChangeNotification,
  logRenderedNotificationSymbols,
  orderNotificationSymbols,
  run,
  selectNotificationResults,
};
