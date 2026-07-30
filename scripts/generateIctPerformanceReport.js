'use strict';

const fs = require('fs/promises');
const path = require('path');
const OpportunityHistory = require(
  '../history/ictOpportunityHistory'
);
const OutcomeTracker = require(
  '../history/ictOpportunityOutcomeTracker'
);
const Aggregator = require(
  '../history/ictPerformanceReportAggregator'
);
const Formatter = require(
  '../formatters/ictPerformanceReportFormatter'
);

const DEFAULT_STATISTICS_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-opportunity-statistics.txt'
);
const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-performance-report.txt'
);

async function generateIctPerformanceReport(options) {
  options = options || {};
  const historyPath = path.resolve(
    options.historyPath ||
      OpportunityHistory.DEFAULT_HISTORY_PATH
  );
  const statisticsPath = path.resolve(
    options.statisticsPath ||
      DEFAULT_STATISTICS_PATH
  );
  const outcomePath = path.resolve(
    options.outcomePath ||
      OutcomeTracker.DEFAULT_OUTCOME_PATH
  );
  const outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  const [historyContent, statisticsText, outcomeContent] =
    await Promise.all([
      fs.readFile(historyPath, 'utf8'),
      fs.readFile(statisticsPath, 'utf8'),
      fs.readFile(outcomePath, 'utf8'),
    ]);
  const report = Aggregator.aggregate({
    history: JSON.parse(historyContent),
    statisticsText,
    outcomeState: JSON.parse(outcomeContent),
  });
  const text = Formatter.format(report, {
    generatedAt: options.generatedAt,
  });

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  await fs.writeFile(outputPath, text, 'utf8');

  return {
    historyPath,
    statisticsPath,
    outcomePath,
    outputPath,
    report,
    text,
  };
}

if (require.main === module) {
  generateIctPerformanceReport()
    .then((result) => {
      console.log(result.text);
      console.log(
        'Report written to: ' + result.outputPath
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_STATISTICS_PATH,
  generateIctPerformanceReport,
};
