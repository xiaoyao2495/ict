var EntryEngine = require('../indicators/entryEngine');
var BacktestEngine = require('./backtestEngine');

var MODES = {
    MODE_A: 'MODE_A',
    MODE_B: 'MODE_B',
    MODE_C: 'MODE_C'
};

function getActiveFrom(level) {
    if (typeof level.activeFrom === 'number') {
        return level.activeFrom;
    }

    if (typeof level.availableIndex === 'number') {
        return level.availableIndex;
    }

    if (typeof level.formedIndex === 'number') {
        return level.formedIndex;
    }

    if (typeof level.index2 === 'number') {
        return level.index2;
    }

    if (typeof level.index === 'number') {
        return level.index;
    }

    return 0;
}

function isAvailable(level, index, atBarOpen) {
    if (getActiveFrom(level) > index) {
        return false;
    }

    if (typeof level.consumedAt !== 'number') {
        return true;
    }

    return atBarOpen
        ? level.consumedAt >= index
        : level.consumedAt > index;
}

function appendLevels(
    result,
    levels,
    expectedType,
    index,
    atBarOpen
) {
    var i;

    if (!levels) {
        return;
    }

    for (i = 0; i < levels.length; i++) {
        if (
            levels[i].type === expectedType &&
            typeof levels[i].price === 'number' &&
            isAvailable(levels[i], index, atBarOpen)
        ) {
            result.push(levels[i]);
        }
    }
}

function selectTargetLevel(
    direction,
    entry,
    liquidity,
    index,
    atBarOpen
) {
    var levels = [];
    var selected = null;
    var i;

    liquidity = liquidity || {};

    if (direction === 'LONG') {
        appendLevels(
            levels,
            liquidity.equalHighs,
            'EQUAL_HIGH',
            index,
            atBarOpen
        );
        appendLevels(
            levels,
            liquidity.previousDayLevels,
            'PDH',
            index,
            atBarOpen
        );
    } else {
        appendLevels(
            levels,
            liquidity.equalLows,
            'EQUAL_LOW',
            index,
            atBarOpen
        );
        appendLevels(
            levels,
            liquidity.previousDayLevels,
            'PDL',
            index,
            atBarOpen
        );
    }

    for (i = 0; i < levels.length; i++) {
        if (
            direction === 'LONG' &&
            levels[i].price > entry &&
            (
                selected === null ||
                levels[i].price < selected.price
            )
        ) {
            selected = levels[i];
        }

        if (
            direction === 'SHORT' &&
            levels[i].price < entry &&
            (
                selected === null ||
                levels[i].price > selected.price
            )
        ) {
            selected = levels[i];
        }
    }

    return selected;
}

function applyEntryTarget(
    result,
    direction,
    liquidity,
    index
) {
    var level = selectTargetLevel(
        direction,
        result.entry,
        liquidity,
        index,
        false
    );

    if (level) {
        result.target = level.price;
        result.targetSource = 'LIQUIDITY';
        result.targetLiquidityType = level.type;
        result.targetLevel = level;
        return;
    }

    result.target = direction === 'LONG'
        ? result.entry + (result.entry - result.stop) * 2
        : result.entry - (result.stop - result.entry) * 2;
    result.targetSource = 'FALLBACK_2R';
    result.targetLiquidityType = null;
    result.targetLevel = null;
}

function getEventAvailableIndex(event) {
    if (typeof event.availableIndex === 'number') {
        return event.availableIndex;
    }

    if (typeof event.confirmationIndex === 'number') {
        return event.confirmationIndex;
    }

    if (typeof event.breakIndex === 'number') {
        return event.breakIndex;
    }

    return event.index;
}

function hasOppositeMssAt(events, type, index) {
    var i;

    for (i = 0; i < events.length; i++) {
        if (
            events[i].type === type &&
            getEventAvailableIndex(events[i]) === index
        ) {
            return true;
        }
    }

    return false;
}

function createResult(
    setup,
    direction,
    entryPrice,
    mode,
    klines
) {
    return {
        type: direction + '_ENTRY',
        entryMode: EntryEngine.ENTRY_MODES.FVG_EDGE,
        expiryMode: mode,
        status: 'SETUP_FORMED',
        entry: entryPrice,
        setupIndex: setup.triggerIndex,
        setupAvailableIndex: setup.availableIndex,
        triggerIndex: null,
        stop: setup.sweepExtreme,
        sweepStop: setup.sweepExtreme,
        structureStop: setup.structureInvalidationLevel,
        target: null,
        targetSource: null,
        targetLiquidityType: null,
        targetLevel: null,
        targetReselections: [],
        setupAgeBars: Math.max(
            0,
            klines.length - 1 - setup.availableIndex
        ),
        invalidatedAt: null,
        invalidationReason: null
    };
}

function invalidate(result, setup, index, status) {
    result.status = status;
    result.invalidatedAt = index;
    result.invalidationReason = status;
    result.setupAgeBars = index - setup.availableIndex;

    return result;
}

function formationIsValid(result) {
    if (
        typeof result.entry !== 'number' ||
        typeof result.stop !== 'number' ||
        typeof result.structureStop !== 'number'
    ) {
        return false;
    }

    if (result.type === 'LONG_ENTRY') {
        return result.entry > result.stop &&
            result.entry > result.structureStop;
    }

    return result.entry < result.stop &&
        result.entry < result.structureStop;
}

function recordReselection(
    result,
    direction,
    liquidity,
    index
) {
    var level = selectTargetLevel(
        direction,
        result.entry,
        liquidity,
        index,
        true
    );

    if (level && level.consumedAt === index) {
        result.targetReselections.push({
            index: index,
            type: level.type,
            price: level.price
        });
    }
}

function processSetup(
    setup,
    klines,
    liquidity,
    structureEvents,
    mode
) {
    var direction = setup.type === 'LONG_SETUP'
        ? 'LONG'
        : 'SHORT';
    var entryPrice = EntryEngine.getEntryPrice(
        direction,
        setup.fvg,
        EntryEngine.ENTRY_MODES.FVG_EDGE
    );
    var result = createResult(
        setup,
        direction,
        entryPrice,
        mode,
        klines
    );
    var entryTouched;
    var i;

    if (!formationIsValid(result)) {
        return invalidate(
            result,
            setup,
            setup.availableIndex,
            'INVALIDATED_AT_FORMATION'
        );
    }

    for (i = setup.availableIndex + 1; i < klines.length; i++) {
        entryTouched = direction === 'LONG'
            ? klines[i].low <= result.entry
            : klines[i].high >= result.entry;

        if (entryTouched) {
            result.status = 'ENTRY_TRIGGERED';
            result.triggerIndex = i;
            result.setupAgeBars = i - setup.availableIndex;
            applyEntryTarget(
                result,
                direction,
                liquidity,
                i
            );
            return result;
        }

        if (
            direction === 'LONG' &&
            klines[i].low < result.stop ||
            direction === 'SHORT' &&
            klines[i].high > result.stop
        ) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_SWEEP'
            );
        }

        if (
            direction === 'LONG' &&
            klines[i].low < result.structureStop ||
            direction === 'SHORT' &&
            klines[i].high > result.structureStop
        ) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_STRUCTURE'
            );
        }

        if (hasOppositeMssAt(
            structureEvents,
            direction === 'LONG'
                ? 'BEARISH_MSS'
                : 'BULLISH_MSS',
            i
        )) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_OPPOSITE_MSS'
            );
        }

        if (mode === MODES.MODE_B) {
            recordReselection(
                result,
                direction,
                liquidity,
                i
            );
        }
    }

    return result;
}

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

    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function count(entries, status) {
    return entries.filter(function (entry) {
        return entry.status === status;
    }).length;
}

function summarize(setupCount, entries, trades) {
    var triggered = entries.filter(function (entry) {
        return entry.status === 'ENTRY_TRIGGERED';
    });
    var closed = trades.filter(function (trade) {
        return trade.status === 'WIN' ||
            trade.status === 'LOSS';
    });
    var rValues = closed.map(function (trade) {
        return trade.r;
    });
    var ages = triggered.map(function (entry) {
        return entry.setupAgeBars;
    });
    var win = count(trades, 'WIN');
    var loss = count(trades, 'LOSS');
    var totalR = rValues.reduce(function (total, value) {
        return total + value;
    }, 0);

    return {
        setup: setupCount,
        formationInvalid: count(
            entries,
            'INVALIDATED_AT_FORMATION'
        ),
        sweepInvalid: count(entries, 'INVALIDATED_SWEEP'),
        structureInvalid: count(
            entries,
            'INVALIDATED_STRUCTURE'
        ),
        oppositeMss: count(
            entries,
            'INVALIDATED_OPPOSITE_MSS'
        ),
        targetTakenExpired: count(
            entries,
            'EXPIRED_TARGET_TAKEN'
        ),
        actualEntries: triggered.length,
        win: win,
        loss: loss,
        open: count(trades, 'OPEN'),
        winRate: closed.length
            ? win / closed.length * 100
            : 0,
        averageR: closed.length
            ? totalR / closed.length
            : 0,
        medianR: median(rValues),
        totalR: totalR,
        averageSetupAgeBars: ages.length
            ? ages.reduce(function (total, age) {
                return total + age;
            }, 0) / ages.length
            : 0,
        medianSetupAgeBars: median(ages)
    };
}

function runBaseline(input) {
    var entries = EntryEngine.analyze({
        setups: input.analysis.setups,
        klines: input.klines,
        liquidity: input.analysis.liquidity,
        structureEvents: input.analysis.structureEvents,
        entryMode: EntryEngine.ENTRY_MODES.FVG_EDGE
    });
    var backtest = BacktestEngine.analyze({
        entries: entries,
        klines: input.klines
    });

    return {
        mode: MODES.MODE_A,
        entries: entries,
        backtest: backtest,
        summary: summarize(
            input.analysis.setups.length,
            entries,
            backtest.trades
        )
    };
}

function runExperimentalMode(input, mode) {
    var entries = input.analysis.setups.map(function (setup) {
        return processSetup(
            setup,
            input.klines,
            input.analysis.liquidity,
            input.analysis.structureEvents,
            mode
        );
    });
    var backtest = BacktestEngine.analyze({
        entries: entries,
        klines: input.klines
    });

    return {
        mode: mode,
        entries: entries,
        backtest: backtest,
        summary: summarize(
            input.analysis.setups.length,
            entries,
            backtest.trades
        )
    };
}

function analyze(input) {
    return {
        MODE_A: runBaseline(input),
        MODE_B: runExperimentalMode(input, MODES.MODE_B),
        MODE_C: runExperimentalMode(input, MODES.MODE_C)
    };
}

module.exports = {
    MODES: MODES,
    analyze: analyze,
    runBaseline: runBaseline,
    runExperimentalMode: runExperimentalMode,
    summarize: summarize
};
