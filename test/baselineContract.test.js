var assert = require('assert');
var BaselineV1 = require('../config/baselineV1');
var RunBacktest = require('../scripts/runBacktest');
var SetupExpiryExperiment = require(
    '../backtest/setupExpiryExperiment'
);
var SetupAgeExperiment = require(
    '../backtest/setupAgeExperiment'
);
var BacktestEngine = require('../backtest/backtestEngine');

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
            fvgs: [fvg],
            liquidity: {
                equalHighs: [{
                    type: 'EQUAL_HIGH',
                    price: 120,
                    activeFrom: 2,
                    consumedAt: 3,
                    status: 'CONSUMED'
                }],
                equalLows: [],
                previousDayLevels: [],
                sweeps: []
            },
            structureEvents: []
        }
    };
}

function runExplicitBaseline(input) {
    var modeB = SetupExpiryExperiment.runExperimentalMode(
        input,
        SetupExpiryExperiment.MODES.MODE_B,
        {
            entryMode: BaselineV1.entryMode
        }
    );
    var entries = SetupAgeExperiment.applyMaxWait(
        modeB.entries,
        BaselineV1.maxWaitBars
    );
    var backtest = BacktestEngine.analyze({
        entries: entries,
        klines: input.klines
    });

    return {
        entries: entries,
        backtest: backtest
    };
}

test('Baseline V1 contract 固定生产规则', function () {
    assert.deepStrictEqual(BaselineV1, {
        entryMode: 'FVG_EDGE',
        stop: 'SWEEP_EXTREME',
        target: 'LIQUIDITY_RESELECT',
        maxWaitBars: 16,
        execution: 'CONSERVATIVE'
    });
    assert.strictEqual(Object.isFrozen(BaselineV1), true);
    assert.strictEqual(RunBacktest.BASELINE_V1, BaselineV1);
});

test('默认生产入口输出等于显式 Baseline V1', function () {
    var input = createInput();
    var actual = RunBacktest.executeBacktest(
        input.analysis,
        input.klines
    );
    var expected = runExplicitBaseline(input);
    var entry = actual.entries[0];
    var trade = actual.backtest.trades[0];

    assert.deepStrictEqual(actual.configuration, BaselineV1);
    assert.deepStrictEqual(actual.entries, expected.entries);
    assert.deepStrictEqual(actual.backtest, expected.backtest);
    assert.strictEqual(entry.entryMode, 'FVG_EDGE');
    assert.strictEqual(entry.entry, 110);
    assert.strictEqual(entry.stop, 90);
    assert.strictEqual(entry.sweepStop, 90);
    assert.strictEqual(entry.expiryMode, 'MODE_B');
    assert.strictEqual(entry.targetReselections.length, 1);
    assert.strictEqual(entry.setupAgeBars <= 16, true);
    assert.strictEqual(trade.status, 'WIN');
});

test('实验调用可以显式覆盖 Entry 和 maxWaitBars', function () {
    var input = createInput();
    var result = RunBacktest.executeBacktest(
        input.analysis,
        input.klines,
        {
            entryMode: 'FVG_MIDPOINT',
            maxWaitBars: null
        }
    );

    assert.strictEqual(
        result.configuration.entryMode,
        'FVG_MIDPOINT'
    );
    assert.strictEqual(
        result.configuration.maxWaitBars,
        null
    );
    assert.strictEqual(
        result.entries[0].entryMode,
        'FVG_MIDPOINT'
    );
    assert.strictEqual(result.entries[0].entry, 105);
});

console.log('\n' + testsPassed + ' tests passed.');
