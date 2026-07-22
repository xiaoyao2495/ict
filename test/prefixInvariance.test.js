var assert = require('assert');
var AnalysisEngine = require('../indicators/analysisEngine');

var testsPassed = 0;

function test(name, callback) {
    try {
        callback();
        testsPassed++;
        console.log('PASS:', name);
    } catch (error) {
        console.error('FAIL:', name);
        throw error;
    }
}

function createRandom(seed) {
    return function () {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function createKlines(seed, length) {
    var random = createRandom(seed);
    var price = 100;
    var result = [];
    var open;
    var close;
    var high;
    var low;
    var i;

    for (i = 0; i < length; i++) {
        open = price;
        close = open + (random() - 0.5) * 8;
        high = Math.max(open, close) + random() * 4;
        low = Math.min(open, close) - random() * 4;

        result.push({
            openTime: Date.UTC(2026, 0, 1) +
                i * 5 * 60 * 1000,
            open: open,
            high: high,
            low: low,
            close: close,
            volume: 100 + random() * 100
        });
        price = close;
    }

    return result;
}

function getAvailableIndex(event) {
    if (typeof event.availableIndex === 'number') {
        return event.availableIndex;
    }

    if (typeof event.confirmationIndex === 'number') {
        return event.confirmationIndex;
    }

    if (typeof event.endIndex === 'number') {
        return event.endIndex;
    }

    if (typeof event.index === 'number') {
        return event.index;
    }

    return null;
}

function before(events, endIndex) {
    return events.filter(function (event) {
        return getAvailableIndex(event) < endIndex;
    });
}

function projectFvg(fvg) {
    return {
        type: fvg.type,
        top: fvg.top,
        bottom: fvg.bottom,
        startIndex: fvg.startIndex,
        endIndex: fvg.endIndex,
        availableIndex: fvg.availableIndex,
        size: fvg.size,
        midpoint: fvg.midpoint
    };
}

function projectLevel(level) {
    return {
        type: level.type,
        price: level.price,
        index: level.index,
        index1: level.index1,
        index2: level.index2,
        formedIndex: level.formedIndex,
        availableIndex: level.availableIndex,
        activeFrom: level.activeFrom,
        direction: level.direction
    };
}

function projectEvent(event) {
    if (!event) {
        return null;
    }

    return {
        type: event.type,
        index: event.index,
        breakIndex: event.breakIndex,
        endIndex: event.endIndex,
        availableIndex: getAvailableIndex(event),
        level: event.level,
        price: event.price,
        extreme: event.extreme
    };
}

function projectSetup(setup) {
    return {
        type: setup.type,
        triggerIndex: setup.triggerIndex,
        availableIndex: setup.availableIndex,
        direction: setup.direction,
        reasons: setup.reasons,
        sweep: projectEvent(setup.sweep),
        mss: projectEvent(setup.mss),
        displacement: projectEvent(setup.displacement),
        fvg: projectFvg(setup.fvg),
        sweepExtreme: setup.sweepExtreme,
        structureInvalidationLevel:
            setup.structureInvalidationLevel,
        formationValid: setup.formationValid
    };
}

function causalSnapshot(analysis, endIndex) {
    return {
        swings: before(analysis.swings, endIndex),
        structureEvents: before(
            analysis.structureEvents,
            endIndex
        ),
        liquidity: {
            equalHighs: before(
                analysis.liquidity.equalHighs,
                endIndex
            ).map(projectLevel),
            equalLows: before(
                analysis.liquidity.equalLows,
                endIndex
            ).map(projectLevel),
            previousDayLevels: before(
                analysis.liquidity.previousDayLevels,
                endIndex
            ).map(projectLevel),
            sweeps: before(
                analysis.liquidity.sweeps,
                endIndex
            )
        },
        displacementEvents: before(
            analysis.displacementEvents,
            endIndex
        ),
        fvgs: before(
            analysis.fvgs,
            endIndex
        ).map(projectFvg),
        setups: before(
            analysis.setups,
            endIndex
        ).map(projectSetup)
    };
}

test('analysis causal events satisfy prefix invariance', function () {
    var sequenceCount = 24;
    var length = 96;
    var klines;
    var extended;
    var prefix;
    var seed;
    var endIndex;

    for (seed = 1; seed <= sequenceCount; seed++) {
        klines = createKlines(seed, length);
        extended = AnalysisEngine.analyzeMarket(klines);

        for (endIndex = 5; endIndex <= length; endIndex++) {
            prefix = AnalysisEngine.analyzeMarket(
                klines.slice(0, endIndex)
            );

            assert.deepStrictEqual(
                causalSnapshot(prefix, endIndex),
                causalSnapshot(extended, endIndex),
                'seed=' + seed + ', endIndex=' + endIndex
            );
        }
    }
});

console.log('\n' + testsPassed + ' tests passed.');
