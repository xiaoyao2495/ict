var assert = require('assert');
var RunBacktest = require('../scripts/runBacktest');
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

function createKline(openTime, high, low) {
    return {
        openTime: openTime,
        open: low,
        high: high,
        low: low,
        close: high,
        closeTime: openTime + 5 * 60 * 1000 - 1
    };
}

test('最后一根未收盘 K线不参与分析', function () {
    var baseTime = Date.UTC(2026, 6, 21);
    var currentTime = baseTime + 14 * 60 * 1000;
    var klines = [
        createKline(baseTime, 101, 99),
        createKline(baseTime + 5 * 60 * 1000, 102, 100),
        createKline(baseTime + 10 * 60 * 1000, 103, 101)
    ];
    var closedKlines = RunBacktest.filterClosedKlines(
        klines,
        currentTime
    );

    assert.strictEqual(closedKlines.length, 2);
    assert.strictEqual(
        closedKlines[closedKlines.length - 1].openTime,
        baseTime + 5 * 60 * 1000
    );
});

test('analysis window 不超过确认范围', function () {
    var range = RunBacktest.getAnalysisWindowRange(
        1500,
        5000
    );

    assert.strictEqual(RunBacktest.CONFIRMATION_WINDOW, 2);
    assert.strictEqual(range.coreEndIndex, 2999);
    assert.strictEqual(range.maxAllowedIndex, 3001);
    assert.strictEqual(range.windowStart, 1000);
    assert.strictEqual(range.windowEnd, 3002);
    assert.strictEqual(
        range.maxAllowedIndex <=
            range.coreEndIndex +
                RunBacktest.CONFIRMATION_WINDOW,
        true
    );
});

test('回测结果不使用未收盘未来 K线', function () {
    var baseTime = Date.UTC(2026, 6, 21);
    var currentTime = baseTime + 14 * 60 * 1000;
    var klines = [
        createKline(baseTime, 105, 99),
        createKline(baseTime + 5 * 60 * 1000, 108, 96),
        createKline(baseTime + 10 * 60 * 1000, 111, 96)
    ];
    var closedKlines = RunBacktest.filterClosedKlines(
        klines,
        currentTime
    );
    var result = BacktestEngine.analyze({
        entries: [
            {
                type: 'LONG_ENTRY',
                status: 'ENTRY_TRIGGERED',
                entry: 100,
                stop: 95,
                target: 110,
                setupIndex: 0,
                triggerIndex: 0
            }
        ],
        klines: closedKlines
    });

    assert.strictEqual(closedKlines.length, 2);
    assert.strictEqual(result.trades.length, 1);
    assert.strictEqual(result.trades[0].status, 'OPEN');
    assert.strictEqual(result.stats.total, 0);
});

test('回测目标不使用 Setup 之后形成的流动性', function () {
    var baseTime = Date.UTC(2026, 6, 21);
    var klines = [
        createKline(baseTime, 105, 99),
        createKline(baseTime + 5 * 60 * 1000, 106, 101),
        createKline(baseTime + 10 * 60 * 1000, 110, 105),
        createKline(baseTime + 15 * 60 * 1000, 111, 104)
    ];
    var analysis = {
        setups: [
            {
                type: 'LONG_SETUP',
                triggerIndex: 2,
                direction: 'BULLISH',
                reasons: []
            }
        ],
        fvgs: [
            {
                type: 'BULLISH_FVG',
                top: 110,
                bottom: 100,
                midpoint: 105,
                startIndex: 0,
                endIndex: 2
            }
        ],
        liquidity: {
            equalHighs: [
                {
                    type: 'EQUAL_HIGH',
                    price: 120,
                    index1: 0,
                    index2: 2
                },
                {
                    type: 'EQUAL_HIGH',
                    price: 110,
                    index1: 3,
                    index2: 4
                }
            ],
            equalLows: [],
            previousDayLevels: [],
            sweeps: []
        }
    };
    var entries =
        RunBacktest.createEntriesWithoutFutureLiquidity(
            analysis,
            klines
        );
    var result = BacktestEngine.analyze({
        entries: entries,
        klines: klines
    });

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].target, 120);
    assert.strictEqual(entries[0].status, 'ENTRY_TRIGGERED');
    assert.strictEqual(result.trades[0].status, 'OPEN');
});

console.log('\n' + testsPassed + ' tests passed.');
