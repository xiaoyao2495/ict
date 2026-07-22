var assert = require('assert');
var Experiment = require('../backtest/setupExpiryExperiment');

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
            kline(105, 95),
            kline(108, 98),
            kline(115, 111),
            kline(121, 111),
            kline(112, 109),
            kline(151, 105)
        ],
        analysis: {
            setups: [{
                type: 'LONG_SETUP',
                triggerIndex: 2,
                availableIndex: 2,
                direction: 'BULLISH',
                reasons: [],
                fvg: fvg,
                sweepExtreme: 90,
                structureInvalidationLevel: 95
            }],
            liquidity: {
                equalHighs: [{
                    type: 'EQUAL_HIGH',
                    price: 120,
                    activeFrom: 2,
                    consumedAt: 3,
                    status: 'CONSUMED'
                }],
                equalLows: [],
                previousDayLevels: []
            },
            structureEvents: []
        }
    };
}

test('MODE_A 保持 Target Taken Expired baseline', function () {
    var result = Experiment.analyze(createInput());

    assert.strictEqual(
        result.MODE_A.entries[0].status,
        'EXPIRED_TARGET_TAKEN'
    );
    assert.strictEqual(result.MODE_A.summary.actualEntries, 0);
    assert.strictEqual(result.MODE_A.summary.targetTakenExpired, 1);
});

test('MODE_B Target 被获取后重选并继续等待 Entry', function () {
    var result = Experiment.analyze(createInput());
    var entry = result.MODE_B.entries[0];

    assert.strictEqual(entry.status, 'ENTRY_TRIGGERED');
    assert.strictEqual(entry.triggerIndex, 4);
    assert.strictEqual(entry.targetSource, 'FALLBACK_2R');
    assert.strictEqual(entry.target, 150);
    assert.strictEqual(entry.targetReselections.length, 1);
    assert.strictEqual(entry.targetReselections[0].price, 120);
    assert.strictEqual(result.MODE_B.backtest.trades[0].status, 'WIN');
});

test('MODE_C 忽略等待期 Target 且与 MODE_B 成交等价', function () {
    var result = Experiment.analyze(createInput());
    var modeB = result.MODE_B.entries[0];
    var modeC = result.MODE_C.entries[0];

    assert.strictEqual(modeC.targetReselections.length, 0);
    assert.strictEqual(modeC.status, modeB.status);
    assert.strictEqual(modeC.triggerIndex, modeB.triggerIndex);
    assert.strictEqual(modeC.entry, modeB.entry);
    assert.strictEqual(modeC.stop, modeB.stop);
    assert.strictEqual(modeC.target, modeB.target);
    assert.strictEqual(
        result.MODE_C.backtest.trades[0].r,
        result.MODE_B.backtest.trades[0].r
    );
});

test('实验汇总包含 Total R 与 setupAgeBars', function () {
    var summary = Experiment.analyze(
        createInput()
    ).MODE_B.summary;

    assert.strictEqual(summary.setup, 1);
    assert.strictEqual(summary.win, 1);
    assert.strictEqual(summary.totalR, 2);
    assert.strictEqual(summary.averageR, 2);
    assert.strictEqual(summary.averageSetupAgeBars, 2);
    assert.strictEqual(summary.medianSetupAgeBars, 2);
});

console.log('\n' + testsPassed + ' tests passed.');
