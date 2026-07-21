var assert = require('assert');
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

function createKline(high, low) {
    return {
        open: low,
        high: high,
        low: low,
        close: high
    };
}

function createLongEntry(triggerIndex) {
    return {
        type: 'LONG_ENTRY',
        status: 'ENTRY_TRIGGERED',
        entry: 100,
        stop: 95,
        target: 110,
        setupIndex: triggerIndex - 1,
        triggerIndex: triggerIndex
    };
}

function createShortEntry(triggerIndex) {
    return {
        type: 'SHORT_ENTRY',
        status: 'ENTRY_TRIGGERED',
        entry: 100,
        stop: 105,
        target: 90,
        setupIndex: triggerIndex - 1,
        triggerIndex: triggerIndex
    };
}

test('多头止盈', function () {
    var result = BacktestEngine.analyze({
        entries: [createLongEntry(1)],
        klines: [
            createKline(101, 99),
            createKline(110, 96)
        ]
    });

    assert.strictEqual(result.trades[0].status, 'WIN');
    assert.strictEqual(result.trades[0].exitIndex, 1);
    assert.strictEqual(result.trades[0].exitPrice, 110);
    assert.strictEqual(result.trades[0].r, 2);
});

test('多头止损且同 K线止损优先', function () {
    var result = BacktestEngine.analyze({
        entries: [createLongEntry(1)],
        klines: [
            createKline(101, 99),
            createKline(111, 94)
        ]
    });

    assert.strictEqual(result.trades[0].status, 'LOSS');
    assert.strictEqual(result.trades[0].exitIndex, 1);
    assert.strictEqual(result.trades[0].exitPrice, 95);
    assert.strictEqual(result.trades[0].r, -1);
});

test('空头止盈', function () {
    var result = BacktestEngine.analyze({
        entries: [createShortEntry(1)],
        klines: [
            createKline(101, 99),
            createKline(104, 90)
        ]
    });

    assert.strictEqual(result.trades[0].status, 'WIN');
    assert.strictEqual(result.trades[0].exitIndex, 1);
    assert.strictEqual(result.trades[0].exitPrice, 90);
    assert.strictEqual(result.trades[0].r, 2);
});

test('空头止损且同 K线止损优先', function () {
    var result = BacktestEngine.analyze({
        entries: [createShortEntry(1)],
        klines: [
            createKline(101, 99),
            createKline(106, 89)
        ]
    });

    assert.strictEqual(result.trades[0].status, 'LOSS');
    assert.strictEqual(result.trades[0].exitIndex, 1);
    assert.strictEqual(result.trades[0].exitPrice, 105);
    assert.strictEqual(result.trades[0].r, -1);
});

test('未触发止损或止盈时保持 OPEN', function () {
    var result = BacktestEngine.analyze({
        entries: [createLongEntry(1)],
        klines: [
            createKline(101, 99),
            createKline(105, 96),
            createKline(108, 97)
        ]
    });

    assert.strictEqual(result.trades[0].status, 'OPEN');
    assert.strictEqual(result.trades[0].exitIndex, null);
    assert.strictEqual(result.trades[0].exitPrice, null);
    assert.strictEqual(result.trades[0].r, null);
    assert.deepStrictEqual(result.stats, {
        total: 0,
        win: 0,
        loss: 0,
        winRate: 0,
        avgR: 0
    });
});

test('多笔交易统计', function () {
    var result = BacktestEngine.analyze({
        entries: [
            createLongEntry(0),
            createLongEntry(1),
            createShortEntry(2),
            createShortEntry(3)
        ],
        klines: [
            createKline(110, 99),
            createKline(101, 95),
            createKline(101, 90),
            createKline(105, 99)
        ]
    });

    assert.strictEqual(result.trades.length, 4);
    assert.deepStrictEqual(result.stats, {
        total: 4,
        win: 2,
        loss: 2,
        winRate: 50,
        avgR: 0.5
    });
});

test('未成交 Entry 不进入回测', function () {
    var entry = createLongEntry(1);

    entry.status = 'SETUP_FORMED';

    assert.deepStrictEqual(
        BacktestEngine.analyze({
            entries: [entry],
            klines: []
        }),
        {
            trades: [],
            stats: {
                total: 0,
                win: 0,
                loss: 0,
                winRate: 0,
                avgR: 0
            }
        }
    );
});

console.log('\n' + testsPassed + ' tests passed.');
