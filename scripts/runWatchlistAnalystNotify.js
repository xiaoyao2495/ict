'use strict';

const WatchlistAnalyst = require('./runWatchlistAnalyst');
const WatchlistFilter = require(
  '../notifications/ictWatchlistNotificationFilter'
);
const DingTalk = require('./runAnalystReportNotify');

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

  const notification =
    await WatchlistFilter.processNotifications({
      results: analysis.results,
      store: stateStore,
      async send(changes) {
        const changedResults = changes.map(
          (change) => change.result
        );
        message = WatchlistAnalyst.formatWatchlistReport(
          changedResults,
          analysis.currentTime,
          changedAvailability(
            analysis.availability,
            changes
          )
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
  changedAvailability,
  run,
};
