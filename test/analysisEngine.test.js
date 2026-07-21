var assert = require('assert');

var AnalysisEngine = require('../indicators/analysisEngine');
var EventAdapter = require('../indicators/eventAdapter');
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

function createKline(index, open, high, low, close) {
    var openTime = Date.UTC(2026, 6, 21) +
        index * 5 * 60 * 1000;

    return {
        openTime: openTime,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: 1,
        closeTime: openTime + 5 * 60 * 1000 - 1
    };
}

function hasEvent(events, type, indexField, index) {
    var i;

    for (i = 0; i < events.length; i++) {
        if (
            events[i].type === type &&
            events[i][indexField] === index
        ) {
            return true;
        }
    }

    return false;
}

function findEventByType(events, type) {
    var i;

    for (i = 0; i < events.length; i++) {
        if (events[i].type === type) {
            return events[i];
        }
    }

    return null;
}

function createLongScenario(breakMode) {
    var breakKline;

    if (breakMode === 'WICK_BREAK') {
        breakKline = createKline(26, 100, 106, 99, 104);
    } else if (breakMode === 'CLOSE_BREAK') {
        breakKline = createKline(
            26,
            104.8,
            106,
            99,
            105.2
        );
    } else {
        breakKline = createKline(
            26,
            100,
            106,
            99,
            105.8
        );
    }

    return [
        createKline(0, 105, 107, 104, 106),
        createKline(1, 106, 109, 103, 108),
        createKline(2, 108, 110, 102, 106),
        createKline(3, 106, 108, 101, 103),
        createKline(4, 103, 106, 100.5, 102),
        createKline(5, 102, 104, 100, 103),
        createKline(6, 102, 103, 101, 102.5),
        createKline(7, 102.5, 104, 102, 103),
        createKline(8, 103, 105, 101.5, 104),
        createKline(9, 103, 103, 101, 102),
        createKline(10, 102, 101, 100.5, 100.8),
        createKline(11, 99, 100, 94, 94),
        createKline(12, 95, 99, 95, 98),
        createKline(13, 98, 101, 96, 100),
        createKline(14, 100, 102, 97, 99),
        createKline(15, 99, 101, 95, 97),
        createKline(16, 97, 99, 94.5, 96),
        createKline(17, 96, 98, 94.05, 97),
        createKline(18, 97, 98, 95, 97.5),
        createKline(19, 97.5, 100, 96, 99),
        createKline(20, 99, 101, 97, 98),
        createKline(21, 98, 100, 96, 97),
        createKline(22, 97, 98, 94.5, 96),
        createKline(23, 96, 99, 93, 95),
        createKline(24, 95, 98, 94, 97),
        createKline(25, 97, 101, 96.5, 100),
        breakKline,
        createKline(27, 104, 105, 98, 100),
        createKline(28, 100, 104, 97, 99)
    ];
}

function createShortScenario(breakMode) {
    var breakKline;

    if (breakMode === 'WICK_BREAK') {
        breakKline = createKline(26, 100, 101, 94, 96);
    } else if (breakMode === 'CLOSE_BREAK') {
        breakKline = createKline(
            26,
            95.2,
            101,
            94,
            94.8
        );
    } else {
        breakKline = createKline(
            26,
            100,
            101,
            94,
            94.2
        );
    }

    return [
        createKline(0, 95, 96, 93, 94),
        createKline(1, 94, 95, 91, 92),
        createKline(2, 92, 94, 90, 93),
        createKline(3, 93, 96, 91, 95),
        createKline(4, 95, 98, 93, 97),
        createKline(5, 97, 100, 94, 98),
        createKline(6, 98, 99, 97, 98.5),
        createKline(7, 98, 98, 96, 97),
        createKline(8, 97, 99, 95, 98),
        createKline(9, 98, 99, 96, 98.5),
        createKline(10, 98.5, 100, 97, 99),
        createKline(11, 100, 106, 98, 106),
        createKline(12, 104, 104, 100, 102),
        createKline(13, 102, 102, 99, 100),
        createKline(14, 100, 101, 98, 99),
        createKline(15, 99, 102, 99, 101),
        createKline(16, 101, 104, 100, 103),
        createKline(17, 103, 105.95, 101, 104),
        createKline(18, 104, 104, 100, 101),
        createKline(19, 101, 102, 99.5, 100),
        createKline(20, 100, 101, 99, 100.5),
        createKline(21, 100.5, 102, 100, 101),
        createKline(22, 101, 104, 101, 103),
        createKline(23, 106, 107, 102, 105),
        createKline(24, 105, 106, 102, 103),
        createKline(25, 103, 104, 99, 100),
        breakKline,
        createKline(27, 96, 102, 95, 100),
        createKline(28, 100, 103, 96, 101)
    ];
}

test('analyzeMarket 返回统一对象结构', function () {
    var result = AnalysisEngine.analyzeMarket([]);

    assert.deepStrictEqual(Object.keys(result), [
        'swings',
        'structureEvents',
        'liquidity',
        'displacementEvents',
        'fvgs',
        'setups'
    ]);
    assert.deepStrictEqual(result.swings, []);
    assert.deepStrictEqual(result.structureEvents, []);
    assert.deepStrictEqual(result.displacementEvents, []);
    assert.deepStrictEqual(result.fvgs, []);
    assert.deepStrictEqual(result.setups, []);
    assert.deepStrictEqual(Object.keys(result.liquidity), [
        'equalHighs',
        'equalLows',
        'previousDayLevels',
        'sweeps'
    ]);
});

test('LONG_SETUP 完整链路', function () {
    var result = AnalysisEngine.analyzeMarket(
        createLongScenario()
    );

    assert.strictEqual(
        hasEvent(
            result.liquidity.sweeps,
            'SELL_SIDE_SWEEP',
            'index',
            23
        ),
        true
    );
    assert.strictEqual(
        hasEvent(
            result.structureEvents,
            'BULLISH_MSS',
            'breakIndex',
            26
        ),
        true
    );
    assert.strictEqual(
        hasEvent(
            result.displacementEvents,
            'BULLISH_DISPLACEMENT',
            'index',
            26
        ),
        true
    );
    assert.strictEqual(
        hasEvent(
            result.fvgs,
            'BULLISH_FVG',
            'endIndex',
            26
        ),
        true
    );
    assert.deepStrictEqual(result.setups, [
        {
            type: 'LONG_SETUP',
            triggerIndex: 26,
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

test('SHORT_SETUP 完整链路', function () {
    var result = AnalysisEngine.analyzeMarket(
        createShortScenario()
    );

    assert.strictEqual(
        hasEvent(
            result.liquidity.sweeps,
            'BUY_SIDE_SWEEP',
            'index',
            23
        ),
        true
    );
    assert.strictEqual(
        hasEvent(
            result.structureEvents,
            'BEARISH_MSS',
            'breakIndex',
            26
        ),
        true
    );
    assert.strictEqual(
        hasEvent(
            result.displacementEvents,
            'BEARISH_DISPLACEMENT',
            'index',
            26
        ),
        true
    );
    assert.strictEqual(
        hasEvent(
            result.fvgs,
            'BEARISH_FVG',
            'endIndex',
            26
        ),
        true
    );
    assert.deepStrictEqual(result.setups, [
        {
            type: 'SHORT_SETUP',
            triggerIndex: 26,
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

test('Wick 突破 Protected High 不产生 BULLISH_MSS', function () {
    var result = AnalysisEngine.analyzeMarket(
        createLongScenario('WICK_BREAK')
    );

    assert.strictEqual(
        findEventByType(
            result.structureEvents,
            'BULLISH_MSS'
        ),
        null
    );
});

test('Close 突破 Protected High 产生 BULLISH_MSS', function () {
    var result = AnalysisEngine.analyzeMarket(
        createLongScenario('CLOSE_BREAK')
    );
    var event = findEventByType(
        result.structureEvents,
        'BULLISH_MSS'
    );

    assert.ok(event);
    assert.strictEqual(event.breakIndex, 26);
    assert.strictEqual(event.breakType, 'CLOSE_BREAK');
});

test('Displacement Break 产生 BULLISH_MSS', function () {
    var result = AnalysisEngine.analyzeMarket(
        createLongScenario('DISPLACEMENT_BREAK')
    );
    var event = findEventByType(
        result.structureEvents,
        'BULLISH_MSS'
    );

    assert.ok(event);
    assert.strictEqual(event.breakIndex, 26);
    assert.strictEqual(
        event.breakType,
        'DISPLACEMENT_BREAK'
    );
});

test('Wick 跌破 Protected Low 不产生 BEARISH_MSS', function () {
    var result = AnalysisEngine.analyzeMarket(
        createShortScenario('WICK_BREAK')
    );

    assert.strictEqual(
        findEventByType(
            result.structureEvents,
            'BEARISH_MSS'
        ),
        null
    );
});

test('Close 跌破 Protected Low 产生 BEARISH_MSS', function () {
    var result = AnalysisEngine.analyzeMarket(
        createShortScenario('CLOSE_BREAK')
    );
    var event = findEventByType(
        result.structureEvents,
        'BEARISH_MSS'
    );

    assert.ok(event);
    assert.strictEqual(event.breakIndex, 26);
    assert.strictEqual(event.breakType, 'CLOSE_BREAK');
});

test('Displacement Break 产生 BEARISH_MSS', function () {
    var result = AnalysisEngine.analyzeMarket(
        createShortScenario('DISPLACEMENT_BREAK')
    );
    var event = findEventByType(
        result.structureEvents,
        'BEARISH_MSS'
    );

    assert.ok(event);
    assert.strictEqual(event.breakIndex, 26);
    assert.strictEqual(
        event.breakType,
        'DISPLACEMENT_BREAK'
    );
});

test('没有完整条件时 setups 为空', function () {
    var klines = [
        createKline(0, 100, 103, 99, 102),
        createKline(1, 102, 104, 100, 101),
        createKline(2, 101, 103, 99, 102),
        createKline(3, 102, 104, 100, 101),
        createKline(4, 101, 103, 99, 102)
    ];
    var result = AnalysisEngine.analyzeMarket(klines);

    assert.deepStrictEqual(result.setups, []);
});

test('displacement event 包含正确 index 和 type', function () {
    var klines = [
        createKline(0, 100, 102, 99, 101.5),
        createKline(1, 102, 105, 101, 104),
        createKline(2, 103, 109, 103, 108)
    ];
    var events = EventAdapter.createDisplacementEvents(klines);
    var event = events[events.length - 1];

    assert.ok(event);
    assert.strictEqual(event.type, 'BULLISH_DISPLACEMENT');
    assert.strictEqual(event.index, 2);
    assert.strictEqual(event.score >= 2, true);
    assert.strictEqual(typeof event.bodyRatio, 'number');
    assert.strictEqual(typeof event.momentum, 'boolean');
    assert.strictEqual(typeof event.expansion, 'boolean');
    assert.strictEqual(typeof event.gap, 'boolean');
});

test('score 足够但没有 expansion 不生成 displacement', function () {
    var klines = [
        createKline(0, 10, 100, 0, 90),
        createKline(1, 90, 105, 85, 101),
        createKline(2, 102, 110, 101, 109)
    ];
    var analysis = Displacement.analyze(klines);
    var events = EventAdapter.createDisplacementEvents(klines);

    assert.strictEqual(analysis.score >= 3, true);
    assert.strictEqual(analysis.expansion, false);
    assert.deepStrictEqual(events, []);
});

test('bodyRatio 不足不生成 displacement', function () {
    var klines = [
        createKline(0, 100, 102, 99, 101.5),
        createKline(1, 102, 105, 101, 104),
        createKline(2, 103, 120, 103, 110)
    ];
    var analysis = Displacement.analyze(klines);
    var events = EventAdapter.createDisplacementEvents(klines);

    assert.strictEqual(analysis.score >= 3, true);
    assert.strictEqual(analysis.expansion, true);
    assert.strictEqual(analysis.bodyRatio < 0.6, true);
    assert.deepStrictEqual(events, []);
});

console.log('\n' + testsPassed + ' tests passed.');
