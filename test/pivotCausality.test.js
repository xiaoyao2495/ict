var assert = require('assert');
var Pivot = require('../indicators/pivot');
var Swing = require('../indicators/swing');

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

function createKline(index, high, low) {
    return {
        openTime: index,
        open: low,
        high: high,
        low: low,
        close: high
    };
}

function createPivotScenario() {
    return [
        createKline(0, 5, 1),
        createKline(1, 7, 2),
        createKline(2, 10, 3),
        createKline(3, 8, 2),
        createKline(4, 6, 1)
    ];
}

test('right=2 的 Pivot 在 extremeIndex 当时不可用', function () {
    var klines = createPivotScenario();

    assert.deepStrictEqual(
        Pivot.findPivots(klines.slice(0, 3), 2, 2),
        []
    );
    assert.deepStrictEqual(
        Pivot.findPivots(klines.slice(0, 4), 2, 2),
        []
    );
});

test('right=2 的 Pivot 两根后才 available', function () {
    var pivots = Pivot.findPivots(
        createPivotScenario(),
        2,
        2
    );
    var pivot = pivots[0];

    assert.strictEqual(pivots.length, 1);
    assert.strictEqual(pivot.index, 2);
    assert.strictEqual(pivot.extremeIndex, 2);
    assert.strictEqual(pivot.confirmationIndex, 4);
    assert.strictEqual(pivot.availableIndex, 4);
});

test('Swing 保留 Pivot 的发生和确认时间', function () {
    var pivots = Pivot.findPivots(
        createPivotScenario(),
        2,
        2
    );
    var swing = Swing.filterSwings(pivots)[0];

    assert.strictEqual(swing.index, 2);
    assert.strictEqual(swing.extremeIndex, 2);
    assert.strictEqual(swing.confirmationIndex, 4);
    assert.strictEqual(swing.availableIndex, 4);
});

console.log('\n' + testsPassed + ' tests passed.');
