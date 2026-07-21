var assert = require('assert');
var Liquidity = require('../indicators/liquidity');

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

function createKline(day, hour, high, low, close) {
    return {
        openTime: Date.UTC(2026, 6, day, hour),
        open: close,
        high: high,
        low: low,
        close: close,
        volume: 1,
        closeTime: Date.UTC(2026, 6, day, hour + 1) - 1
    };
}

function findByType(items, type) {
    var i;

    for (i = 0; i < items.length; i++) {
        if (items[i].type === type) {
            return items[i];
        }
    }

    return null;
}

test('Equal High 成功识别', function () {
    var swings = [
        { type: 'HIGH', price: 100, index: 1 },
        { type: 'LOW', price: 90, index: 2 },
        { type: 'HIGH', price: 100.05, index: 3 }
    ];
    var result = Liquidity.findEqualHighs(swings);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'EQUAL_HIGH');
    assert.strictEqual(result[0].index1, 1);
    assert.strictEqual(result[0].index2, 3);
    assert.strictEqual(result[0].price, 100.025);
});

test('Equal Low 成功识别', function () {
    var swings = [
        { type: 'LOW', price: 100, index: 1 },
        { type: 'HIGH', price: 110, index: 2 },
        { type: 'LOW', price: 99.95, index: 3 }
    ];
    var result = Liquidity.findEqualLows(swings);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'EQUAL_LOW');
    assert.strictEqual(result[0].index1, 1);
    assert.strictEqual(result[0].index2, 3);
    assert.strictEqual(result[0].price, 99.975);
});

test('超过 0.1% 不识别为 Equal Level', function () {
    var swings = [
        { type: 'HIGH', price: 100, index: 1 },
        { type: 'HIGH', price: 100.2, index: 2 },
        { type: 'LOW', price: 90, index: 3 },
        { type: 'LOW', price: 89.8, index: 4 }
    ];

    assert.strictEqual(
        Liquidity.findEqualHighs(swings).length,
        0
    );
    assert.strictEqual(
        Liquidity.findEqualLows(swings).length,
        0
    );
});

test('正确计算 PDH', function () {
    var klines = [
        createKline(20, 0, 105, 95, 100),
        createKline(20, 12, 110, 96, 108),
        createKline(21, 0, 108, 98, 104)
    ];
    var levels = Liquidity.findPreviousDayLevels(klines);
    var pdh = findByType(levels, 'PDH');

    assert.ok(pdh);
    assert.strictEqual(pdh.price, 110);
    assert.strictEqual(pdh.index, 1);
});

test('正确计算 PDL', function () {
    var klines = [
        createKline(20, 0, 105, 95, 100),
        createKline(20, 12, 110, 90, 108),
        createKline(21, 0, 108, 98, 104)
    ];
    var levels = Liquidity.findPreviousDayLevels(klines);
    var pdl = findByType(levels, 'PDL');

    assert.ok(pdl);
    assert.strictEqual(pdl.price, 90);
    assert.strictEqual(pdl.index, 1);
});

test('Buy Side Sweep', function () {
    var klines = [
        createKline(21, 0, 99, 95, 98),
        createKline(21, 1, 101, 97, 99)
    ];
    var levels = [
        {
            direction: 'BUY_SIDE',
            price: 100,
            activeFrom: 0
        }
    ];
    var result = Liquidity.findLiquiditySweeps(
        klines,
        levels
    );

    assert.deepStrictEqual(result, [
        {
            type: 'BUY_SIDE_SWEEP',
            price: 100,
            index: 1
        }
    ]);
});

test('Sell Side Sweep', function () {
    var klines = [
        createKline(21, 0, 105, 101, 102),
        createKline(21, 1, 103, 99, 101)
    ];
    var levels = [
        {
            direction: 'SELL_SIDE',
            price: 100,
            activeFrom: 0
        }
    ];
    var result = Liquidity.findLiquiditySweeps(
        klines,
        levels
    );

    assert.deepStrictEqual(result, [
        {
            type: 'SELL_SIDE_SWEEP',
            price: 100,
            index: 1
        }
    ]);
});

test('流动性位置形成之前不能被 Sweep', function () {
    var swings = [
        { type: 'HIGH', price: 100, index: 2 },
        { type: 'LOW', price: 90, index: 3 },
        { type: 'HIGH', price: 100.05, index: 4 }
    ];
    var klines = [
        createKline(21, 0, 99, 95, 98),
        createKline(21, 1, 101, 97, 99),
        createKline(21, 2, 100, 96, 99),
        createKline(21, 3, 98, 90, 95),
        createKline(21, 4, 100.05, 96, 99),
        createKline(21, 5, 100, 96, 99)
    ];
    var result = Liquidity.analyze(swings, klines);

    assert.strictEqual(result.equalHighs.length, 1);
    assert.strictEqual(result.sweeps.length, 0);
});

test('一个 Liquidity Level 只记录第一次 Sweep', function () {
    var klines = [
        createKline(21, 0, 99, 95, 98),
        createKline(21, 1, 101, 97, 99),
        createKline(21, 2, 102, 98, 99)
    ];
    var levels = [
        {
            direction: 'BUY_SIDE',
            price: 100,
            activeFrom: 0
        }
    ];
    var result = Liquidity.findLiquiditySweeps(
        klines,
        levels
    );

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].index, 1);
});

console.log('\n' + testsPassed + ' tests passed.');
