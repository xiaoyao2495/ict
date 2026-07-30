'use strict';

const fs = require('fs/promises');
const path = require('path');
const OpportunityHistory = require(
  '../history/ictOpportunityHistory'
);
const Formatter = require(
  '../formatters/ictOpportunityHistoryFormatter'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  '..',
  'reports',
  'ict-opportunity-summary.txt'
);

async function generateOpportunityHistoryReport(options) {
  options = options || {};
  const inputPath = path.resolve(
    options.inputPath ||
      OpportunityHistory.DEFAULT_HISTORY_PATH
  );
  const outputPath = path.resolve(
    options.outputPath || DEFAULT_OUTPUT_PATH
  );
  const content = await fs.readFile(inputPath, 'utf8');
  const history = JSON.parse(content);
  const summary = Formatter.summarize(history, {
    asOf: options.asOf,
  });
  const text = Formatter.format(summary);

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  await fs.writeFile(outputPath, text, 'utf8');

  return {
    inputPath,
    outputPath,
    summary,
    text,
  };
}

if (require.main === module) {
  generateOpportunityHistoryReport()
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
  generateOpportunityHistoryReport,
};
