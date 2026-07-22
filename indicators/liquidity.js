var EQUAL_TOLERANCE = 0.001;

function isEqualPrice(price1, price2) {
    var referencePrice = Math.max(
        Math.abs(price1),
        Math.abs(price2)
    );

    if (referencePrice === 0) {
        return price1 === price2;
    }

    return Math.abs(price1 - price2) /
        referencePrice <= EQUAL_TOLERANCE;
}

function getSwingAvailableIndex(swing) {
    if (typeof swing.availableIndex === 'number') {
        return swing.availableIndex;
    }

    if (typeof swing.confirmationIndex === 'number') {
        return swing.confirmationIndex;
    }

    return swing.index;
}

function getLevelDirection(level) {
    if (
        level.type === 'EQUAL_HIGH' ||
        level.type === 'PDH'
    ) {
        return 'BUY_SIDE';
    }

    if (
        level.type === 'EQUAL_LOW' ||
        level.type === 'PDL'
    ) {
        return 'SELL_SIDE';
    }

    return level.direction || null;
}

function prepareLiquidityLevel(level) {
    var formedIndex;

    formedIndex = typeof level.formedIndex === 'number'
        ? level.formedIndex
        : typeof level.index2 === 'number'
            ? level.index2
            : typeof level.index === 'number'
                ? level.index
                : 0;

    level.formedIndex = formedIndex;
    level.availableIndex =
        typeof level.availableIndex === 'number'
            ? level.availableIndex
            : formedIndex;
    level.activeFrom =
        typeof level.activeFrom === 'number'
            ? level.activeFrom
            : level.availableIndex;
    level.consumedAt =
        typeof level.consumedAt === 'number'
            ? level.consumedAt
            : null;
    level.direction = getLevelDirection(level);

    if (level.consumedAt !== null) {
        level.status = 'CONSUMED';
    } else if (level.status !== 'ACTIVE') {
        level.status = 'FORMED';
    }

    return level;
}

function findEqualLevels(swings, swingType, resultType) {
    var result = [];
    var previous = null;
    var current;
    var i;

    if (!swings || !swings.length) {
        return result;
    }

    for (i = 0; i < swings.length; i++) {
        current = swings[i];

        if (current.type !== swingType) {
            continue;
        }

        if (
            previous &&
            isEqualPrice(previous.price, current.price)
        ) {
            result.push({
                type: resultType,
                price: (previous.price + current.price) / 2,
                index1: previous.index,
                index2: current.index,
                formedIndex: current.index,
                availableIndex: Math.max(
                    getSwingAvailableIndex(previous),
                    getSwingAvailableIndex(current)
                ),
                activeFrom: Math.max(
                    getSwingAvailableIndex(previous),
                    getSwingAvailableIndex(current)
                ),
                consumedAt: null,
                status: 'FORMED',
                direction: resultType === 'EQUAL_HIGH'
                    ? 'BUY_SIDE'
                    : 'SELL_SIDE'
            });
        }

        previous = current;
    }

    return result;
}

function findEqualHighs(swings) {
    return findEqualLevels(
        swings,
        'HIGH',
        'EQUAL_HIGH'
    );
}

function findEqualLows(swings) {
    return findEqualLevels(
        swings,
        'LOW',
        'EQUAL_LOW'
    );
}

function getDayStart(time) {
    var date = new Date(time);

    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
}

function findPreviousDayLevels(klines) {
    var result = [];
    var latestDayStart;
    var previousDayStart = null;
    var dayStart;
    var high = null;
    var low = null;
    var i;

    if (!klines || !klines.length) {
        return result;
    }

    latestDayStart = getDayStart(
        klines[klines.length - 1].openTime
    );

    for (i = klines.length - 1; i >= 0; i--) {
        dayStart = getDayStart(klines[i].openTime);

        if (dayStart < latestDayStart) {
            previousDayStart = dayStart;
            break;
        }
    }

    if (previousDayStart === null) {
        return result;
    }

    for (i = 0; i < klines.length; i++) {
        dayStart = getDayStart(klines[i].openTime);

        if (dayStart !== previousDayStart) {
            continue;
        }

        if (high === null || klines[i].high > high) {
            high = klines[i].high;
        }

        if (low === null || klines[i].low < low) {
            low = klines[i].low;
        }
    }

    if (high !== null) {
        result.push({
            type: 'PDH',
            price: high,
            index: findLevelIndex(
                klines,
                previousDayStart,
                high,
                'high'
            )
        });
    }

    if (low !== null) {
        result.push({
            type: 'PDL',
            price: low,
            index: findLevelIndex(
                klines,
                previousDayStart,
                low,
                'low'
            )
        });
    }

    for (i = 0; i < result.length; i++) {
        result[i].availableIndex = findNextDayIndex(
            klines,
            result[i].index
        );
        result[i].formedIndex = result[i].index;
        result[i].activeFrom = result[i].availableIndex;
        result[i].consumedAt = null;
        result[i].status = 'FORMED';
        result[i].direction = getLevelDirection(result[i]);
    }

    return result;
}

function findLevelIndex(
    klines,
    dayStart,
    price,
    field
) {
    var i;

    for (i = 0; i < klines.length; i++) {
        if (
            getDayStart(klines[i].openTime) === dayStart &&
            klines[i][field] === price
        ) {
            return i;
        }
    }

    return null;
}

function findNextDayIndex(klines, sourceIndex) {
    var sourceDayStart;
    var i;

    if (
        !klines[sourceIndex] ||
        typeof klines[sourceIndex].openTime === 'undefined'
    ) {
        return 0;
    }

    sourceDayStart = getDayStart(
        klines[sourceIndex].openTime
    );

    for (i = sourceIndex + 1; i < klines.length; i++) {
        if (
            getDayStart(klines[i].openTime) >
            sourceDayStart
        ) {
            return i;
        }
    }

    return klines.length;
}

function toLiquidityLevels(
    equalHighs,
    equalLows,
    dayLevels,
    klines
) {
    var result = [];
    var i;

    for (i = 0; i < equalHighs.length; i++) {
        result.push(prepareLiquidityLevel(equalHighs[i]));
    }

    for (i = 0; i < equalLows.length; i++) {
        result.push(prepareLiquidityLevel(equalLows[i]));
    }

    for (i = 0; i < dayLevels.length; i++) {
        result.push(prepareLiquidityLevel(dayLevels[i]));
    }

    return result;
}

function scanLiquidityLifecycle(klines, levels, reset) {
    var result = [];
    var level;
    var kline;
    var startIndex;
    var i;
    var j;

    if (!klines || !klines.length || !levels) {
        return result;
    }

    for (i = 0; i < levels.length; i++) {
        level = prepareLiquidityLevel(levels[i]);

        if (reset) {
            level.consumedAt = null;
            level.status = 'FORMED';
        }

        if (level.consumedAt !== null) {
            level.status = 'CONSUMED';
            continue;
        }

        startIndex = level.activeFrom;

        if (startIndex >= klines.length) {
            level.status = 'FORMED';
            continue;
        }

        level.status = 'ACTIVE';

        for (j = startIndex; j < klines.length; j++) {
            kline = klines[j];

            if (
                level.direction === 'BUY_SIDE' &&
                kline.high >= level.price
            ) {
                level.consumedAt = j;
                level.status = 'CONSUMED';

                if (
                    kline.high > level.price &&
                    kline.close < level.price
                ) {
                    result.push({
                        type: 'BUY_SIDE_SWEEP',
                        price: level.price,
                        extreme: kline.high,
                        index: j,
                        availableIndex: j
                    });
                }

                break;
            }

            if (
                level.direction === 'SELL_SIDE' &&
                kline.low <= level.price
            ) {
                level.consumedAt = j;
                level.status = 'CONSUMED';

                if (
                    kline.low < level.price &&
                    kline.close > level.price
                ) {
                    result.push({
                        type: 'SELL_SIDE_SWEEP',
                        price: level.price,
                        extreme: kline.low,
                        index: j,
                        availableIndex: j
                    });
                }

                break;
            }
        }
    }

    return result;
}

function findLiquiditySweeps(klines, levels) {
    return scanLiquidityLifecycle(klines, levels, false);
}

function refreshLiquidityLifecycle(klines, levels) {
    return scanLiquidityLifecycle(klines, levels, true);
}

function analyze(swings, klines) {
    var equalHighs = findEqualHighs(swings);
    var equalLows = findEqualLows(swings);
    var previousDayLevels =
        findPreviousDayLevels(klines);
    var levels = toLiquidityLevels(
        equalHighs,
        equalLows,
        previousDayLevels,
        klines
    );

    return {
        equalHighs: equalHighs,
        equalLows: equalLows,
        previousDayLevels: previousDayLevels,
        sweeps: findLiquiditySweeps(klines, levels)
    };
}

module.exports = {
    analyze: analyze,
    findEqualHighs: findEqualHighs,
    findEqualLows: findEqualLows,
    findPreviousDayLevels: findPreviousDayLevels,
    findLiquiditySweeps: findLiquiditySweeps,
    refreshLiquidityLifecycle: refreshLiquidityLifecycle
};
