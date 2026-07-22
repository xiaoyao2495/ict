var EntryEngine = require('../indicators/entryEngine');
var BacktestEngine = require('./backtestEngine');

var MODES = [
    EntryEngine.ENTRY_MODES.FVG_EDGE,
    EntryEngine.ENTRY_MODES.FVG_MIDPOINT,
    EntryEngine.ENTRY_MODES.FVG_75_PERCENT
];

function median(values) {
    var sorted;
    var middle;

    if (!values.length) {
        return null;
    }

    sorted = values.slice().sort(function (a, b) {
        return a - b;
    });
    middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
        return sorted[middle];
    }

    return (sorted[middle - 1] + sorted[middle]) / 2;
}

function countStatus(entries, status) {
    var count = 0;
    var i;

    for (i = 0; i < entries.length; i++) {
        if (entries[i].status === status) {
            count++;
        }
    }

    return count;
}

function summarize(setupCount, entries, trades) {
    var triggered = [];
    var closed = [];
    var ages = [];
    var rValues = [];
    var win = 0;
    var loss = 0;
    var open = 0;
    var totalR = 0;
    var i;

    for (i = 0; i < entries.length; i++) {
        if (entries[i].status === 'ENTRY_TRIGGERED') {
            triggered.push(entries[i]);
            ages.push(entries[i].setupAgeBars);
        }
    }

    for (i = 0; i < trades.length; i++) {
        if (trades[i].status === 'WIN') {
            win++;
            closed.push(trades[i]);
            rValues.push(trades[i].r);
            totalR += trades[i].r;
        } else if (trades[i].status === 'LOSS') {
            loss++;
            closed.push(trades[i]);
            rValues.push(trades[i].r);
            totalR += trades[i].r;
        } else if (trades[i].status === 'OPEN') {
            open++;
        }
    }

    return {
        setup: setupCount,
        formationInvalid: countStatus(
            entries,
            'INVALIDATED_AT_FORMATION'
        ),
        sweepInvalid: countStatus(
            entries,
            'INVALIDATED_SWEEP'
        ),
        structureInvalid: countStatus(
            entries,
            'INVALIDATED_STRUCTURE'
        ),
        oppositeMssInvalid: countStatus(
            entries,
            'INVALIDATED_OPPOSITE_MSS'
        ),
        targetTakenExpired: countStatus(
            entries,
            'EXPIRED_TARGET_TAKEN'
        ),
        noEntry: countStatus(entries, 'SETUP_FORMED'),
        actualEntries: triggered.length,
        win: win,
        loss: loss,
        open: open,
        winRate: closed.length > 0
            ? win / closed.length * 100
            : 0,
        averageR: closed.length > 0
            ? totalR / closed.length
            : 0,
        medianR: median(rValues),
        averageSetupAgeBars: ages.length > 0
            ? ages.reduce(function (total, age) {
                return total + age;
            }, 0) / ages.length
            : 0,
        medianSetupAgeBars: median(ages)
    };
}

function runMode(input, entryMode) {
    var analysis = input.analysis;
    var klines = input.klines;
    var entries = EntryEngine.analyze({
        setups: analysis.setups,
        klines: klines,
        liquidity: analysis.liquidity,
        structureEvents: analysis.structureEvents,
        entryMode: entryMode
    });
    var backtest = BacktestEngine.analyze({
        entries: entries,
        klines: klines
    });

    return {
        entryMode: entryMode,
        entries: entries,
        backtest: backtest,
        summary: summarize(
            analysis.setups.length,
            entries,
            backtest.trades
        )
    };
}

function analyze(input) {
    var result = {};
    var mode;
    var i;

    input = input || {};

    for (i = 0; i < MODES.length; i++) {
        mode = MODES[i];
        result[mode] = runMode(input, mode);
    }

    return result;
}

module.exports = {
    MODES: MODES,
    summarize: summarize,
    runMode: runMode,
    analyze: analyze
};
