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

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'LONG_SETUP');
    assert.strictEqual(result[0].triggerIndex, 4);
    assert.strictEqual(result[0].availableIndex, 4);
    assert.strictEqual(result[0].sweep.type, 'SELL_SIDE_SWEEP');
    assert.strictEqual(result[0].mss.type, 'BULLISH_MSS');
    assert.strictEqual(
        result[0].displacement.type,
        'BULLISH_DISPLACEMENT'
    );
    assert.strictEqual(result[0].fvg.type, 'BULLISH_FVG');
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

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'SHORT_SETUP');
    assert.strictEqual(result[0].triggerIndex, 13);
    assert.strictEqual(result[0].availableIndex, 13);
    assert.strictEqual(result[0].sweep.type, 'BUY_SIDE_SWEEP');
    assert.strictEqual(result[0].mss.type, 'BEARISH_MSS');
    assert.strictEqual(
        result[0].displacement.type,
        'BEARISH_DISPLACEMENT'
    );
    assert.strictEqual(result[0].fvg.type, 'BEARISH_FVG');
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

test('事件按 availableIndex 合并排序', function () {
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

test('尚未 available 的 MSS 不能参与 Setup', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            {
                type: 'BULLISH_MSS',
                breakIndex: 2,
                availableIndex: 10
            }
        ],
        liquidityEvents: [
            {
                type: 'SELL_SIDE_SWEEP',
                index: 1,
                availableIndex: 1
            }
        ],
        displacementEvents: [
            {
                type: 'BULLISH_DISPLACEMENT',
                index: 3,
                availableIndex: 3
            }
        ],
        fvgEvents: [
            {
                type: 'BULLISH_FVG',
                endIndex: 4,
                availableIndex: 4
            }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('事件距离使用 availableIndex', function () {
    var result = SetupEngine.analyze(createInput({
        structureEvents: [
            {
                type: 'BULLISH_MSS',
                breakIndex: 2,
                availableIndex: 10
            }
        ],
        liquidityEvents: [
            {
                type: 'SELL_SIDE_SWEEP',
                index: 1,
                availableIndex: 1
            }
        ],
        displacementEvents: [
            {
                type: 'BULLISH_DISPLACEMENT',
                index: 3,
                availableIndex: 17
            }
        ],
        fvgEvents: [
            {
                type: 'BULLISH_FVG',
                endIndex: 18,
                availableIndex: 18
            }
        ]
    }));

    assert.deepStrictEqual(result, []);
});

test('Setup 保存完整事件链和失效边界快照', function () {
    var sweep = {
        type: 'SELL_SIDE_SWEEP',
        index: 1,
        availableIndex: 1,
        extreme: 90
    };
    var mss = {
        type: 'BULLISH_MSS',
        breakIndex: 2,
        availableIndex: 2,
        newProtectedLow: 95
    };
    var displacement = {
        type: 'BULLISH_DISPLACEMENT',
        index: 3,
        availableIndex: 3
    };
    var fvg = {
        type: 'BULLISH_FVG',
        top: 110,
        bottom: 100,
        midpoint: 105,
        endIndex: 4,
        availableIndex: 4
    };
    var result = SetupEngine.analyze(createInput({
        structureEvents: [mss],
        liquidityEvents: [sweep],
        displacementEvents: [displacement],
        fvgEvents: [fvg]
    }));

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].sweep, sweep);
    assert.strictEqual(result[0].mss, mss);
    assert.strictEqual(result[0].displacement, displacement);
    assert.strictEqual(result[0].fvg, fvg);
    assert.strictEqual(result[0].sweepExtreme, 90);
    assert.strictEqual(
        result[0].structureInvalidationLevel,
        95
    );
    assert.strictEqual(result[0].fvgMidpoint, 105);
    assert.strictEqual(result[0].fvgTop, 110);
    assert.strictEqual(result[0].fvgBottom, 100);
    assert.strictEqual(result[0].formationValid, true);
});

console.log('\n' + testsPassed + ' tests passed.');
