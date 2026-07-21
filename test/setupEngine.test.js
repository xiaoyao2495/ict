var assert = require('assert');
var SetupEngine = require('../indicators/setupEngine');

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

function createInput(events) {
    return {
        structureEvents: events.structureEvents || [],
        liquidityEvents: events.liquidityEvents || [],
        displacementEvents:
            events.displacementEvents || [],
        fvgEvents: events.fvgEvents || []
    };
}

test('合法距离内仍生成有效 LONG_SETUP', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', breakIndex: 2 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 3 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 4 }
        ]
    }));

    assert.deepStrictEqual(result, [
        {
            type: 'LONG_SETUP',
            triggerIndex: 4,
            direction: 'BULLISH',
            reasons: [
                'SELL_SIDE_SWEEP',
                'BULLISH_MSS',
                'BULLISH_DISPLACEMENT',
                'BULLISH_FVG'
            ]
        }
    ]);
});

test('合法距离内仍生成有效 SHORT_SETUP', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BEARISH_MSS', index: 11 }
        ],
        liquidityEvents: [
            { type: 'BUY_SIDE_SWEEP', index: 10 }
        ],
        displacementEvents: [
            { type: 'BEARISH_DISPLACEMENT', index: 12 }
        ],
        fvgEvents: [
            { type: 'BEARISH_FVG', endIndex: 13 }
        ]
    }));

    assert.deepStrictEqual(result, [
        {
            type: 'SHORT_SETUP',
            triggerIndex: 13,
            direction: 'BEARISH',
            reasons: [
                'BUY_SIDE_SWEEP',
                'BEARISH_MSS',
                'BEARISH_DISPLACEMENT',
                'BEARISH_FVG'
            ]
        }
    ]);
});

test('顺序错误时不产生 Setup', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 1 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 2 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 3 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 4 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('缺少 MSS 时不产生 Setup', function () {
    var result = SetupEngine.analyze(createInput({
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 2 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 3 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('缺少 Sweep 时不产生 Setup', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 2 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 3 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('缺少 Displacement 时不产生 Setup', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 2 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 3 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('缺少 FVG 时不产生 Setup', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 2 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 3 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('Sweep 和 MSS 距离过远', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 14 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 15 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 16 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('MSS 和 Displacement 距离过远', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 10 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 17 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 18 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('Displacement 和 FVG 距离过远', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 2 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 3 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 7 }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('多个 Setup 连续出现', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            { type: 'BEARISH_MSS', index: 6 },
            { type: 'BULLISH_MSS', index: 2 }
        ],
        liquidityEvents: [
            { type: 'BUY_SIDE_SWEEP', index: 5 },
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BEARISH_DISPLACEMENT', index: 7 },
            { type: 'BULLISH_DISPLACEMENT', index: 3 }
        ],
        fvgEvents: [
            { type: 'BEARISH_FVG', endIndex: 8 },
            { type: 'BULLISH_FVG', endIndex: 4 }
        ]
    }));

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].type, 'LONG_SETUP');
    assert.strictEqual(result[0].triggerIndex, 4);
    assert.strictEqual(result[1].type, 'SHORT_SETUP');
    assert.strictEqual(result[1].triggerIndex, 8);
});

test('事件按 index 合并排序', function () {
    var events = SetupEngine.mergeEvents(createInput({
        structureEvents: [
            { type: 'BULLISH_MSS', index: 2 }
        ],
        liquidityEvents: [
            { type: 'SELL_SIDE_SWEEP', index: 1 }
        ],
        displacementEvents: [
            { type: 'BULLISH_DISPLACEMENT', index: 3 }
        ],
        fvgEvents: [
            { type: 'BULLISH_FVG', endIndex: 4 }
        ]
    }));

    assert.deepStrictEqual(
        events.map(function (event) {
            return event.type;
        }),
        [
            'SELL_SIDE_SWEEP',
            'BULLISH_MSS',
            'BULLISH_DISPLACEMENT',
            'BULLISH_FVG'
        ]
    );
});

console.log('\n' + testsPassed + ' tests passed.');
