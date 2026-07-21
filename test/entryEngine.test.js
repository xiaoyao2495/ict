var assert = require('assert');
var EntryEngine = require('../indicators/entryEngine');

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

function createLongInput(klines, liquidity) {
    return {
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
        klines: klines,
        liquidity: liquidity || {}
    };
}

function createShortInput(klines, liquidity) {
    return {
        setups: [
            {
                type: 'SHORT_SETUP',
                triggerIndex: 2,
                direction: 'BEARISH',
                reasons: []
            }
        ],
        fvgs: [
            {
                type: 'BEARISH_FVG',
                top: 110,
                bottom: 100,
                midpoint: 105,
                startIndex: 0,
                endIndex: 2
            }
        ],
        klines: klines,
        liquidity: liquidity || {}
    };
}

test('多头 FVG 回踩成交', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 106),
        createKline(112, 104)
    ]));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'LONG_ENTRY');
    assert.strictEqual(result[0].status, 'ENTRY_TRIGGERED');
    assert.strictEqual(result[0].entry, 105);
    assert.strictEqual(result[0].setupIndex, 2);
    assert.strictEqual(result[0].triggerIndex, 4);
});

test('空头 FVG 回踩成交', function () {
    var result = EntryEngine.analyze(createShortInput([
        createKline(110, 100),
        createKline(105, 98),
        createKline(100, 95),
        createKline(104, 96),
        createKline(106, 98)
    ]));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'SHORT_ENTRY');
    assert.strictEqual(result[0].status, 'ENTRY_TRIGGERED');
    assert.strictEqual(result[0].entry, 105);
    assert.strictEqual(result[0].setupIndex, 2);
    assert.strictEqual(result[0].triggerIndex, 4);
});

test('未回踩不能成交', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(116, 108),
        createKline(117, 106)
    ]));

    assert.strictEqual(result[0].status, 'SETUP_FORMED');
    assert.strictEqual(result[0].triggerIndex, null);
});

test('FVG 完全失效', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(112, 99)
    ]));

    assert.strictEqual(result[0].status, 'INVALIDATED');
    assert.strictEqual(result[0].triggerIndex, 3);
});

test('止损使用 FVG 完全失效边界', function () {
    var longResult = EntryEngine.analyze(
        createLongInput([])
    );
    var shortResult = EntryEngine.analyze(
        createShortInput([])
    );

    assert.strictEqual(longResult[0].stop, 100);
    assert.strictEqual(shortResult[0].stop, 110);
});

test('target 使用方向上最近流动性', function () {
    var longResult = EntryEngine.analyze(createLongInput([], {
        equalHighs: [
            { type: 'EQUAL_HIGH', price: 125 },
            { type: 'EQUAL_HIGH', price: 120 }
        ],
        previousDayLevels: [
            { type: 'PDH', price: 130 }
        ]
    }));
    var shortResult = EntryEngine.analyze(createShortInput([], {
        equalLows: [
            { type: 'EQUAL_LOW', price: 85 },
            { type: 'EQUAL_LOW', price: 90 }
        ],
        previousDayLevels: [
            { type: 'PDL', price: 80 }
        ]
    }));

    assert.strictEqual(longResult[0].target, 120);
    assert.strictEqual(shortResult[0].target, 90);
});

test('没有流动性目标时使用 2R', function () {
    var longResult = EntryEngine.analyze(
        createLongInput([])
    );
    var shortResult = EntryEngine.analyze(
        createShortInput([])
    );

    assert.strictEqual(longResult[0].target, 115);
    assert.strictEqual(shortResult[0].target, 95);
});

console.log('\n' + testsPassed + ' tests passed.');
