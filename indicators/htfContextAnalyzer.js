var Pivot = require('./pivot');
var Swing = require('./swing');
var StructureEngineV2 = require('./structureEngineV2');

var FIVE_MINUTES = 5 * 60 * 1000;
var ONE_HOUR = 60 * 60 * 1000;
var FOUR_HOURS = 4 * ONE_HOUR;
var ONE_DAY = 24 * ONE_HOUR;

function getCloseTime(kline) {
    if (typeof kline.closeTime === 'number') {
        return kline.closeTime;
    }

    return kline.openTime + FIVE_MINUTES - 1;
}

function createAggregate(kline, sourceIndex, bucketStart) {
    return {
        openTime: bucketStart,
        closeTime: getCloseTime(kline),
        open: kline.open,
        high: kline.high,
        low: kline.low,
        close: kline.close,
        volume: typeof kline.volume === 'number'
            ? kline.volume
            : 0,
        sourceStartIndex: sourceIndex,
        sourceEndIndex: sourceIndex,
        availableIndex: sourceIndex,
        firstSourceOpenTime: kline.openTime
    };
}

function updateAggregate(result, kline, sourceIndex) {
    result.high = Math.max(result.high, kline.high);
    result.low = Math.min(result.low, kline.low);
    result.close = kline.close;
    result.closeTime = getCloseTime(kline);
    result.sourceEndIndex = sourceIndex;
    result.availableIndex = sourceIndex;

    if (typeof kline.volume === 'number') {
        result.volume += kline.volume;
    }
}

function aggregateClosedKlines(klines, intervalMilliseconds) {
    var result = [];
    var current = null;
    var bucketStart;
    var i;

    klines = klines || [];

    function appendIfClosed() {
        var expectedClose;

        if (!current) {
            return;
        }

        expectedClose = current.openTime +
            intervalMilliseconds - 1;

        if (
            current.firstSourceOpenTime === current.openTime &&
            current.closeTime >= expectedClose
        ) {
            delete current.firstSourceOpenTime;
            result.push(current);
        }
    }

    for (i = 0; i < klines.length; i++) {
        bucketStart = Math.floor(
            klines[i].openTime / intervalMilliseconds
        ) * intervalMilliseconds;

        if (!current || current.openTime !== bucketStart) {
            appendIfClosed();
            current = createAggregate(
                klines[i],
                i,
                bucketStart
            );
            continue;
        }

        updateAggregate(current, klines[i], i);
    }

    appendIfClosed();

    return result;
}

function isStructureEvent(event) {
    return event.type === 'BULLISH_STRUCTURE_CONFIRMED' ||
        event.type === 'BEARISH_STRUCTURE_CONFIRMED' ||
        event.type === 'BULLISH_BOS' ||
        event.type === 'BEARISH_BOS' ||
        event.type === 'BULLISH_MSS' ||
        event.type === 'BEARISH_MSS';
}

function getTrend(event) {
    return event.type.indexOf('BULLISH_') === 0
        ? 'BULLISH'
        : 'BEARISH';
}

function buildStructureTimeline(aggregatedKlines) {
    var pivots = Pivot.findPivots(
        aggregatedKlines,
        2,
        2
    );
    var swings = Swing.filterSwings(pivots);
    var structure = StructureEngineV2.analyze(
        aggregatedKlines,
        swings,
        {
            averageLength: 20,
            displacementMultiplier: 1.5,
            minBodyRatio: 0.65
        }
    );
    var eventsByIndex = {};
    var snapshots = [];
    var trend = 'UNKNOWN';
    var latestEvent = null;
    var index;
    var i;

    for (i = 0; i < structure.events.length; i++) {
        if (!isStructureEvent(structure.events[i])) {
            continue;
        }

        index = structure.events[i].availableIndex;

        if (!eventsByIndex[index]) {
            eventsByIndex[index] = [];
        }

        eventsByIndex[index].push(structure.events[i]);
    }

    for (index = 0; index < aggregatedKlines.length; index++) {
        if (eventsByIndex[index]) {
            for (i = 0; i < eventsByIndex[index].length; i++) {
                latestEvent = eventsByIndex[index][i];
                trend = getTrend(latestEvent);
            }
        }

        snapshots.push({
            trend: trend,
            structure: latestEvent
                ? latestEvent.type
                : 'UNKNOWN',
            lastEvent: latestEvent
        });
    }

    return {
        klines: aggregatedKlines,
        swings: swings,
        events: structure.events,
        snapshots: snapshots
    };
}

function findLatestClosedIndex(aggregatedKlines, sourceIndex) {
    var low = 0;
    var high = aggregatedKlines.length;
    var middle;

    while (low < high) {
        middle = Math.floor((low + high) / 2);

        if (
            aggregatedKlines[middle].sourceEndIndex <=
            sourceIndex
        ) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low - 1;
}

function getTimeframeContext(timeline, sourceIndex) {
    var index = findLatestClosedIndex(
        timeline.klines,
        sourceIndex
    );
    var kline;
    var snapshot;
    var event;

    if (index < 0) {
        return {
            trend: 'UNKNOWN',
            structure: 'UNKNOWN',
            lastClosedBarTime: null,
            lastEventTime: null
        };
    }

    kline = timeline.klines[index];
    snapshot = timeline.snapshots[index];
    event = snapshot.lastEvent;

    return {
        trend: snapshot.trend,
        structure: snapshot.structure,
        lastClosedBarTime: kline.closeTime,
        lastEventTime: event
            ? timeline.klines[event.availableIndex].closeTime
            : null
    };
}

function buildPreviousDayLevels(klines) {
    var days = aggregateClosedKlines(klines, ONE_DAY);
    var result = {};
    var i;

    for (i = 0; i < days.length; i++) {
        result[days[i].openTime] = {
            pdh: days[i].high,
            pdl: days[i].low,
            openTime: days[i].openTime,
            closeTime: days[i].closeTime
        };
    }

    return result;
}

function getPreviousDayContext(
    previousDayLevels,
    kline
) {
    var dayStart = Math.floor(
        kline.openTime / ONE_DAY
    ) * ONE_DAY;
    var level = previousDayLevels[dayStart - ONE_DAY];
    var price = kline.close;
    var pdhDistance;
    var pdlDistance;
    var pdhAbsolute;
    var pdlAbsolute;

    if (!level) {
        return {
            pdh: null,
            pdl: null,
            pdhDistance: null,
            pdlDistance: null,
            pdhDistancePercent: null,
            pdlDistancePercent: null,
            location: 'UNKNOWN',
            nearestLevel: null,
            nearestDistancePercent: null
        };
    }

    pdhDistance = level.pdh - price;
    pdlDistance = price - level.pdl;
    pdhAbsolute = Math.abs(pdhDistance);
    pdlAbsolute = Math.abs(pdlDistance);

    return {
        pdh: level.pdh,
        pdl: level.pdl,
        pdhDistance: pdhDistance,
        pdlDistance: pdlDistance,
        pdhDistancePercent: price !== 0
            ? pdhDistance / price * 100
            : null,
        pdlDistancePercent: price !== 0
            ? pdlDistance / price * 100
            : null,
        location: price > level.pdh
            ? 'ABOVE_PDH'
            : price < level.pdl
                ? 'BELOW_PDL'
                : 'INSIDE_PREVIOUS_DAY_RANGE',
        nearestLevel: pdhAbsolute <= pdlAbsolute
            ? 'PDH'
            : 'PDL',
        nearestDistancePercent: price !== 0
            ? Math.min(pdhAbsolute, pdlAbsolute) /
                price * 100
            : null
    };
}

function copySetup(setup) {
    var result = {};
    var property;

    for (property in setup) {
        if (
            Object.prototype.hasOwnProperty.call(
                setup,
                property
            )
        ) {
            result[property] = setup[property];
        }
    }

    return result;
}

function attachContexts(setups, klines) {
    var oneHour = buildStructureTimeline(
        aggregateClosedKlines(klines, ONE_HOUR)
    );
    var fourHours = buildStructureTimeline(
        aggregateClosedKlines(klines, FOUR_HOURS)
    );
    var previousDayLevels = buildPreviousDayLevels(klines);

    return (setups || []).map(function (setup) {
        var result = copySetup(setup);
        var kline = klines[setup.availableIndex];

        if (!kline) {
            result.htfContext = null;
            return result;
        }

        result.htfContext = {
            availableIndex: setup.availableIndex,
            setupTime: kline.openTime,
            referencePrice: kline.close,
            h4: getTimeframeContext(
                fourHours,
                setup.availableIndex
            ),
            h1: getTimeframeContext(
                oneHour,
                setup.availableIndex
            ),
            previousDay: getPreviousDayContext(
                previousDayLevels,
                kline
            )
        };

        return result;
    });
}

module.exports = {
    ONE_HOUR: ONE_HOUR,
    FOUR_HOURS: FOUR_HOURS,
    ONE_DAY: ONE_DAY,
    aggregateClosedKlines: aggregateClosedKlines,
    buildStructureTimeline: buildStructureTimeline,
    getTimeframeContext: getTimeframeContext,
    buildPreviousDayLevels: buildPreviousDayLevels,
    getPreviousDayContext: getPreviousDayContext,
    attachContexts: attachContexts
};
