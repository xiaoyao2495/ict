'use strict';

const AnalystReportNotify = require(
  './runAnalystReportNotify'
);

const INTERVAL_MINUTES = 15;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

function createScheduler(options) {
  options = options || {};
  const runNotification = options.runNotification ||
    AnalystReportNotify.run;
  const notificationOptions =
    options.notificationOptions || {};
  const setIntervalFn =
    options.setIntervalFn || setInterval;
  const clearIntervalFn =
    options.clearIntervalFn || clearInterval;
  const logger = options.logger || console;
  const runImmediately = options.runImmediately !== false;
  let timer = null;
  let inFlight = null;

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
        'ICT Analyst Report scheduler skipped overlapping ' +
        (trigger || 'scheduled') + ' run.'
      );
      return {
        sent: false,
        skipped: true,
        reason: 'RUN_IN_PROGRESS',
      };
    }

    inFlight = Promise.resolve()
      .then(() => runNotification(notificationOptions))
      .then((result) => {
        log(result && result.sent
          ? 'ICT Analyst Report state changed; notification sent.'
          : 'ICT Analyst Report state unchanged; notification skipped.'
        );
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
    if (runImmediately) {
      void execute('startup');
    }
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
  const scheduler = createScheduler();
  scheduler.start();
  console.log(
    'ICT Analyst Report scheduler started: every ' +
    INTERVAL_MINUTES + ' minutes.'
  );

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Stopping scheduler after ' + signal + '.');
    await scheduler.stop();
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
  createScheduler,
};
