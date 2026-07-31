'use strict';

var ReviewScore = require(
  '../history/ictGoldenCaseReviewScore'
);

function formatResult(result) {
  return [
    'Golden Case Review Score:',
    '',
    result.changed ? 'Updated' : 'Unchanged',
    '',
    'File:',
    result.filePath,
    '',
    'Reviewer:',
    result.review.reviewer || 'UNSPECIFIED',
  ].join('\n');
}

function run(options) {
  options = options || {};
  var output = typeof options.output === 'function'
    ? options.output
    : console.log;
  return ReviewScore.updateGoldenCaseReviewScore(options)
    .then(function (result) {
      output(formatResult(result));
      return result;
    });
}

function optionsFromArguments(args) {
  if (!Array.isArray(args) || args.length < 7) {
    throw new Error([
      'Usage:',
      'node scripts/updateGoldenCaseReviewScore.js',
      '<case-file> <reviewer> <htfClarity>',
      '<structureClarity> <liquidityQuality>',
      '<alignmentQuality> <executionQuality> [notes]',
    ].join(' '));
  }
  return {
    caseFilePath: args[0],
    reviewer: args[1],
    score: {
      htfClarity: args[2],
      structureClarity: args[3],
      liquidityQuality: args[4],
      alignmentQuality: args[5],
      executionQuality: args[6],
    },
    notes: args.slice(7).join(' ') || null,
  };
}

if (require.main === module) {
  try {
    run(optionsFromArguments(process.argv.slice(2)))
      .catch(function (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
      });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  formatResult: formatResult,
  optionsFromArguments: optionsFromArguments,
  run: run,
};
