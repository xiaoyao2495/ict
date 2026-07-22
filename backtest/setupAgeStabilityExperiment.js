var RunBacktest = require('../scripts/runBacktest');
var SetupAgeExperiment = require('./setupAgeExperiment');
var SetupExpiryExperiment = require(
    './setupExpiryExperiment'
);

var MAX_WAIT_UNLIMITED = null;
var MAX_WAIT_16 = 16;
var DEFAULT_WARMUP_BARS = 500;

function firstIndexAtOrAfter(klines, time) {
    var low = 0;
    var high = klines.length;
    var middle;

    while (low < high) {
        middle = Math.floor((low + high) / 2);

        if (klines[middle].openTime < time) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low;
}

function listNaturalYears(klines) {
    var firstYear;
    var lastYear;
    var result = [];
    var year;

    if (!klines.length) {
        return result;
    }

    firstYear = new Date(klines[0].openTime)
        .getUTCFullYear();
    lastYear = new Date(
        klines[klines.length - 1].openTime
    ).getUTCFullYear();

    for (year = firstYear; year <= lastYear; year++) {
        result.push(year);
    }

    return result;
}

function createYearInput(
    allKlines,
    year,
    analyzeHistoricalKlines,
    warmupBars
) {
    var yearStart = Date.UTC(year, 0, 1);
    var nextYearStart = Date.UTC(year + 1, 0, 1);
    var coreStart = firstIndexAtOrAfter(
        allKlines,
        yearStart
    );
    var coreEnd = firstIndexAtOrAfter(
        allKlines,
        nextYearStart
    );
    var contextStart;
    var contextKlines;
    var analysis;
    var localCoreStart;
    var setups;

    analyzeHistoricalKlines = analyzeHistoricalKlines ||
        RunBacktest.analyzeHistoricalKlines;
    warmupBars = typeof warmupBars === 'number'
        ? warmupBars
        : DEFAULT_WARMUP_BARS;
    contextStart = Math.max(0, coreStart - warmupBars);
    contextKlines = allKlines.slice(contextStart, coreEnd);
    localCoreStart = coreStart - contextStart;
    analysis = analyzeHistoricalKlines(contextKlines);
    setups = analysis.setups.filter(function (setup) {
        var kline = contextKlines[setup.availableIndex];

        return setup.availableIndex >= localCoreStart &&
            Boolean(kline) &&
            kline.openTime >= yearStart &&
            kline.openTime < nextYearStart;
    });

    return {
        year: year,
        yearStart: yearStart,
        nextYearStart: nextYearStart,
        coreStart: coreStart,
        coreEnd: coreEnd,
        contextStart: contextStart,
        localCoreStart: localCoreStart,
        klines: contextKlines,
        analysis: {
            setups: setups,
            fvgs: analysis.fvgs,
            structureEvents: analysis.structureEvents,
            liquidity: analysis.liquidity
        }
    };
}

function runPair(input) {
    var modeB =
        SetupExpiryExperiment.runExperimentalMode(
            input,
            SetupExpiryExperiment.MODES.MODE_B
        );

    return {
        UNLIMITED: SetupAgeExperiment.runConfiguration(
            input,
            modeB.entries,
            MAX_WAIT_UNLIMITED
        ),
        '16': SetupAgeExperiment.runConfiguration(
            input,
            modeB.entries,
            MAX_WAIT_16
        )
    };
}

function createDifference(unlimited, limited) {
    return {
        tradesDifference:
            limited.actualEntries -
            unlimited.actualEntries,
        totalRDifference:
            limited.totalR - unlimited.totalR,
        averageRDifference:
            limited.averageR - unlimited.averageR
    };
}

function analyzeYear(
    allKlines,
    year,
    analyzeHistoricalKlines,
    warmupBars
) {
    var input = createYearInput(
        allKlines,
        year,
        analyzeHistoricalKlines,
        warmupBars
    );
    var configurations = runPair(input);

    return {
        year: year,
        firstKlineTime: input.klines[
            input.localCoreStart
        ].openTime,
        lastKlineTime: input.klines[
            input.klines.length - 1
        ].openTime,
        unlimited: configurations.UNLIMITED.summary,
        maxWait16: configurations['16'].summary,
        difference: createDifference(
            configurations.UNLIMITED.summary,
            configurations['16'].summary
        )
    };
}

function analyzeAllYears(
    klines,
    analyzeHistoricalKlines,
    warmupBars
) {
    return listNaturalYears(klines).map(function (year) {
        return analyzeYear(
            klines,
            year,
            analyzeHistoricalKlines,
            warmupBars
        );
    });
}

module.exports = {
    MAX_WAIT_UNLIMITED: MAX_WAIT_UNLIMITED,
    MAX_WAIT_16: MAX_WAIT_16,
    DEFAULT_WARMUP_BARS: DEFAULT_WARMUP_BARS,
    firstIndexAtOrAfter: firstIndexAtOrAfter,
    listNaturalYears: listNaturalYears,
    createYearInput: createYearInput,
    runPair: runPair,
    createDifference: createDifference,
    analyzeYear: analyzeYear,
    analyzeAllYears: analyzeAllYears
};
