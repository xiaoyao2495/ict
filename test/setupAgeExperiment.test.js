var assert = require('assert');
var AgeExperiment = require('../backtest/setupAgeExperiment');
var ExpiryExperiment = require(
    '../backtest/setupExpiryExperiment'
);

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
            kline(116, 111),
            kline(117, 111),
            kline(118, 111),
            kline(119, 111),
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
                equalHighs: [],
                equalLows: [],
                previousDayLevels: []
            },
            structureEvents: []
        }
    };
}

test('年龄等于 maxWaitBars 时仍允许 Entry', function () {
    var entry = {
        status: 'ENTRY_TRIGGERED',
        setupAvailableIndex: 10,
        triggerIndex: 14,
        setupAgeBars: 4,
        targetReselections: []
    };
    var result = AgeExperiment.applyMaxWait([entry], 4);

    assert.strictEqual(result[0].status, 'ENTRY_TRIGGERED');
    assert.strictEqual(result[0].triggerIndex, 14);
});

test('年龄首次大于阈值时转为 EXPIRED_MAX_WAIT', function () {
    var entry = {
        status: 'ENTRY_TRIGGERED',
        setupAvailableIndex: 10,
        triggerIndex: 15,
        setupAgeBars: 5,
        target: 120,
        targetSource: 'LIQUIDITY',
        targetLiquidityType: 'EQUAL_HIGH',
        targetLevel: {},
        targetReselections: [
            { index: 12, price: 115 },
            { index: 15, price: 118 }
        ]
    };
    var result = AgeExperiment.applyMaxWait([entry], 4)[0];

    assert.strictEqual(result.status, 'EXPIRED_MAX_WAIT');
    assert.strictEqual(result.invalidatedAt, 15);
    assert.strictEqual(result.setupAgeBars, 5);
    assert.strictEqual(result.triggerIndex, null);
    assert.strictEqual(result.target, null);
    assert.strictEqual(result.targetReselections.length, 1);
});

test('UNLIMITED 与独立 MODE_B 行为一致', function () {
    var input = createInput();
    var result = AgeExperiment.analyze(input);
    var modeB = ExpiryExperiment.runExperimentalMode(
        input,
        ExpiryExperiment.MODES.MODE_B
    );

    assert.strictEqual(
        result.UNLIMITED.entries[0].status,
        modeB.entries[0].status
    );
    assert.strictEqual(
        result.UNLIMITED.entries[0].triggerIndex,
        modeB.entries[0].triggerIndex
    );
    assert.strictEqual(result.UNLIMITED.summary.actualEntries, 1);
    assert.strictEqual(result['4'].summary.expiredMaxWait, 1);
    assert.strictEqual(result['4'].summary.actualEntries, 0);
});

test('Pearson Correlation 正确计算', function () {
    var correlation = AgeExperiment.pearsonCorrelation([
        { x: 1, y: 2 },
        { x: 2, y: 4 },
        { x: 3, y: 6 }
    ]);

    assert.ok(Math.abs(correlation - 1) < 1e-12);
    assert.strictEqual(
        AgeExperiment.pearsonCorrelation([
            { x: 1, y: 1 }
        ]),
        null
    );
});

test('年龄分桶统计 Trades 与 R', function () {
    var buckets = AgeExperiment.summarizeBuckets([
        { setupAgeBars: 2, result: 'WIN', r: 2 },
        { setupAgeBars: 4, result: 'LOSS', r: -1 },
        { setupAgeBars: 10, result: 'WIN', r: 3 }
    ]);

    assert.strictEqual(buckets['0-4'].trades, 2);
    assert.strictEqual(buckets['0-4'].winRate, 50);
    assert.strictEqual(buckets['0-4'].totalR, 1);
    assert.strictEqual(buckets['9-16'].trades, 1);
    assert.strictEqual(buckets['9-16'].averageR, 3);
});

console.log('\n' + testsPassed + ' tests passed.');
