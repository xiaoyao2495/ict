'use strict';

const LtfEngine = require('../indicators/ictLtfExecutionEngine');
const LtfExperiment = require('./ictLtfExecutionExperiment');

function analyze(input) {
  input = input || {};
  const ltfKlines = input.ltf5mKlines || input.ltfKlines;
  if (
    !Array.isArray(ltfKlines) ||
    ltfKlines.length < 2 ||
    ltfKlines[1].openTime - ltfKlines[0].openTime !==
      LtfEngine.FIVE_MINUTES
  ) {
    throw new Error('ICT LTF 5m experiment requires 5m Klines.');
  }
  const duration = LtfEngine.validateClosedLtfKlines(
    ltfKlines,
    LtfEngine.FIVE_MINUTES
  );
  if (duration !== LtfEngine.FIVE_MINUTES) {
    throw new Error('ICT LTF 5m experiment requires 5m Klines.');
  }
  const result = LtfExperiment.analyze({
    h4Klines: input.h4Klines,
    h1Klines: input.h1Klines,
    ltfKlines,
    intervalMilliseconds: LtfEngine.FIVE_MINUTES,
    horizons: input.horizons,
    years: input.years,
  });
  return {
    ...result,
    protocol: {
      ...result.protocol,
      experiment: 'ICT_LTF_5M_EXECUTION_EXPERIMENT',
      timeframe: '5m',
      reads15m: false,
      fixedParameters: {
        displacementBodyRatio:
          LtfEngine.DISPLACEMENT_BODY_RATIO,
        rangeAverageLength:
          LtfEngine.RANGE_AVERAGE_LENGTH,
        rangeExpansionMultiplier:
          LtfEngine.RANGE_EXPANSION_MULTIPLIER,
        parameterSearch: false,
      },
      readsTrades: false,
      readsBaseline: false,
      generatesEntryExit: false,
      modifiesProduction: false,
    },
  };
}

module.exports = {
  analyze,
};
