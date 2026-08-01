'use strict';

const WatchlistAnalyst = require('./runWatchlistAnalyst');
const WatchlistFilter = require(
  '../notifications/ictWatchlistNotificationFilter'
);
const DingTalk = require('./runAnalystReportNotify');
const BeijingTime = require('../formatters/beijingTime');
const ChineseFormatter = require(
  '../formatters/ictAnalystChineseFormatter'
);
const OpportunityHistory = require(
  '../history/ictOpportunityHistory'
);

const CHANGE_REPORT_HEADER =
  '检测---ICT Watchlist 状态变化';
const LOG_LEVELS = Object.freeze({
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
});
const DEFAULT_LOG_LEVEL = LOG_LEVELS.PRODUCTION;

function normalizeLogLevel(options) {
  options = options || {};
  const configured = options.logLevel || process.env.LOG_LEVEL;
  if (
    typeof configured === 'string' &&
    configured.toLowerCase() === LOG_LEVELS.DEVELOPMENT
  ) {
    return LOG_LEVELS.DEVELOPMENT;
  }
  if (
    typeof configured === 'string' &&
    configured.toLowerCase() === LOG_LEVELS.PRODUCTION
  ) {
    return LOG_LEVELS.PRODUCTION;
  }
  if (WatchlistFilter.debugNotificationEnabled(options)) {
    return LOG_LEVELS.DEVELOPMENT;
  }
  return DEFAULT_LOG_LEVEL;
}

function resultCurrent(result) {
  const report = result && result.report
    ? result.report
    : result;
  return report && report.current ? report.current : report;
}

function changeBySymbol(notification) {
  const changes = notification &&
    Array.isArray(notification.changes)
    ? notification.changes
    : [];
  return new Map(changes.map((change) => [
    change.symbol,
    change,
  ]));
}

function progressLabels(change) {
  const progress = change && change.decisionGateProgress;
  const labels = {
    sweepCompleted: 'Sweep completed',
    mssCompleted: 'MSS completed',
    displacementCompleted: 'Displacement completed',
    strictConfirmationCompleted:
      'Strict confirmation completed',
  };
  return progress && Array.isArray(progress.completedFields)
    ? progress.completedFields.map((field) => (
      labels[field] || field
    ))
    : [];
}

function productionSymbolLines(
  result,
  change,
  sentSymbols
) {
  const symbol = result && result.symbol
    ? result.symbol
    : change && change.symbol
      ? change.symbol
      : 'UNKNOWN';
  const lines = [symbol, ''];
  if (!result || result.status === 'FAILED') {
    lines.push(
      'Error:',
      result && (result.error || result.displayMessage)
        ? String(result.error || result.displayMessage)
        : 'Analysis unavailable',
      '',
      'Notification:',
      'SKIPPED'
    );
    return lines;
  }
  if (!change) {
    lines.push('No state change', 'Skip notification');
    return lines;
  }

  const current = resultCurrent(result) || {};
  const state = change.currentState || {};
  const gate = state.decisionGate || current.decisionGate || {};
  const transition = change.decisionGateTransition;
  const progress = progressLabels(change);
  const opportunity = gate.activeOpportunity || null;
  const identity = state.opportunityIdentity || null;

  if (transition) {
    lines.push(
      'Decision Gate:',
      String(transition.from || 'NONE') + ' → ' +
        String(transition.to || gate.state || 'UNKNOWN'),
      ''
    );
  } else if (progress.length > 0) {
    lines.push(
      'Decision Gate:',
      String(gate.state || 'UNKNOWN'),
      '',
      'Progress:'
    );
    progress.forEach((label) => lines.push('✓ ' + label));
    lines.push('');
  } else {
    lines.push(
      'State Change:',
      change.reasons && change.reasons.length
        ? change.reasons.join(', ')
        : 'INITIAL_STATE',
      ''
    );
  }

  lines.push(
    'Direction:',
    String(gate.direction || 'UNDETERMINED')
  );

  if (opportunity || identity) {
    lines.push('', 'Opportunity:');
    if (identity && identity.zoneId) {
      lines.push('Zone: ' + identity.zoneId);
    }
    lines.push(
      'Direction: ' + String(
        opportunity && opportunity.direction ||
        identity && identity.direction ||
        'UNDETERMINED'
      ),
      'Type: ' + String(
        opportunity && opportunity.liquidityType ||
        identity && identity.liquidityType ||
        'UNAVAILABLE'
      ),
      'Anchor: ' + String(
        identity && Number.isFinite(identity.anchorPrice)
          ? identity.anchorPrice
          : opportunity && Number.isFinite(opportunity.price)
            ? opportunity.price
            : 'UNAVAILABLE'
      )
    );
  }

  lines.push(
    '',
    'Notification:',
    sentSymbols.has(symbol) ? 'SENT' : 'SKIPPED'
  );
  return lines;
}

function formatProductionLog(result) {
  result = result || {};
  const symbols = Array.isArray(result.symbols)
    ? result.symbols.slice()
    : Array.isArray(result.results)
      ? result.results.map((item) => item.symbol)
      : [];
  const results = Array.isArray(result.results)
    ? result.results
    : [];
  const resultMap = new Map(results.map((item) => [
    item.symbol,
    item,
  ]));
  const changes = changeBySymbol(result.notification);
  const sentSymbols = new Set(
    Array.isArray(result.notificationSymbols)
      ? result.notificationSymbols
      : []
  );
  const lines = [
    '================================',
    'ICT Watchlist',
    BeijingTime.formatBeijingTime(
      result.currentTime || Date.now()
    ).replace(/^北京时间\s*/, ''),
    '================================',
    '',
  ];

  if (
    result.watchlistUniverseUpdated &&
    result.watchlistUniverse &&
    Array.isArray(result.watchlistUniverse.symbols)
  ) {
    lines.push(
      'Universe updated',
      '',
      'Binance Futures Top Volume Watchlist'
    );
    const ranking = Array.isArray(
      result.watchlistUniverse.ranking
    )
      ? result.watchlistUniverse.ranking
      : [];
    result.watchlistUniverse.symbols.forEach((symbol, index) => {
      const ranked = ranking.find(
        (item) => item && item.symbol === symbol
      );
      lines.push(
        String(index + 1) + ' ' + symbol +
        (ranked
          ? '  ' + ranked.quoteVolume + ' USDT'
          : '')
      );
    });
    lines.push('');
  }

  symbols.forEach((symbol, index) => {
    lines.push(...productionSymbolLines(
      resultMap.get(symbol),
      changes.get(symbol),
      sentSymbols
    ));
    if (index < symbols.length - 1) {
      lines.push('', '--------------------------------', '');
    }
  });

  const changedCount = changes.size;
  lines.push(
    '',
    '================================',
    'Summary',
    '',
    'Symbols checked:',
    String(symbols.length),
    '',
    'State changed:',
    String(changedCount),
    '',
    'Notifications:',
    result.sent ? '1' : '0',
    '',
    'Skipped:',
    String(Math.max(0, symbols.length - changedCount)),
    '================================'
  );
  return lines.join('\n');
}

function writeRunLog(result, options) {
  options = options || {};
  const logger = options.logger || console;
  const level = normalizeLogLevel({
    logLevel: options.logLevel || result && result.logLevel,
    debugNotification: options.debugNotification,
  });
  if (!logger || typeof logger.log !== 'function') return null;
  if (level === LOG_LEVELS.DEVELOPMENT) {
    const status = result && result.sent
      ? 'ICT Watchlist state changed; notification sent.'
      : 'ICT Watchlist state unchanged; notification skipped.';
    logger.log(status);
    return status;
  }
  const output = formatProductionLog(result);
  logger.log(output);
  return output;
}

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
  notificationSymbols,
  changes
) {
  const changeBySymbol = new Map(
    (changes || []).map((change) => [
      change.symbol,
      change,
    ])
  );
  const sections = [
    CHANGE_REPORT_HEADER,
    '',
    '时间：' + BeijingTime.formatBeijingTime(currentTime),
    '',
    '发生变化：',
    ...notificationSymbols,
  ];

  for (const result of results) {
    const change = changeBySymbol.get(result.symbol);
    const content = result.status === 'SUCCESS' &&
      result.report
      ? ChineseFormatter.formatNotificationChange(
        result.report,
        change ? change.reasons : [],
        change
      )
      : result.status === 'SUCCESS' &&
          typeof result.formatted === 'string'
        ? result.formatted
        : result.displayMessage ||
          '状态发生变化，但当前无可用分析报告';
    sections.push(
      '',
      '===== ' + result.symbol + ' =====',
      '',
      content
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
  const logLevel = normalizeLogLevel(options);
  const debugNotification =
    logLevel === LOG_LEVELS.DEVELOPMENT;
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
  const opportunityHistory =
    await OpportunityHistory.recordResults({
      results: analysis.results,
      store: options.opportunityHistoryStore,
      historyFilePath: options.opportunityHistoryPath,
      recordedAt: analysis.currentTime,
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
      debugNotification,
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
          renderedNotificationSymbols,
          changes
        );
        logRenderedNotificationSymbols(
          {
            ...options,
            debugNotification,
          },
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

  const result = {
    ...analysis,
    logLevel,
    watchlistUniverse: options.watchlistUniverse || null,
    watchlistUniverseUpdated:
      options.watchlistUniverseUpdated === true,
    watchlistMessage: analysis.message,
    opportunityHistory,
    notification,
    changedSymbols: notification.changedSymbols,
    notificationSymbols,
    renderedNotificationSymbols,
    sent: notification.sent,
    message: notification.sent ? message : null,
    payload: notification.sent ? payload : null,
    response: notification.response,
  };
  result.productionLog = formatProductionLog(result);
  return result;
}

if (require.main === module) {
  run().then((result) => {
    writeRunLog(result);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CHANGE_REPORT_HEADER,
  DEFAULT_LOG_LEVEL,
  LOG_LEVELS,
  changedAvailability,
  formatProductionLog,
  formatChangeNotification,
  logRenderedNotificationSymbols,
  normalizeLogLevel,
  orderNotificationSymbols,
  productionSymbolLines,
  run,
  selectNotificationResults,
  writeRunLog,
};
