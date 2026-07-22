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
        setups: [
            {
                type: 'LONG_SETUP',
                triggerIndex: 2,
                availableIndex: 2,
                direction: 'BULLISH',
                reasons: [],
                sweep: {
                    type: 'SELL_SIDE_SWEEP',
                    extreme: 100,
                    index: 0,
                    availableIndex: 0
                },
                mss: {
                    type: 'BULLISH_MSS',
                    newProtectedLow: 100,
                    breakIndex: 1,
                    availableIndex: 1
                },
                fvg: fvg,
                sweepExtreme: 100,
                structureInvalidationLevel: 100
            }
        ],
        fvgs: [fvg],
        klines: klines,
        liquidity: liquidity || {},
        structureEvents: []
    };
}

function createShortInput(klines, liquidity) {
    var fvg = {
        type: 'BEARISH_FVG',
        top: 110,
        bottom: 100,
        midpoint: 105,
        startIndex: 0,
        endIndex: 2,
        availableIndex: 2
    };

    return {
        setups: [
            {
                type: 'SHORT_SETUP',
                triggerIndex: 2,
                availableIndex: 2,
                direction: 'BEARISH',
                reasons: [],
                sweep: {
                    type: 'BUY_SIDE_SWEEP',
                    extreme: 110,
                    index: 0,
                    availableIndex: 0
                },
                mss: {
                    type: 'BEARISH_MSS',
                    newProtectedHigh: 110,
                    breakIndex: 1,
                    availableIndex: 1
                },
                fvg: fvg,
                sweepExtreme: 110,
                structureInvalidationLevel: 110
            }
        ],
        fvgs: [fvg],
        klines: klines,
        liquidity: liquidity || {},
        structureEvents: []
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

test('LONG 同根穿越失效边界仍触发 Entry', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(112, 99)
    ]));

    assert.strictEqual(result[0].status, 'ENTRY_TRIGGERED');
    assert.strictEqual(result[0].triggerIndex, 3);
    assert.strictEqual(result[0].target, 115);
});

test('SHORT 同根穿越失效边界仍触发 Entry', function () {
    var result = EntryEngine.analyze(createShortInput([
        createKline(110, 100),
        createKline(105, 98),
        createKline(100, 95),
        createKline(111, 98)
    ]));

    assert.strictEqual(result[0].status, 'ENTRY_TRIGGERED');
    assert.strictEqual(result[0].triggerIndex, 3);
    assert.strictEqual(result[0].target, 95);
});

test('止损使用 Setup 保存的 Sweep extreme', function () {
    var longResult = EntryEngine.analyze(
        createLongInput([])
    );
    var shortResult = EntryEngine.analyze(
        createShortInput([])
    );

    assert.strictEqual(longResult[0].stop, 100);
    assert.strictEqual(shortResult[0].stop, 110);
});

test('Entry 时仍 ACTIVE 的最近 Target 可以使用', function () {
    var longResult = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 106),
        createKline(112, 104)
    ], {
        equalHighs: [
            {
                type: 'EQUAL_HIGH',
                price: 125,
                activeFrom: 2,
                consumedAt: null,
                status: 'ACTIVE'
            },
            {
                type: 'EQUAL_HIGH',
                price: 120,
                activeFrom: 2,
                consumedAt: 5,
                status: 'CONSUMED'
            }
        ],
        previousDayLevels: [
            {
                type: 'PDH',
                price: 130,
                activeFrom: 2,
                consumedAt: null,
                status: 'ACTIVE'
            }
        ]
    }));
    var shortResult = EntryEngine.analyze(createShortInput([
        createKline(110, 100),
        createKline(105, 98),
        createKline(100, 95),
        createKline(104, 96),
        createKline(106, 98)
    ], {
        equalLows: [
            {
                type: 'EQUAL_LOW',
                price: 85,
                activeFrom: 2,
                consumedAt: null,
                status: 'ACTIVE'
            },
            {
                type: 'EQUAL_LOW',
                price: 90,
                activeFrom: 2,
                consumedAt: 5,
                status: 'CONSUMED'
            }
        ],
        previousDayLevels: [
            {
                type: 'PDL',
                price: 80,
                activeFrom: 2,
                consumedAt: null,
                status: 'ACTIVE'
            }
        ]
    }));

    assert.strictEqual(longResult[0].target, 120);
    assert.strictEqual(longResult[0].targetSource, 'LIQUIDITY');
    assert.strictEqual(shortResult[0].target, 90);
    assert.strictEqual(shortResult[0].targetSource, 'LIQUIDITY');
});

test('Setup 的有效 Target 在 Entry 前被获取后过期', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(121, 106),
        createKline(112, 104)
    ], {
        equalHighs: [
            {
                type: 'EQUAL_HIGH',
                price: 120,
                activeFrom: 2,
                consumedAt: 3,
                status: 'CONSUMED'
            }
        ]
    }));

    assert.strictEqual(result[0].triggerIndex, null);
    assert.strictEqual(result[0].status, 'EXPIRED_TARGET_TAKEN');
    assert.strictEqual(result[0].invalidatedAt, 3);
    assert.strictEqual(
        result[0].invalidationReason,
        'EXPIRED_TARGET_TAKEN'
    );
});

test('已 CONSUMED 的 Equal High 和 Low 不可重复使用', function () {
    var longResult = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(121, 106),
        createKline(112, 104)
    ], {
        equalHighs: [{
            type: 'EQUAL_HIGH',
            price: 120,
            activeFrom: 2,
            consumedAt: 1,
            status: 'CONSUMED'
        }]
    }));
    var shortResult = EntryEngine.analyze(createShortInput([
        createKline(110, 100),
        createKline(105, 98),
        createKline(100, 95),
        createKline(104, 89),
        createKline(106, 98)
    ], {
        equalLows: [{
            type: 'EQUAL_LOW',
            price: 90,
            activeFrom: 2,
            consumedAt: 1,
            status: 'CONSUMED'
        }]
    }));

    assert.strictEqual(longResult[0].target, 115);
    assert.strictEqual(shortResult[0].target, 95);
});

test('PDH 在下一交易日 activeFrom 前不可用', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 106),
        createKline(112, 104)
    ], {
        previousDayLevels: [{
            type: 'PDH',
            price: 120,
            activeFrom: 5,
            consumedAt: null,
            status: 'FORMED'
        }]
    }));

    assert.strictEqual(result[0].triggerIndex, 4);
    assert.strictEqual(result[0].target, 115);
});

test('LONG 不选择 Entry 下方 Target', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 106),
        createKline(112, 104)
    ], {
        equalHighs: [{
            type: 'EQUAL_HIGH',
            price: 104,
            activeFrom: 2,
            consumedAt: null,
            status: 'ACTIVE'
        }]
    }));

    assert.strictEqual(result[0].target, 115);
});

test('SHORT 不选择 Entry 上方 Target', function () {
    var result = EntryEngine.analyze(createShortInput([
        createKline(110, 100),
        createKline(105, 98),
        createKline(100, 95),
        createKline(104, 96),
        createKline(106, 98)
    ], {
        equalLows: [{
            type: 'EQUAL_LOW',
            price: 106,
            activeFrom: 2,
            consumedAt: null,
            status: 'ACTIVE'
        }]
    }));

    assert.strictEqual(result[0].target, 95);
});

test('没有有效流动性 Target 时使用 2R', function () {
    var longResult = EntryEngine.analyze(
        createLongInput([
            createKline(110, 100),
            createKline(112, 105),
            createKline(115, 110),
            createKline(114, 106),
            createKline(112, 104)
        ])
    );
    var shortResult = EntryEngine.analyze(
        createShortInput([
            createKline(110, 100),
            createKline(105, 98),
            createKline(100, 95),
            createKline(104, 96),
            createKline(106, 98)
        ])
    );

    assert.strictEqual(longResult[0].target, 115);
    assert.strictEqual(longResult[0].targetSource, 'FALLBACK_2R');
    assert.strictEqual(shortResult[0].target, 95);
    assert.strictEqual(shortResult[0].targetSource, 'FALLBACK_2R');
});

test('LONG 几何无效时在 Setup 形成时失效', function () {
    var input = createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 104)
    ]);

    input.setups[0].sweepExtreme = 106;

    var result = EntryEngine.analyze(input);

    assert.strictEqual(
        result[0].status,
        'INVALIDATED_AT_FORMATION'
    );
    assert.strictEqual(result[0].invalidatedAt, 2);
    assert.strictEqual(result[0].setupAgeBars, 0);
});

test('SHORT 几何无效时在 Setup 形成时失效', function () {
    var input = createShortInput([
        createKline(110, 100),
        createKline(105, 98),
        createKline(100, 95),
        createKline(106, 98)
    ]);

    input.setups[0].structureInvalidationLevel = 104;

    var result = EntryEngine.analyze(input);

    assert.strictEqual(
        result[0].status,
        'INVALIDATED_AT_FORMATION'
    );
    assert.strictEqual(result[0].invalidatedAt, 2);
});

test('等待期间出现 available 的反向 MSS 后失效', function () {
    var input = createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 106),
        createKline(112, 104)
    ]);

    input.structureEvents = [{
        type: 'BEARISH_MSS',
        breakIndex: 2,
        availableIndex: 3
    }];

    var result = EntryEngine.analyze(input);

    assert.strictEqual(
        result[0].status,
        'INVALIDATED_OPPOSITE_MSS'
    );
    assert.strictEqual(result[0].invalidatedAt, 3);
    assert.strictEqual(result[0].setupAgeBars, 1);
});

test('Entry 与 Sweep Stop 同根时仍生成 Entry', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(112, 99)
    ]));

    assert.strictEqual(result[0].status, 'ENTRY_TRIGGERED');
    assert.strictEqual(result[0].triggerIndex, 3);
    assert.strictEqual(result[0].stop, 100);
    assert.strictEqual(result[0].setupAgeBars, 1);
    assert.strictEqual(result[0].invalidatedAt, null);
});

test('未成交 Setup 记录当前 setupAgeBars', function () {
    var result = EntryEngine.analyze(createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(116, 108),
        createKline(117, 106)
    ]));

    assert.strictEqual(result[0].status, 'SETUP_FORMED');
    assert.strictEqual(result[0].setupAgeBars, 2);
    assert.strictEqual(result[0].invalidationReason, null);
});

test('默认 Entry 模式保持 FVG_MIDPOINT baseline', function () {
    var input = createLongInput([
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 106),
        createKline(112, 104)
    ]);
    var baseline = EntryEngine.analyze(input)[0];

    input.entryMode = 'FVG_MIDPOINT';

    var explicit = EntryEngine.analyze(input)[0];

    assert.strictEqual(baseline.entryMode, 'FVG_MIDPOINT');
    assert.strictEqual(baseline.entry, explicit.entry);
    assert.strictEqual(
        baseline.triggerIndex,
        explicit.triggerIndex
    );
    assert.strictEqual(baseline.target, explicit.target);
});

test('LONG 三种 FVG 深度使用不同 Entry 价格和触发时间', function () {
    var klines = [
        createKline(110, 100),
        createKline(112, 105),
        createKline(115, 110),
        createKline(114, 109),
        createKline(112, 104),
        createKline(110, 102)
    ];
    var edgeInput = createLongInput(klines);
    var midpointInput = createLongInput(klines);
    var deepInput = createLongInput(klines);

    edgeInput.entryMode = 'FVG_EDGE';
    midpointInput.entryMode = 'FVG_MIDPOINT';
    deepInput.entryMode = 'FVG_75_PERCENT';

    var edge = EntryEngine.analyze(edgeInput)[0];
    var midpoint = EntryEngine.analyze(midpointInput)[0];
    var deep = EntryEngine.analyze(deepInput)[0];

    assert.strictEqual(edge.entry, 110);
    assert.strictEqual(edge.triggerIndex, 3);
    assert.strictEqual(midpoint.entry, 105);
    assert.strictEqual(midpoint.triggerIndex, 4);
    assert.strictEqual(deep.entry, 102.5);
    assert.strictEqual(deep.triggerIndex, 5);
});

test('SHORT 三种 FVG 深度使用对称 Entry 价格', function () {
    assert.strictEqual(
        EntryEngine.getEntryPrice(
            'SHORT',
            { top: 110, bottom: 100, midpoint: 105 },
            'FVG_EDGE'
        ),
        100
    );
    assert.strictEqual(
        EntryEngine.getEntryPrice(
            'SHORT',
            { top: 110, bottom: 100, midpoint: 105 },
            'FVG_MIDPOINT'
        ),
        105
    );
    assert.strictEqual(
        EntryEngine.getEntryPrice(
            'SHORT',
            { top: 110, bottom: 100, midpoint: 105 },
            'FVG_75_PERCENT'
        ),
        107.5
    );
});

console.log('\n' + testsPassed + ' tests passed.');
