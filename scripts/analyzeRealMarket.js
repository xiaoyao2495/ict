var Binance = require('../api/binance');
var AnalysisEngine = require('../indicators/analysisEngine');

function getEventIndex(event) {
    if (typeof event.index === 'number') {
        return event.index;
    }

    if (typeof event.breakIndex === 'number') {
        return event.breakIndex;
    }

    if (typeof event.endIndex === 'number') {
        return event.endIndex;
    }

    if (typeof event.triggerIndex === 'number') {
        return event.triggerIndex;
    }

    return null;
}

function getEventTime(klines, index) {
    if (
        index === null ||
        !klines[index] ||
        typeof klines[index].openTime !== 'number'
    ) {
        return null;
    }

    return klines[index].openTime;
}

function formatUtcTime(time) {
    return time === null
        ? null
        : new Date(time).toISOString();
}

function formatLocalTime(time) {
    return time === null
        ? null
        : new Date(time).toLocaleString();
}

function appendEvents(result, events, klines, filter) {
    var event;
    var index;
    var time;
    var i;

    for (i = 0; i < events.length; i++) {
        event = events[i];

        if (filter && !filter(event)) {
            continue;
        }

        index = getEventIndex(event);
        time = getEventTime(klines, index);

        result.push({
            time: time,
            type: event.type,
            price: typeof event.price === 'number'
                ? event.price
                : null,
            index: index,
            score: typeof event.score === 'number'
                ? event.score
                : null,
            event: event
        });
    }
}

function getKeyEvents(analysis, klines) {
    var result = [];

    appendEvents(
        result,
        analysis.liquidity.sweeps,
        klines
    );

    appendEvents(
        result,
        analysis.structureEvents,
        klines,
        function (event) {
            return event.type.indexOf('_MSS') !== -1;
        }
    );

    appendEvents(
        result,
        analysis.displacementEvents,
        klines
    );

    appendEvents(result, analysis.fvgs, klines);
    appendEvents(result, analysis.setups, klines);

    result.sort(function (event1, event2) {
        if (event1.index === event2.index) {
            return event1.type < event2.type ? -1 : 1;
        }

        return event1.index - event2.index;
    });

    return result;
}

function printSummary(analysis) {
    console.log('\n===== Analysis Summary =====');
    console.log('Swing count:', analysis.swings.length);
    console.log(
        'Structure Event count:',
        analysis.structureEvents.length
    );
    console.log(
        'Liquidity Sweep count:',
        analysis.liquidity.sweeps.length
    );
    console.log(
        'Displacement Event count:',
        analysis.displacementEvents.length
    );
    console.log('FVG count:', analysis.fvgs.length);
    console.log('Setup count:', analysis.setups.length);
}

function printRecentEvents(events) {
    var recent = events.slice(-10);

    console.log('\n===== Recent 10 Key Events =====');
    console.table(
        recent.map(function (item) {
            return {
                utcTime: formatUtcTime(item.time),
                localTime: formatLocalTime(item.time),
                type: item.type,
                price: item.price,
                index: item.index,
                score: item.score
            };
        })
    );
}

function printRecentSetups(setups, klines) {
    var recent = setups.slice(-5);

    console.log('\n===== Recent 5 Setups =====');

    if (recent.length === 0) {
        console.log('No setup found.');
        return;
    }

    recent.forEach(function (setup) {
        var index = getEventIndex(setup);
        var time = getEventTime(klines, index);

        console.log({
            utcTime: formatUtcTime(time),
            localTime: formatLocalTime(time),
            type: setup.type,
            triggerIndex: setup.triggerIndex,
            direction: setup.direction,
            reasons: setup.reasons
        });
    });
}

console.log(
    'Fetching BTCUSDT 5m Klines from Binance Futures...'
);

Binance.getKlines('BTCUSDT', '5m', 500)
    .then(function (klines) {
        var analysis = AnalysisEngine.analyzeMarket(klines);
        var keyEvents = getKeyEvents(analysis, klines);

        printSummary(analysis);
        printRecentEvents(keyEvents);
        printRecentSetups(analysis.setups, klines);
    })
    .catch(function (error) {
        console.error(
            error.response
                ? error.response.data
                : error.message
        );

        process.exitCode = 1;
    });
