var assert = require('assert');
var HTFContextAnalyzer = require(
    '../indicators/htfContextAnalyzer'
);

var testsPassed = 0;
var FIVE_MINUTES = 5 * 60 * 1000;

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

function kline(index, open, high, low, close) {
    var openTime = Date.UTC(2026, 0, 1) +
        index * FIVE_MINUTES;

    return {
        openTime: openTime,
        closeTime: openTime + FIVE_MINUTES - 1,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: 1
    };
}

function createSeries(length) {
    var result = [];
    var center;
    var open;
    var close;
    var i;

    for (i = 0; i < length; i++) {
        center = 100 + Math.sin(i / 18) * 12 + i * 0.01;
        open = center - Math.sin(i / 5);
        close = center + Math.cos(i / 7);
        result.push(kline(
            i,
            open,
            Math.max(open, close) + 2,
            Math.min(open, close) - 2,
            close
        ));
    }

    return result;
}

test('HTF 只聚合完整收盘 K线', function () {
    var klines = createSeries(12);

    assert.strictEqual(
        HTFContextAnalyzer.aggregateClosedKlines(
            klines.slice(0, 11),
            HTFContextAnalyzer.ONE_HOUR
        ).length,
        0
    );

    var aggregated =
        HTFContextAnalyzer.aggregateClosedKlines(
            klines,
            HTFContextAnalyzer.ONE_HOUR
        );

    assert.strictEqual(aggregated.length, 1);
    assert.strictEqual(aggregated[0].sourceStartIndex, 0);
    assert.strictEqual(aggregated[0].sourceEndIndex, 11);
    assert.strictEqual(aggregated[0].availableIndex, 11);
    assert.strictEqual(
        aggregated[0].closeTime,
        klines[11].closeTime
    );
});

test('未来 K线 不改变历史 Setup 的 HTF 标签', function () {
    var klines = createSeries(720);
    var setup = {
        type: 'LONG_SETUP',
        triggerIndex: 479,
        availableIndex: 479
    };
    var prefix = HTFContextAnalyzer.attachContexts(
        [setup],
        klines.slice(0, 480)
    )[0];
    var extended = HTFContextAnalyzer.attachContexts(
        [setup],
        klines
    )[0];

    assert.deepStrictEqual(
        extended.htfContext,
        prefix.htfContext
    );
    assert.strictEqual(
        extended.htfContext.h1.lastClosedBarTime <=
            klines[479].closeTime,
        true
    );
    assert.strictEqual(
        extended.htfContext.h4.lastClosedBarTime <=
            klines[479].closeTime,
        true
    );
});

test('PDH PDL 标签只使用前一完整 UTC 日', function () {
    var klines = [];
    var item;
    var i;

    for (i = 0; i < 577; i++) {
        item = kline(i, 100, 110, 90, 100);

        if (i >= 288 && i < 576) {
            item.high = i === 300 ? 200 : 150;
            item.low = i === 400 ? 80 : 90;
        }

        if (i === 576) {
            item.open = 110;
            item.high = 125;
            item.low = 105;
            item.close = 120;
        }

        klines.push(item);
    }

    var setup = {
        type: 'LONG_SETUP',
        triggerIndex: 576,
        availableIndex: 576
    };
    var context = HTFContextAnalyzer.attachContexts(
        [setup],
        klines
    )[0].htfContext.previousDay;

    assert.strictEqual(context.pdh, 200);
    assert.strictEqual(context.pdl, 80);
    assert.strictEqual(context.pdhDistance, 80);
    assert.strictEqual(context.pdlDistance, 40);
    assert.strictEqual(
        context.location,
        'INSIDE_PREVIOUS_DAY_RANGE'
    );
    assert.strictEqual(context.nearestLevel, 'PDL');
});

test('HTF Analyzer 只返回新标签且不修改原 Setup', function () {
    var setup = {
        type: 'SHORT_SETUP',
        triggerIndex: 11,
        availableIndex: 11
    };
    var result = HTFContextAnalyzer.attachContexts(
        [setup],
        createSeries(12)
    )[0];

    assert.strictEqual(setup.htfContext, undefined);
    assert.ok(result.htfContext);
    assert.strictEqual(result.type, setup.type);
    assert.strictEqual(
        result.htfContext.availableIndex,
        setup.availableIndex
    );
    assert.ok(result.htfContext.h4);
    assert.ok(result.htfContext.h1);
    assert.ok(result.htfContext.previousDay);
});

console.log('\n' + testsPassed + ' tests passed.');
