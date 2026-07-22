var BreakValidator = require('./breakValidator');

function getSwingAvailableIndex(swing) {
    if (!swing) {
        return null;
    }

    if (typeof swing.availableIndex === 'number') {
        return swing.availableIndex;
    }

    if (typeof swing.confirmationIndex === 'number') {
        return swing.confirmationIndex;
    }

    if (typeof swing.index === 'number') {
        return swing.index;
    }

    return null;
}

function getStructureAvailableIndex(breakIndex) {
    var result = breakIndex;
    var availableIndex;
    var i;

    for (i = 1; i < arguments.length; i++) {
        availableIndex = getSwingAvailableIndex(arguments[i]);

        if (
            typeof availableIndex === 'number' &&
            availableIndex > result
        ) {
            result = availableIndex;
        }
    }

    return result;
}

function createState() {
    return {
        trend: 'UNKNOWN',
        protectedLow: null,
        protectedHigh: null,
        events: [],
        lastLow: null,
        lastHigh: null,
        candidateLow: null,
        candidateHigh: null,
        pendingLowBreak: null,
        pendingHighBreak: null,
        pendingProtectedLowBreak: null,
        pendingProtectedHighBreak: null
    };
}

function sameSwing(left, right) {
    return left === right || Boolean(
        left &&
        right &&
        left.type === right.type &&
        left.index === right.index &&
        left.price === right.price &&
        getSwingAvailableIndex(left) ===
            getSwingAvailableIndex(right)
    );
}

function pendingFor(pending, reference) {
    if (
        pending &&
        sameSwing(pending.reference, reference)
    ) {
        return pending.result;
    }

    return null;
}

function setProtectedLow(state, swing) {
    if (!sameSwing(state.protectedLow, swing)) {
        state.pendingProtectedLowBreak = null;
    }

    state.protectedLow = swing || null;
}

function setProtectedHigh(state, swing) {
    if (!sameSwing(state.protectedHigh, swing)) {
        state.pendingProtectedHighBreak = null;
    }

    state.protectedHigh = swing || null;
}

function observeBullishBreak(
    klines,
    index,
    reference,
    options
) {
    if (
        !reference ||
        index <= reference.index ||
        klines[index].high <= reference.price
    ) {
        return null;
    }

    return BreakValidator.validateBullishBreak(
        klines,
        index,
        reference.price,
        options
    );
}

function observeBearishBreak(
    klines,
    index,
    reference,
    options
) {
    if (
        !reference ||
        index <= reference.index ||
        klines[index].low >= reference.price
    ) {
        return null;
    }

    return BreakValidator.validateBearishBreak(
        klines,
        index,
        reference.price,
        options
    );
}

function observeReference(
    state,
    pendingProperty,
    reference,
    observer,
    klines,
    index,
    options
) {
    var pending = state[pendingProperty];
    var result;

    if (!reference) {
        state[pendingProperty] = null;
        return;
    }

    if (
        pending &&
        sameSwing(pending.reference, reference)
    ) {
        return;
    }

    state[pendingProperty] = null;
    result = observer(
        klines,
        index,
        reference,
        options
    );

    if (result && result.valid) {
        state[pendingProperty] = {
            reference: reference,
            result: result
        };
    }
}

function observeBreaks(state, klines, index, options) {
    observeReference(
        state,
        'pendingHighBreak',
        state.lastHigh,
        observeBullishBreak,
        klines,
        index,
        options
    );
    observeReference(
        state,
        'pendingLowBreak',
        state.lastLow,
        observeBearishBreak,
        klines,
        index,
        options
    );
    observeReference(
        state,
        'pendingProtectedHighBreak',
        state.protectedHigh,
        observeBullishBreak,
        klines,
        index,
        options
    );
    observeReference(
        state,
        'pendingProtectedLowBreak',
        state.protectedLow,
        observeBearishBreak,
        klines,
        index,
        options
    );
}

function pushBullishTaken(
    state,
    previousHigh,
    currentHigh,
    candidateLow,
    breakResult
) {
    state.events.push({
        type: 'BSL_TAKEN',
        direction: 'BULLISH',
        level: previousHigh.price,
        breakIndex: breakResult.breakIndex,
        availableIndex: getStructureAvailableIndex(
            breakResult.breakIndex,
            previousHigh,
            currentHigh,
            candidateLow
        ),
        breakType: breakResult.type
    });
}

function pushBearishTaken(
    state,
    previousLow,
    currentLow,
    candidateHigh,
    breakResult
) {
    state.events.push({
        type: 'SSL_TAKEN',
        direction: 'BEARISH',
        level: previousLow.price,
        breakIndex: breakResult.breakIndex,
        availableIndex: getStructureAvailableIndex(
            breakResult.breakIndex,
            previousLow,
            currentLow,
            candidateHigh
        ),
        breakType: breakResult.type
    });
}

function commitBullishBreak(
    state,
    previousHigh,
    currentHigh,
    breakResult
) {
    var candidateLow = state.candidateLow;
    var protectedBreak;
    var availableIndex;

    if (breakResult.type === 'WICK_BREAK') {
        pushBullishTaken(
            state,
            previousHigh,
            currentHigh,
            candidateLow,
            breakResult
        );
        return;
    }

    availableIndex = getStructureAvailableIndex(
        breakResult.breakIndex,
        previousHigh,
        currentHigh,
        candidateLow
    );

    if (state.trend === 'UNKNOWN') {
        state.trend = 'BULLISH';
        setProtectedLow(state, candidateLow);
        state.events.push({
            type: 'BULLISH_STRUCTURE_CONFIRMED',
            direction: 'BULLISH',
            level: previousHigh.price,
            breakIndex: breakResult.breakIndex,
            availableIndex: availableIndex,
            breakType: breakResult.type,
            protectedLow: state.protectedLow
                ? state.protectedLow.price
                : null
        });
        return;
    }

    if (state.trend === 'BULLISH') {
        setProtectedLow(state, candidateLow);
        state.events.push({
            type: 'BULLISH_BOS',
            direction: 'BULLISH',
            level: previousHigh.price,
            breakIndex: breakResult.breakIndex,
            availableIndex: availableIndex,
            breakType: breakResult.type,
            protectedLow: state.protectedLow
                ? state.protectedLow.price
                : null,
            quality: breakResult.type ===
                'DISPLACEMENT_BREAK'
                ? 'HIGH'
                : 'NORMAL'
        });
        return;
    }

    if (
        state.trend !== 'BEARISH' ||
        !state.protectedHigh ||
        currentHigh.price <= state.protectedHigh.price
    ) {
        return;
    }

    protectedBreak = pendingFor(
        state.pendingProtectedHighBreak,
        state.protectedHigh
    );

    if (
        !protectedBreak ||
        protectedBreak.type === 'WICK_BREAK'
    ) {
        return;
    }

    availableIndex = getStructureAvailableIndex(
        protectedBreak.breakIndex,
        currentHigh,
        state.protectedHigh,
        candidateLow
    );
    state.events.push({
        type: 'BULLISH_MSS',
        direction: 'BULLISH',
        level: state.protectedHigh.price,
        breakIndex: protectedBreak.breakIndex,
        availableIndex: availableIndex,
        breakType: protectedBreak.type,
        oldProtectedHigh: state.protectedHigh.price,
        newProtectedLow: candidateLow
            ? candidateLow.price
            : null,
        quality: protectedBreak.type ===
            'DISPLACEMENT_BREAK'
            ? 'HIGH'
            : 'NORMAL'
    });
    state.trend = 'BULLISH';
    setProtectedLow(state, candidateLow);
    setProtectedHigh(state, null);
}

function commitBearishBreak(
    state,
    previousLow,
    currentLow,
    breakResult
) {
    var candidateHigh = state.candidateHigh;
    var protectedBreak;
    var availableIndex;

    if (breakResult.type === 'WICK_BREAK') {
        pushBearishTaken(
            state,
            previousLow,
            currentLow,
            candidateHigh,
            breakResult
        );
        return;
    }

    availableIndex = getStructureAvailableIndex(
        breakResult.breakIndex,
        previousLow,
        currentLow,
        candidateHigh
    );

    if (state.trend === 'UNKNOWN') {
        state.trend = 'BEARISH';
        setProtectedHigh(state, candidateHigh);
        state.events.push({
            type: 'BEARISH_STRUCTURE_CONFIRMED',
            direction: 'BEARISH',
            level: previousLow.price,
            breakIndex: breakResult.breakIndex,
            availableIndex: availableIndex,
            breakType: breakResult.type,
            protectedHigh: state.protectedHigh
                ? state.protectedHigh.price
                : null
        });
        return;
    }

    if (state.trend === 'BEARISH') {
        setProtectedHigh(state, candidateHigh);
        state.events.push({
            type: 'BEARISH_BOS',
            direction: 'BEARISH',
            level: previousLow.price,
            breakIndex: breakResult.breakIndex,
            availableIndex: availableIndex,
            breakType: breakResult.type,
            protectedHigh: state.protectedHigh
                ? state.protectedHigh.price
                : null,
            quality: breakResult.type ===
                'DISPLACEMENT_BREAK'
                ? 'HIGH'
                : 'NORMAL'
        });
        return;
    }

    if (
        state.trend !== 'BULLISH' ||
        !state.protectedLow ||
        currentLow.price >= state.protectedLow.price
    ) {
        return;
    }

    protectedBreak = pendingFor(
        state.pendingProtectedLowBreak,
        state.protectedLow
    );

    if (
        !protectedBreak ||
        protectedBreak.type === 'WICK_BREAK'
    ) {
        return;
    }

    availableIndex = getStructureAvailableIndex(
        protectedBreak.breakIndex,
        currentLow,
        state.protectedLow,
        candidateHigh
    );
    state.events.push({
        type: 'BEARISH_MSS',
        direction: 'BEARISH',
        level: state.protectedLow.price,
        breakIndex: protectedBreak.breakIndex,
        availableIndex: availableIndex,
        breakType: protectedBreak.type,
        oldProtectedLow: state.protectedLow.price,
        newProtectedHigh: candidateHigh
            ? candidateHigh.price
            : null,
        quality: protectedBreak.type ===
            'DISPLACEMENT_BREAK'
            ? 'HIGH'
            : 'NORMAL'
    });
    state.trend = 'BEARISH';
    setProtectedHigh(state, candidateHigh);
    setProtectedLow(state, null);
}

function confirmSwing(state, swing) {
    var previous;
    var breakResult;

    if (swing.type === 'HIGH') {
        previous = state.lastHigh;
        state.candidateHigh = swing;
        breakResult = pendingFor(
            state.pendingHighBreak,
            previous
        );

        if (
            previous &&
            swing.price > previous.price &&
            breakResult
        ) {
            commitBullishBreak(
                state,
                previous,
                swing,
                breakResult
            );
        }

        state.lastHigh = swing;
        state.pendingHighBreak = null;
        return;
    }

    if (swing.type === 'LOW') {
        previous = state.lastLow;
        state.candidateLow = swing;
        breakResult = pendingFor(
            state.pendingLowBreak,
            previous
        );

        if (
            previous &&
            swing.price < previous.price &&
            breakResult
        ) {
            commitBearishBreak(
                state,
                previous,
                swing,
                breakResult
            );
        }

        state.lastLow = swing;
        state.pendingLowBreak = null;
    }
}

function sortConfirmedSwings(swings) {
    return (swings || []).map(function (swing, order) {
        return {
            swing: swing,
            order: order
        };
    }).sort(function (left, right) {
        var availableDifference =
            getSwingAvailableIndex(left.swing) -
            getSwingAvailableIndex(right.swing);
        var indexDifference;

        if (availableDifference !== 0) {
            return availableDifference;
        }

        indexDifference = left.swing.index -
            right.swing.index;

        if (indexDifference !== 0) {
            return indexDifference;
        }

        return left.order - right.order;
    }).map(function (item) {
        return item.swing;
    });
}

function analyze(klines, swings, options) {
    var state = createState();
    var confirmedSwings = sortConfirmedSwings(swings);
    var swingCursor = 0;
    var index;

    klines = klines || [];
    options = options || {};

    for (index = 0; index < klines.length; index++) {
        /*
         * 只观察当前 K 线。Break 先被记录，等对应 Swing
         * 在 availableIndex 确认后才提交结构状态变化。
         */
        observeBreaks(state, klines, index, options);

        while (
            swingCursor < confirmedSwings.length &&
            getSwingAvailableIndex(
                confirmedSwings[swingCursor]
            ) === index
        ) {
            confirmSwing(
                state,
                confirmedSwings[swingCursor]
            );
            swingCursor++;
        }

        /* 新确认的 Level 可以从当前收盘开始被观察。 */
        observeBreaks(state, klines, index, options);
    }

    return {
        trend: state.trend,
        protectedLow: state.protectedLow,
        protectedHigh: state.protectedHigh,
        events: state.events
    };
}

module.exports = {
    analyze: analyze
};
