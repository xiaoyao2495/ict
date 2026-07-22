var assert = require('assert');
var Experiment = require('../backtest/entryModeExperiment');

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

function kline(high, low) {
    return {
        open: low,
        high: high,
        low: low,
        close: high
    };
}

function createInput() {
    var fvg = {
        type: 'BULLISH_FVG',
        top: 110,
        bottom: 100,
        midpoint: 105,
        startIndex: 0,
        endIndex: 2,
        availableIndex: 2
    };

    return {
        klines: [
            kline(110, 100),
            kline(112, 105),
            kline(115, 110),
            kline(114, 109),
            kline(112, 104),
            kline(110, 102),
            kline(131, 106)
        ],
        analysis: {
            setups: [{
                type: 'LONG_SETUP',
                triggerIndex: 2,
                availableIndex: 2,
                direction: 'BULLISH',
                reasons: [],
                fvg: fvg,
                sweepExtreme: 100,
                structureInvalidationLevel: 100
            }],
            liquidity: {
                equalHighs: [],
                equalLows: [],
                previousDayLevels: []
            },
            structureEvents: []
        }
    };
}

test('独立实验同时运行三种 Entry mode', function () {
    var result = Experiment.analyze(createInput());

    assert.deepStrictEqual(Object.keys(result), Experiment.MODES);
    assert.strictEqual(
        result.FVG_EDGE.entries[0].entry,
        110
    );
    assert.strictEqual(
        result.FVG_MIDPOINT.entries[0].entry,
        105
    );
    assert.strictEqual(
        result.FVG_75_PERCENT.entries[0].entry,
        102.5
    );
    assert.strictEqual(
        result.FVG_MIDPOINT.summary.actualEntries,
        1
    );
});

test('实验模式不改变默认 MIDPOINT 语义', function () {
    var input = createInput();
    var midpoint = Experiment.runMode(
        input,
        'FVG_MIDPOINT'
    );

    assert.strictEqual(
        midpoint.entries[0].entryMode,
        'FVG_MIDPOINT'
    );
    assert.strictEqual(midpoint.entries[0].triggerIndex, 4);
});

console.log('\n' + testsPassed + ' tests passed.');
