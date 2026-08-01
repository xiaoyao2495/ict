'use strict';

const WatchlistNotify = require(
  './runWatchlistAnalystNotify'
);
const TopVolumeWatchlist = require(
  '../indicators/binanceFuturesTopVolumeWatchlist'
);

const INTERVAL_MINUTES = 5;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

function createDaemon(options) {
  options = options || {};
  const runNotification =
    options.runNotification || WatchlistNotify.run;
  const notificationOptions =
    options.notificationOptions || {};
  const watchlistProvider =
    options.watchlistProvider === false
      ? null
      : options.watchlistProvider || (
        runNotification === WatchlistNotify.run
          ? TopVolumeWatchlist
          : null
      );
  const watchlistProviderOptions =
    options.watchlistProviderOptions || {};
  const setIntervalFn =
    options.setIntervalFn || setInterval;
  const clearIntervalFn =
    options.clearIntervalFn || clearInterval;
  const logger = options.logger || console;
  let timer = null;
  let inFlight = null;
  let lastUniverseUpdatedAt = null;

  function invokeWatchlistProvider() {
    if (!watchlistProvider) return Promise.resolve(null);
    if (typeof watchlistProvider === 'function') {
      return Promise.resolve(
        watchlistProvider(watchlistProviderOptions)
      );
    }
    if (typeof watchlistProvider.load === 'function') {
      return Promise.resolve(
        watchlistProvider.load(watchlistProviderOptions)
      );
    }
    return Promise.reject(new Error(
      'Dynamic Watchlist provider does not expose load().'
    ));
  }

  function dynamicNotificationOptions(universe) {
    if (!universe) return notificationOptions;
    const resolved = { ...notificationOptions };
    const universeUpdated =
      lastUniverseUpdatedAt !== universe.updatedAt;
    lastUniverseUpdatedAt = universe.updatedAt;
    resolved.watchlistLoader = {
      loadWatchlist() {
        return { symbols: universe.symbols.slice() };
      },
    };
    resolved.symbolAvailabilityChecker = {
      async checkSymbols(symbols) {
        return {
          validSymbols: symbols.slice(),
          invalidSymbols: [],
          checkFailed: false,
          error: null,
        };
      },
    };
    resolved.watchlistUniverse = universe;
    resolved.watchlistUniverseUpdated = universeUpdated;
    if (!resolved.logger) resolved.logger = logger;
    return resolved;
  }

  function log(message) {
    if (logger && typeof logger.log === 'function') {
      logger.log(message);
    }
  }

  function logError(error) {
    if (logger && typeof logger.error === 'function') {
      logger.error(error.stack || error.message || error);
    }
  }

  async function execute(trigger) {
    if (inFlight) {
      log(
        'ICT Watchlist daemon skipped overlapping ' +
        (trigger || 'scheduled') + ' run.'
      );
      return {
        sent: false,
        skipped: true,
        reason: 'RUN_IN_PROGRESS',
      };
    }

    inFlight = invokeWatchlistProvider()
      .then((universe) => runNotification(
        dynamicNotificationOptions(universe)
      ))
      .then((result) => {
        if (runNotification === WatchlistNotify.run) {
          WatchlistNotify.writeRunLog(result, {
            logger,
            logLevel: notificationOptions.logLevel,
            debugNotification:
              notificationOptions.debugNotification,
          });
        } else {
          log(result && result.sent
            ? 'ICT Watchlist state changed; notification sent.'
            : 'ICT Watchlist state unchanged; notification skipped.'
          );
        }
        return result;
      })
      .catch((error) => {
        logError(error);
        return {
          sent: false,
          skipped: false,
          error,
        };
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  function start() {
    if (timer !== null) return false;
    timer = setIntervalFn(() => {
      void execute('scheduled');
    }, INTERVAL_MS);
    void execute('startup');
    return true;
  }

  async function stop() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    if (inFlight) await inFlight;
  }

  function isRunning() {
    return timer !== null;
  }

  function waitForIdle() {
    return inFlight || Promise.resolve(null);
  }

  return {
    execute,
    isRunning,
    start,
    stop,
    waitForIdle,
  };
}

if (require.main === module) {
  const daemon = createDaemon();
  daemon.start();
  console.log(
    'ICT Watchlist daemon started: every ' +
    INTERVAL_MINUTES + ' minutes.'
  );

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(
      'Stopping ICT Watchlist daemon after ' + signal + '.'
    );
    await daemon.stop();
    process.exitCode = 0;
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

module.exports = {
  INTERVAL_MINUTES,
  INTERVAL_MS,
  createDaemon,
};
