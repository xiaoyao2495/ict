var assert = require('assert');
var BacktestEngine = require('../backtest/backtestEngine');
var ExitExperiment = require(
    '../backtest/exitManagementExperiment'
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

function kline(open, high, low, close) {
    return { open: open, high: high, low: low, close: close };
}

function longEntry(target) {
    return {
        type: 'LONG_ENTRY',
        status: 'ENTRY_TRIGGERED',
        entry: 100,
        stop: 90,
        target: target,
        setupIndex: 0,
        triggerIndex: 1
    };
}

test('A 与当前 Baseline 保守成交结果完全相同', function () {
    var entries = [longEntry(130)];
    var klines = [
        kline(100, 101, 99, 100),
        kline(100, 105, 95, 102),
        kline(102, 131, 99, 125)
    ];
    var baseline = BacktestEngine.analyze({
        entries: entries,
        klines: klines
    }).trades[0];
    var experimental = ExitExperiment.simulateEntryMode(
        entries[0],
        klines,
        ExitExperiment.MODES.A
    );

    assert.strictEqual(experimental.status, baseline.status);
    assert.strictEqual(experimental.r, baseline.r);
    assert.strictEqual(experimental.exitIndex, baseline.exitIndex);
    assert.strictEqual(experimental.entry, baseline.entry);
    assert.strictEqual(experimental.originalStop, baseline.stop);
});

test('C 在达到1R后的下一根开始移动到保本', function () {
    var entry = longEntry(150);
    var klines = [
        kline(100, 101, 99, 100),
        kline(100, 105, 95, 102),
        kline(102, 111, 95, 108),
        kline(108, 109, 99, 101),
        kline(101, 151, 100, 150)
    ];
    var result = ExitExperiment.simulateEntryMode(
        entry,
        klines,
        ExitExperiment.MODES.C
    );

    assert.strictEqual(result.protectedAt, 2);
    assert.strictEqual(result.exitIndex, 3);
    assert.strictEqual(result.exitReason, 'BREAKEVEN_STOP');
    assert.strictEqual(result.r, 0);
    assert.strictEqual(result.status, 'BREAKEVEN');
});

test('同根同时触发初始 Stop 和1R 时保守记为 Loss', function () {
    var result = ExitExperiment.simulateEntryMode(
        longEntry(150),
        [
            kline(100, 101, 99, 100),
            kline(100, 105, 95, 102),
            kline(102, 111, 89, 100)
        ],
        ExitExperiment.MODES.C
    );

    assert.strictEqual(result.status, 'LOSS');
    assert.strictEqual(result.r, -1);
    assert.strictEqual(result.protectedAt, null);
});

test('D 将2R腿和Liquidity腿按50%合并', function () {
    var result = ExitExperiment.simulateEntryMode(
        longEntry(150),
        [
            kline(100, 101, 99, 100),
            kline(100, 105, 95, 102),
            kline(102, 121, 95, 118),
            kline(118, 119, 89, 91)
        ],
        ExitExperiment.MODES.D
    );

    assert.strictEqual(result.legs[0].result.r, 2);
    assert.strictEqual(result.legs[1].result.r, -1);
    assert.strictEqual(result.r, 0.5);
    assert.strictEqual(result.status, 'WIN');
});

test('E 只在Expansion使用1R保护runner', function () {
    var entry = longEntry(150);
    var klines = [
        kline(100, 101, 99, 100),
        kline(100, 105, 95, 102),
        kline(102, 111, 95, 108),
        kline(108, 109, 99, 101),
        kline(101, 151, 100, 150)
    ];
    var expansion = ExitExperiment.simulateEntryMode(
        entry,
        klines,
        ExitExperiment.MODES.E,
        'EXPANSION'
    );
    var ranging = ExitExperiment.simulateEntryMode(
        entry,
        klines,
        ExitExperiment.MODES.E,
        'RANGING'
    );

    assert.strictEqual(expansion.r, 0);
    assert.strictEqual(ranging.r, 5);
    assert.strictEqual(expansion.regimeExit,
        'ONE_R_PROTECTION_RUNNER');
    assert.strictEqual(ranging.regimeExit, 'LIQUIDITY_TARGET');
});

test('统计包含Median Loss Max DD和连续亏损', function () {
    var values = [-1, 2, -1, -1, 3];
    var stats = ExitExperiment.calculateStats(
        values.map(function (r, index) {
            return {
                entryIndex: index,
                status: r > 0 ? 'WIN' : 'LOSS',
                r: r
            };
        })
    );

    assert.strictEqual(stats.totalR, 2);
    assert.strictEqual(stats.medianR, -1);
    assert.strictEqual(stats.medianLossR, -1);
    assert.strictEqual(stats.maxDrawdownR, 2);
    assert.strictEqual(stats.maxLosingStreak, 2);
});

test('运行全部退出模式不修改原 Entry 和 Sweep Stop', function () {
    var entries = [longEntry(150)];
    var klines = [
        kline(100, 101, 99, 100),
        kline(100, 105, 95, 102),
        kline(102, 121, 95, 118),
        kline(118, 151, 99, 150)
    ];
    var before = JSON.stringify(entries);
    var result = ExitExperiment.runModes(
        entries,
        klines,
        [{
            direction: 'LONG',
            setupIndex: 0,
            entryIndex: 1,
            regime: 'EXPANSION'
        }]
    );

    assert.strictEqual(JSON.stringify(entries), before);
    assert.strictEqual(entries[0].stop, 90);
    assert.strictEqual(result.A.trades[0].originalStop, 90);
    assert.strictEqual(result.B.trades[0].originalStop, 90);
    assert.strictEqual(result.C.trades[0].originalStop, 90);
    assert.strictEqual(result.D.trades[0].originalStop, 90);
    assert.strictEqual(result.E.trades[0].originalStop, 90);
});

console.log('\n' + testsPassed + ' tests passed.');
