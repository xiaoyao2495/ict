var assert = require('assert');
var Displacement = require('../indicators/displacement');

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

function createKline(open, high, low, close) {
    return {
        open: open,
        high: high,
        low: low,
        close: close
    };
}

test('Body Ratio 正确计算', function () {
    var klines = [
        createKline(100, 112, 98, 110)
    ];
    var result = Displacement.analyze(klines, 20);

    assert.strictEqual(result.bullish, true);
    assert.strictEqual(result.bearish, false);
    assert.strictEqual(result.bodyRatio, 10 / 14);
});

test('Bearish 方向正确识别', function () {
    var klines = [
        createKline(110, 112, 98, 100)
    ];
    var result = Displacement.analyze(klines, 20);

    assert.strictEqual(result.bullish, false);
    assert.strictEqual(result.bearish, true);
});

test('连续三根上涨 K 线形成 Bullish Momentum', function () {
    var klines = [
        createKline(100, 103, 99, 102),
        createKline(102, 105, 101, 104),
        createKline(104, 108, 103, 107)
    ];
    var result = Displacement.analyze(klines, 20);

    assert.strictEqual(result.momentum, true);
    assert.strictEqual(result.bullish, true);
});

test('方向不连续时不形成 Momentum', function () {
    var klines = [
        createKline(100, 103, 99, 102),
        createKline(102, 103, 99, 100),
        createKline(100, 105, 99, 104)
    ];
    var result = Displacement.analyze(klines, 20);

    assert.strictEqual(result.momentum, false);
});

test('True Range 超过 ATR 时识别 Expansion', function () {
    var klines = [
        createKline(100, 103, 98, 102),
        createKline(102, 115, 100, 114)
    ];
    var result = Displacement.analyze(klines, 10);

    assert.strictEqual(result.expansion, true);
});

test('没有传入 ATR 时自行计算 ATR', function () {
    var klines = [
        createKline(100, 106, 96, 102),
        createKline(102, 108, 98, 104)
    ];
    var atr = Displacement.calculateATR(klines, 14);
    var result = Displacement.analyze(klines);

    assert.strictEqual(atr, 10);
    assert.strictEqual(result.expansion, false);
});

test('Bullish Gap 正确识别', function () {
    var klines = [
        createKline(100, 105, 98, 103),
        createKline(103, 112, 102, 110),
        createKline(110, 115, 106, 114)
    ];
    var result = Displacement.analyze(klines, 20);

    assert.strictEqual(result.gap, true);
});

test('Bearish Gap 正确识别', function () {
    var klines = [
        createKline(110, 112, 105, 107),
        createKline(107, 108, 98, 100),
        createKline(100, 104, 95, 96)
    ];
    var result = Displacement.analyze(klines, 20);

    assert.strictEqual(result.gap, true);
});

test('价格区间重叠时不识别 Gap', function () {
    var klines = [
        createKline(100, 105, 98, 103),
        createKline(103, 108, 101, 106),
        createKline(106, 110, 104, 109)
    ];
    var result = Displacement.analyze(klines, 20);

    assert.strictEqual(result.gap, false);
});

test('Score 汇总各项判断', function () {
    var klines = [
        createKline(100, 103, 99, 102),
        createKline(103, 108, 102, 107),
        createKline(110, 121, 109, 120)
    ];
    var result = Displacement.analyze(klines, 5);

    assert.strictEqual(result.bodyRatio >= 0.65, true);
    assert.strictEqual(result.momentum, true);
    assert.strictEqual(result.expansion, true);
    assert.strictEqual(result.gap, true);
    assert.strictEqual(result.score, 4);
});

test('空数组返回统一默认对象', function () {
    assert.deepStrictEqual(
        Displacement.analyze([], 10),
        {
            bullish: false,
            bearish: false,
            bodyRatio: 0,
            momentum: false,
            expansion: false,
            gap: false,
            score: 0
        }
    );
});

console.log('\n' + testsPassed + ' tests passed.');
