var BreakValidator = require('./breakValidator');

function analyze(klines, swings, options) {
    var state = {
        trend: 'UNKNOWN',
        protectedLow: null,
        protectedHigh: null,
        events: []
    };

    var lastHigh = null;
    var lastLow = null;

    var candidateLow = null;
    var candidateHigh = null;

    var i;
    var swing;

    options = options || {};

    for (i = 0; i < swings.length; i++) {
        swing = swings[i];

        if (swing.type === 'LOW') {
            candidateLow = swing;

            if (lastLow) {
                processBearishBreak(
                    klines,
                    lastLow,
                    swing,
                    candidateHigh,
                    state,
                    options
                );
            }

            lastLow = swing;
        }

        if (swing.type === 'HIGH') {
            candidateHigh = swing;

            if (lastHigh) {
                processBullishBreak(
                    klines,
                    lastHigh,
                    swing,
                    candidateLow,
                    state,
                    options
                );
            }

            lastHigh = swing;
        }
    }

    return state;
}

function processBullishBreak(
    klines,
    previousHigh,
    currentHigh,
    candidateLow,
    state,
    options
) {
    if (currentHigh.price <= previousHigh.price) {
        return;
    }

    var breakResult = BreakValidator.findBullishBreak(
        klines,
        previousHigh.index + 1,
        previousHigh.price,
        options
    );

    if (!breakResult) {
        return;
    }

    /*
     * 只有影线突破
     * 先定义成 Liquidity Taken
     */
    if (breakResult.type === 'WICK_BREAK') {
        state.events.push({
            type: 'BSL_TAKEN',
            direction: 'BULLISH',
            level: previousHigh.price,
            breakIndex: breakResult.breakIndex,
            breakType: breakResult.type
        });

        return;
    }

    /*
     * UNKNOWN
     * 第一次确认 Bullish Structure
     */
    if (state.trend === 'UNKNOWN') {
        state.trend = 'BULLISH';

        if (candidateLow) {
            state.protectedLow = candidateLow;
        }

        state.events.push({
            type: 'BULLISH_STRUCTURE_CONFIRMED',
            direction: 'BULLISH',

            level: previousHigh.price,

            breakIndex: breakResult.breakIndex,
            breakType: breakResult.type,

            protectedLow: state.protectedLow
                ? state.protectedLow.price
                : null
        });

        return;
    }

    /*
     * 原本 Bullish
     * 继续向上突破
     * => Bullish BOS
     */
    if (state.trend === 'BULLISH') {
        if (candidateLow) {
            state.protectedLow = candidateLow;
        }

        state.events.push({
            type: 'BULLISH_BOS',
            direction: 'BULLISH',

            level: previousHigh.price,

            breakIndex: breakResult.breakIndex,
            breakType: breakResult.type,

            protectedLow: state.protectedLow
                ? state.protectedLow.price
                : null,

            quality:
                breakResult.type === 'DISPLACEMENT_BREAK'
                    ? 'HIGH'
                    : 'NORMAL'
        });

        return;
    }

    /*
     * 原本 Bearish
     *
     * 注意：
     * 只有真正突破 Protected High
     * 才定义成 Bullish MSS
     */
    if (
        state.trend === 'BEARISH' &&
        state.protectedHigh &&
        currentHigh.price > state.protectedHigh.price
    ) {
        var protectedBreak =
            BreakValidator.findBullishBreak(
                klines,
                state.protectedHigh.index + 1,
                state.protectedHigh.price,
                options
            );

        if (
            protectedBreak &&
            protectedBreak.type !== 'WICK_BREAK'
        ) {
            state.events.push({
                type: 'BULLISH_MSS',
                direction: 'BULLISH',

                level: state.protectedHigh.price,

                breakIndex:
                    protectedBreak.breakIndex,

                breakType:
                    protectedBreak.type,

                oldProtectedHigh:
                    state.protectedHigh.price,

                newProtectedLow:
                    candidateLow
                        ? candidateLow.price
                        : null,

                quality:
                    protectedBreak.type ===
                    'DISPLACEMENT_BREAK'
                        ? 'HIGH'
                        : 'NORMAL'
            });

            state.trend = 'BULLISH';

            state.protectedLow =
                candidateLow || null;

            state.protectedHigh = null;
        }
    }
}

function processBearishBreak(
    klines,
    previousLow,
    currentLow,
    candidateHigh,
    state,
    options
) {
    if (currentLow.price >= previousLow.price) {
        return;
    }

    var breakResult = BreakValidator.findBearishBreak(
        klines,
        previousLow.index + 1,
        previousLow.price,
        options
    );

    if (!breakResult) {
        return;
    }

    /*
     * 只有影线跌破
     * => SSL Taken
     */
    if (breakResult.type === 'WICK_BREAK') {
        state.events.push({
            type: 'SSL_TAKEN',
            direction: 'BEARISH',
            level: previousLow.price,
            breakIndex: breakResult.breakIndex,
            breakType: breakResult.type
        });

        return;
    }

    /*
     * UNKNOWN
     */
    if (state.trend === 'UNKNOWN') {
        state.trend = 'BEARISH';

        if (candidateHigh) {
            state.protectedHigh = candidateHigh;
        }

        state.events.push({
            type: 'BEARISH_STRUCTURE_CONFIRMED',
            direction: 'BEARISH',

            level: previousLow.price,

            breakIndex: breakResult.breakIndex,
            breakType: breakResult.type,

            protectedHigh: state.protectedHigh
                ? state.protectedHigh.price
                : null
        });

        return;
    }

    /*
     * Bearish BOS
     */
    if (state.trend === 'BEARISH') {
        if (candidateHigh) {
            state.protectedHigh = candidateHigh;
        }

        state.events.push({
            type: 'BEARISH_BOS',
            direction: 'BEARISH',

            level: previousLow.price,

            breakIndex: breakResult.breakIndex,
            breakType: breakResult.type,

            protectedHigh: state.protectedHigh
                ? state.protectedHigh.price
                : null,

            quality:
                breakResult.type === 'DISPLACEMENT_BREAK'
                    ? 'HIGH'
                    : 'NORMAL'
        });

        return;
    }

    /*
     * Bullish → Bearish MSS
     */
    if (
        state.trend === 'BULLISH' &&
        state.protectedLow &&
        currentLow.price < state.protectedLow.price
    ) {
        var protectedBreak =
            BreakValidator.findBearishBreak(
                klines,
                state.protectedLow.index + 1,
                state.protectedLow.price,
                options
            );

        if (
            protectedBreak &&
            protectedBreak.type !== 'WICK_BREAK'
        ) {
            state.events.push({
                type: 'BEARISH_MSS',
                direction: 'BEARISH',

                level: state.protectedLow.price,

                breakIndex:
                    protectedBreak.breakIndex,

                breakType:
                    protectedBreak.type,

                oldProtectedLow:
                    state.protectedLow.price,

                newProtectedHigh:
                    candidateHigh
                        ? candidateHigh.price
                        : null,

                quality:
                    protectedBreak.type ===
                    'DISPLACEMENT_BREAK'
                        ? 'HIGH'
                        : 'NORMAL'
            });

            state.trend = 'BEARISH';

            state.protectedHigh =
                candidateHigh || null;

            state.protectedLow = null;
        }
    }
}

module.exports = {
    analyze: analyze
};