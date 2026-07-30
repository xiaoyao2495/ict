'use strict';

const fs = require('fs/promises');
const Binance = require('../api/binance');
const OpportunityHistory = require(
  '../history/ictOpportunityHistory'
);
const OutcomeTracker = require(
  '../history/ictOpportunityOutcomeTracker'
);

const DEFAULT_KLINE_LIMIT = 1500;

async function run(options) {
  options = options || {};
  const historyPath = options.historyPath ||
    OpportunityHistory.DEFAULT_HISTORY_PATH;
  const content = await fs.readFile(historyPath, 'utf8');
  const history = JSON.parse(content);
  const marketData = options.marketData || Binance;
  const getKlines = options.getKlines ||
    (async (symbol, interval) => (
      marketData.getKlines(
        symbol,
        interval,
        options.klineLimit || DEFAULT_KLINE_LIMIT
      )
    ));

  return OutcomeTracker.track({
    history,
    getKlines,
    store: options.store,
    outcomeFilePath: options.outcomeFilePath,
  });
}

if (require.main === module) {
  run()
    .then((result) => {
      console.log(
        'ICT Opportunity outcomes updated: ' +
        result.changes.length
      );
      console.log(
        'Output: ' + OutcomeTracker.DEFAULT_OUTCOME_PATH
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_KLINE_LIMIT,
  run,
};
