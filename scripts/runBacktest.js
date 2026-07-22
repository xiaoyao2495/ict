process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';

var axios = require('axios');
var AnalysisEngine = require('../indicators/analysisEngine');
var Liquidity = require('../indicators/liquidity');
var HTFContextAnalyzer = require(
    '../indicators/htfContextAnalyzer'
);
var BacktestEngine = require('../backtest/backtestEngine');
var SetupExpiryExperiment = require(
    '../backtest/setupExpiryExperiment'
);
var SetupAgeExperiment = require(
    '../backtest/setupAgeExperiment'
);
var BaselineV1 = require('../config/baselineV1');

var BASE_URL = 'https://fapi.binance.com';
var SYMBOL = 'BTCUSDT';
var INTERVAL = '5m';
var INTERVAL_MILLISECONDS = 5 * 60 * 1000;
var PAGE_LIMIT = 1500;
var START_TIME = Date.UTC(2025, 6, 21);
var END_TIME = Date.UTC(2026, 6, 21, 23, 59, 59, 999);

var ANALYSIS_CHUNK_SIZE = 1500;
var ANALYSIS_WARMUP = 500;
var CONFIRMATION_WINDOW = 2;

function mapKline(item) {
    return {
        openTime: item[0],
        open: Number(item[1]),
        high: Number(item[2]),
        low: Number(item[3]),
        close: Number(item[4]),
        volume: Number(item[5]),
        closeTime: item[6]
    };
}

function fetchHistoricalKlines(
    symbol,
    interval,
    startTime,
    endTime
) {
    var result = [];
    var page = 0;

    function fetchPage(cursor) {
        return axios.get(BASE_URL + '/fapi/v1/klines', {
            params: {
                symbol: symbol,
                interval: interval,
                startTime: cursor,
                endTime: endTime,
                limit: PAGE_LIMIT
            }
        }).then(function (response) {
            var items = response.data;
            var lastOpenTime;
            var nextCursor;
            var i;

            if (!items || items.length === 0) {
                return result;
            }

            for (i = 0; i < items.length; i++) {
                if (items[i][0] > endTime) {
                    break;
                }

                if (
                    result.length === 0 ||
                    items[i][0] >
                        result[result.length - 1].openTime
                ) {
                    result.push(mapKline(items[i]));
                }
            }

            page++;
            lastOpenTime = items[items.length - 1][0];
            nextCursor = lastOpenTime +
                INTERVAL_MILLISECONDS;

            console.log(
                'Downloaded page ' + page +
                ', total Klines: ' + result.length
            );

            if (
                items.length < PAGE_LIMIT ||
                nextCursor > endTime ||
                nextCursor <= cursor
            ) {
                return result;
            }

            return fetchPage(nextCursor);
        });
    }

    return fetchPage(startTime);
}

function filterClosedKlines(klines, currentTime) {
    var result = [];
    var i;

    currentTime = typeof currentTime === 'number'
        ? currentTime
        : Date.now();

    for (i = 0; i < klines.length; i++) {
        if (
            klines[i].openTime +
                INTERVAL_MILLISECONDS <= currentTime
        ) {
            result.push(klines[i]);
        }
    }

    return result;
}

function cloneSetupWithOffset(setup, offset) {
    return {
        type: setup.type,
        triggerIndex: setup.triggerIndex + offset,
        availableIndex:
            (typeof setup.availableIndex === 'number'
                ? setup.availableIndex
                : setup.triggerIndex) + offset,
        direction: setup.direction,
        reasons: setup.reasons.slice(),
        sweep: cloneEventWithOffset(setup.sweep, offset),
        mss: cloneEventWithOffset(setup.mss, offset),
        displacement: cloneEventWithOffset(
            setup.displacement,
            offset
        ),
        fvg: cloneFVGWithOffset(setup.fvg, offset),
        sweepExtreme: setup.sweepExtreme,
        structureInvalidationLevel:
            setup.structureInvalidationLevel,
        fvgMidpoint: setup.fvgMidpoint,
        fvgTop: setup.fvgTop,
        fvgBottom: setup.fvgBottom,
        formationValid: setup.formationValid
    };
}

function cloneEventWithOffset(event, offset) {
    var result = {};
    var indexFields = {
        index: true,
        breakIndex: true,
        startIndex: true,
        endIndex: true,
        availableIndex: true,
        extremeIndex: true,
        confirmationIndex: true
    };
    var property;

    if (!event) {
        return null;
    }

    for (property in event) {
        if (
            Object.prototype.hasOwnProperty.call(
                event,
                property
            )
        ) {
            result[property] =
                indexFields[property] &&
                typeof event[property] === 'number'
                    ? event[property] + offset
                    : event[property];
        }
    }

    return result;
}

function cloneFVGWithOffset(fvg, offset) {
    return {
        type: fvg.type,
        top: fvg.top,
        bottom: fvg.bottom,
        startIndex: fvg.startIndex + offset,
        endIndex: fvg.endIndex + offset,
        availableIndex:
            (typeof fvg.availableIndex === 'number'
                ? fvg.availableIndex
                : fvg.endIndex) + offset,
        size: fvg.size,
        midpoint: fvg.midpoint,
        mitigated: fvg.mitigated,
        midpointMitigated: fvg.midpointMitigated,
        fullyMitigated: fvg.fullyMitigated,
        mitigationIndex:
            typeof fvg.mitigationIndex === 'number'
                ? fvg.mitigationIndex + offset
                : null
    };
}

function cloneEqualLevelWithOffset(level, offset) {
    return {
        type: level.type,
        price: level.price,
        index1: level.index1 + offset,
        index2: level.index2 + offset,
        formedIndex:
            (typeof level.formedIndex === 'number'
                ? level.formedIndex
                : level.index2) + offset,
        availableIndex:
            (typeof level.availableIndex === 'number'
                ? level.availableIndex
                : level.index2) + offset,
        activeFrom:
            (typeof level.activeFrom === 'number'
                ? level.activeFrom
                : typeof level.availableIndex === 'number'
                    ? level.availableIndex
                    : level.index2) + offset,
        consumedAt:
            typeof level.consumedAt === 'number'
                ? level.consumedAt + offset
                : null,
        status: level.status,
        direction: level.direction
    };
}

function cloneDayLevelWithOffset(level, offset) {
    return {
        type: level.type,
        price: level.price,
        index: level.index + offset,
        formedIndex:
            (typeof level.formedIndex === 'number'
                ? level.formedIndex
                : level.index) + offset,
        availableIndex:
            (typeof level.availableIndex === 'number'
                ? level.availableIndex
                : level.index) + offset,
        activeFrom:
            (typeof level.activeFrom === 'number'
                ? level.activeFrom
                : typeof level.availableIndex === 'number'
                    ? level.availableIndex
                    : level.index) + offset,
        consumedAt:
            typeof level.consumedAt === 'number'
                ? level.consumedAt + offset
                : null,
        status: level.status,
        direction: level.direction
    };
}

function addUnique(result, seen, key, item) {
    if (seen[key]) {
        return;
    }

    seen[key] = true;
    result.push(item);
}

function getAnalysisWindowRange(coreStart, length) {
    var coreEnd = Math.min(
        length,
        coreStart + ANALYSIS_CHUNK_SIZE
    );
    var coreEndIndex = coreEnd - 1;
    var maxAllowedIndex = Math.min(
        length - 1,
        coreEndIndex + CONFIRMATION_WINDOW
    );

    return {
        coreStart: coreStart,
        coreEnd: coreEnd,
        coreEndIndex: coreEndIndex,
        windowStart: Math.max(
            0,
            coreStart - ANALYSIS_WARMUP
        ),
        windowEnd: maxAllowedIndex + 1,
        maxAllowedIndex: maxAllowedIndex
    };
}

function analyzeHistoricalKlines(klines) {
    var result = {
        setups: [],
        fvgs: [],
        structureEvents: [],
        liquidity: {
            equalHighs: [],
            equalLows: [],
            previousDayLevels: [],
            sweeps: []
        }
    };
    var seenSetups = {};
    var seenFvgs = {};
    var seenStructureEvents = {};
    var seenEqualHighs = {};
    var seenEqualLows = {};
    var seenDayLevels = {};
    var coreStart;
    var coreEnd;
    var range;
    var windowStart;
    var windowEnd;
    var windowKlines;
    var analysis;
    var globalIndex;
    var item;
    var key;
    var i;

    for (
        coreStart = 0;
        coreStart < klines.length;
        coreStart += ANALYSIS_CHUNK_SIZE
    ) {
        range = getAnalysisWindowRange(
            coreStart,
            klines.length
        );
        coreEnd = range.coreEnd;
        windowStart = range.windowStart;
        windowEnd = range.windowEnd;
        windowKlines = klines.slice(
            windowStart,
            windowEnd
        );
        analysis = AnalysisEngine.analyzeMarket(windowKlines);

        for (i = 0; i < analysis.setups.length; i++) {
            globalIndex = analysis.setups[i].availableIndex +
                windowStart;

            if (
                globalIndex < coreStart ||
                globalIndex >= coreEnd
            ) {
                continue;
            }

            item = cloneSetupWithOffset(
                analysis.setups[i],
                windowStart
            );
            key = item.type + ':' + item.triggerIndex + ':' +
                item.availableIndex;
            addUnique(
                result.setups,
                seenSetups,
                key,
                item
            );
        }

        for (i = 0; i < analysis.fvgs.length; i++) {
            globalIndex = analysis.fvgs[i].endIndex +
                windowStart;

            if (
                globalIndex < coreStart ||
                globalIndex >= coreEnd
            ) {
                continue;
            }

            item = cloneFVGWithOffset(
                analysis.fvgs[i],
                windowStart
            );
            key = item.type + ':' + item.endIndex;
            addUnique(result.fvgs, seenFvgs, key, item);
        }

        for (i = 0; i < analysis.structureEvents.length; i++) {
            globalIndex =
                (typeof analysis.structureEvents[i]
                    .availableIndex === 'number'
                    ? analysis.structureEvents[i]
                        .availableIndex
                    : analysis.structureEvents[i]
                        .breakIndex) + windowStart;

            if (
                globalIndex < coreStart ||
                globalIndex >= coreEnd
            ) {
                continue;
            }

            item = cloneEventWithOffset(
                analysis.structureEvents[i],
                windowStart
            );
            key = item.type + ':' + item.breakIndex + ':' +
                item.availableIndex + ':' + item.level;
            addUnique(
                result.structureEvents,
                seenStructureEvents,
                key,
                item
            );
        }

        for (
            i = 0;
            i < analysis.liquidity.equalHighs.length;
            i++
        ) {
            item = cloneEqualLevelWithOffset(
                analysis.liquidity.equalHighs[i],
                windowStart
            );
            key = item.type + ':' + item.index1 + ':' +
                item.index2;
            addUnique(
                result.liquidity.equalHighs,
                seenEqualHighs,
                key,
                item
            );
        }

        for (
            i = 0;
            i < analysis.liquidity.equalLows.length;
            i++
        ) {
            item = cloneEqualLevelWithOffset(
                analysis.liquidity.equalLows[i],
                windowStart
            );
            key = item.type + ':' + item.index1 + ':' +
                item.index2;
            addUnique(
                result.liquidity.equalLows,
                seenEqualLows,
                key,
                item
            );
        }

        for (
            i = 0;
            i < analysis.liquidity.previousDayLevels.length;
            i++
        ) {
            item = cloneDayLevelWithOffset(
                analysis.liquidity.previousDayLevels[i],
                windowStart
            );
            key = item.type + ':' + item.index;
            addUnique(
                result.liquidity.previousDayLevels,
                seenDayLevels,
                key,
                item
            );
        }

        console.log(
            'Analyzed Klines ' + coreStart +
            ' ~ ' + (coreEnd - 1) +
            ', Setups: ' + result.setups.length
        );
    }

    Liquidity.refreshLiquidityLifecycle(
        klines,
        result.liquidity.equalHighs
    );
    Liquidity.refreshLiquidityLifecycle(
        klines,
        result.liquidity.equalLows
    );
    Liquidity.refreshLiquidityLifecycle(
        klines,
        result.liquidity.previousDayLevels
    );

    result.setups = HTFContextAnalyzer.attachContexts(
        result.setups,
        klines
    );

    result.setups.sort(function (setup1, setup2) {
        return setup1.availableIndex - setup2.availableIndex;
    });

    return result;
}

function isLiquidityAvailable(level, setupIndex) {
    if (typeof level.index2 === 'number') {
        return level.index2 <= setupIndex;
    }

    if (typeof level.index === 'number') {
        return level.index <= setupIndex;
    }

    return false;
}

function filterLiquidityForSetup(liquidity, setupIndex) {
    return {
        equalHighs: liquidity.equalHighs.filter(
            function (level) {
                return isLiquidityAvailable(
                    level,
                    setupIndex
                );
            }
        ),
        equalLows: liquidity.equalLows.filter(
            function (level) {
                return isLiquidityAvailable(
                    level,
                    setupIndex
                );
            }
        ),
        previousDayLevels:
            liquidity.previousDayLevels.filter(
                function (level) {
                    return isLiquidityAvailable(
                        level,
                        setupIndex
                    );
                }
            ),
        sweeps: []
    };
}

function createEntriesWithoutFutureLiquidity(
    analysis,
    klines,
    options
) {
    var configuration = resolveConfiguration(options);
    var input = {
        analysis: analysis,
        klines: klines
    };
    var modeResult = SetupExpiryExperiment
        .runExperimentalMode(
            input,
            SetupExpiryExperiment.MODES.MODE_B,
            {
                entryMode: configuration.entryMode
            }
        );

    return SetupAgeExperiment.applyMaxWait(
        modeResult.entries,
        configuration.maxWaitBars
    );
}

function resolveConfiguration(overrides) {
    var result = {};
    var property;

    for (property in BaselineV1) {
        if (
            Object.prototype.hasOwnProperty.call(
                BaselineV1,
                property
            )
        ) {
            result[property] = BaselineV1[property];
        }
    }

    overrides = overrides || {};

    for (property in overrides) {
        if (
            Object.prototype.hasOwnProperty.call(
                overrides,
                property
            )
        ) {
            result[property] = overrides[property];
        }
    }

    if (result.stop !== 'SWEEP_EXTREME') {
        throw new Error(
            'Unsupported Stop mode: ' + result.stop
        );
    }

    if (result.target !== 'LIQUIDITY_RESELECT') {
        throw new Error(
            'Unsupported Target mode: ' + result.target
        );
    }

    if (result.execution !== 'CONSERVATIVE') {
        throw new Error(
            'Unsupported Execution mode: ' +
            result.execution
        );
    }

    if (
        result.maxWaitBars !== null &&
        (
            typeof result.maxWaitBars !== 'number' ||
            result.maxWaitBars < 0
        )
    ) {
        throw new Error(
            'Unsupported maxWaitBars: ' +
            result.maxWaitBars
        );
    }

    return result;
}

function executeBacktest(analysis, klines, options) {
    var configuration = resolveConfiguration(options);
    var entries = createEntriesWithoutFutureLiquidity(
        analysis,
        klines,
        configuration
    );
    var backtest = BacktestEngine.analyze({
        entries: entries,
        klines: klines
    });

    return {
        configuration: configuration,
        entries: entries,
        backtest: backtest
    };
}

function calculateTradeStats(trades, direction) {
    var stats = {
        total: 0,
        win: 0,
        loss: 0,
        winRate: 0,
        avgR: 0
    };
    var totalR = 0;
    var trade;
    var i;

    for (i = 0; i < trades.length; i++) {
        trade = trades[i];

        if (direction && trade.type !== direction) {
            continue;
        }

        if (trade.status === 'WIN') {
            stats.total++;
            stats.win++;
            totalR += trade.r;
        }

        if (trade.status === 'LOSS') {
            stats.total++;
            stats.loss++;
            totalR += trade.r;
        }
    }

    if (stats.total > 0) {
        stats.winRate = stats.win / stats.total * 100;
        stats.avgR = totalR / stats.total;
    }

    return stats;
}

function formatNumber(value) {
    return Number(value).toFixed(2);
}

function printStats(title, stats) {
    console.log('\n' + title + ':');
    console.log('Total trades:', stats.total);
    console.log('Win:', stats.win);
    console.log('Loss:', stats.loss);
    console.log('Win rate:', formatNumber(stats.winRate) + '%');
    console.log('Average R:', formatNumber(stats.avgR));
}

function getTime(klines, index) {
    if (!klines[index]) {
        return null;
    }

    return new Date(klines[index].openTime).toISOString();
}

function printTrades(trades, klines) {
    console.log('\nTrades:');

    if (trades.length === 0) {
        console.log('No triggered entries.');
        return;
    }

    console.table(
        trades.map(function (trade) {
            return {
                direction: trade.type,
                entryTime: getTime(klines, trade.entryIndex),
                entryPrice: trade.entry,
                exitTime: getTime(klines, trade.exitIndex),
                result: trade.status,
                R: trade.r
            };
        })
    );
}

function runBacktest(options) {
    var configuration = resolveConfiguration(options);

    console.log('=====================');
    console.log('ICT Backtest');
    console.log('=====================');
    console.log('Symbol:', SYMBOL);
    console.log('Timeframe:', INTERVAL);
    console.log('Configuration:', configuration);
    console.log(
        'Requested period:',
        new Date(START_TIME).toISOString(),
        '~',
        new Date(END_TIME).toISOString()
    );
    console.log('Proxy: http://127.0.0.1:7890');
    console.log(
        'Confirmation window:',
        CONFIRMATION_WINDOW,
        'bars'
    );

    return fetchHistoricalKlines(
        SYMBOL,
        INTERVAL,
        START_TIME,
        END_TIME
    ).then(function (downloadedKlines) {
        var klines = filterClosedKlines(
            downloadedKlines,
            Date.now()
        );
        var analysis;
        var entries;
        var backtest;
        var execution;
        var overallStats;
        var longStats;
        var shortStats;

        if (klines.length === 0) {
            throw new Error('No closed historical Klines received.');
        }

        console.log(
            '\nFiltered unclosed Klines:',
            downloadedKlines.length - klines.length
        );
        console.log(
            'Actual period:',
            new Date(klines[0].openTime).toISOString(),
            '~',
            new Date(
                klines[klines.length - 1].openTime
            ).toISOString()
        );
        console.log('Total closed Klines:', klines.length);

        analysis = analyzeHistoricalKlines(klines);
        execution = executeBacktest(
            analysis,
            klines,
            configuration
        );
        entries = execution.entries;
        backtest = execution.backtest;

        overallStats = calculateTradeStats(backtest.trades);
        longStats = calculateTradeStats(
            backtest.trades,
            'LONG'
        );
        shortStats = calculateTradeStats(
            backtest.trades,
            'SHORT'
        );

        console.log('\nSetups:', analysis.setups.length);
        console.log('Entry candidates:', entries.length);
        console.log(
            'Triggered entries:',
            backtest.trades.length
        );

        printStats('Overall', overallStats);
        printStats('LONG', longStats);
        printStats('SHORT', shortStats);
        printTrades(backtest.trades, klines);

        return {
            klines: klines,
            analysis: analysis,
            configuration: execution.configuration,
            entries: entries,
            backtest: backtest,
            overallStats: overallStats,
            longStats: longStats,
            shortStats: shortStats
        };
    });
}

if (require.main === module) {
    runBacktest().catch(function (error) {
        console.error(
            error.response
                ? error.response.data
                : error.message
        );

        process.exitCode = 1;
    });
}

module.exports = {
    BASELINE_V1: BaselineV1,
    CONFIRMATION_WINDOW: CONFIRMATION_WINDOW,
    filterClosedKlines: filterClosedKlines,
    getAnalysisWindowRange: getAnalysisWindowRange,
    analyzeHistoricalKlines: analyzeHistoricalKlines,
    filterLiquidityForSetup: filterLiquidityForSetup,
    createEntriesWithoutFutureLiquidity:
        createEntriesWithoutFutureLiquidity,
    resolveConfiguration: resolveConfiguration,
    executeBacktest: executeBacktest,
    runBacktest: runBacktest
};
