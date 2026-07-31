'use strict';

var Linker = require(
  '../history/ictGoldenCaseOutcomeLinker'
);

function formatResult(result) {
  return [
    'Golden Case Outcomes Updated:',
    '',
    'Cases scanned: ' + result.casesScanned,
    'Outcomes available: ' + result.outcomesAvailable,
    'Cases matched: ' + result.matchedCases,
    'Cases updated: ' + result.updatedCases,
  ].join('\n');
}

function run(options) {
  options = options || {};
  var output = typeof options.output === 'function'
    ? options.output
    : console.log;
  return Linker.updateGoldenCaseOutcomes(options)
    .then(function (result) {
      output(formatResult(result));
      return result;
    });
}

if (require.main === module) {
  run().catch(function (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  formatResult: formatResult,
  run: run,
};
