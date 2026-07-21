var LONG_SEQUENCE = [
    'SELL_SIDE_SWEEP',
    'BULLISH_MSS',
    'BULLISH_DISPLACEMENT',
    'BULLISH_FVG'
];

var SHORT_SEQUENCE = [
    'BUY_SIDE_SWEEP',
    'BEARISH_MSS',
    'BEARISH_DISPLACEMENT',
    'BEARISH_FVG'
];

var DEFAULT_DISTANCE_LIMITS = [12, 6, 3];

function getEventIndex(event) {
    if (!event) {
        return null;
    }

    if (typeof event.index === 'number') {
        return event.index;
    }

    if (typeof event.breakIndex === 'number') {
        return event.breakIndex;
    }

    if (typeof event.endIndex === 'number') {
        return event.endIndex;
    }

    if (typeof event.startIndex === 'number') {
        return event.startIndex;
    }

    return null;
}

function getEventPriority(event) {
    if (
        event.type === 'BUY_SIDE_SWEEP' ||
        event.type === 'SELL_SIDE_SWEEP'
    ) {
        return 1;
    }

    if (
        event.type === 'BULLISH_MSS' ||
        event.type === 'BEARISH_MSS'
    ) {
        return 2;
    }

    if (
        event.type === 'BULLISH_DISPLACEMENT' ||
        event.type === 'BEARISH_DISPLACEMENT'
    ) {
        return 3;
    }

    if (
        event.type === 'BULLISH_FVG' ||
        event.type === 'BEARISH_FVG'
    ) {
        return 4;
    }

    return 5;
}

function appendEvents(result, events) {
    var index;
    var i;

    if (!events || !events.length) {
        return;
    }

    for (i = 0; i < events.length; i++) {
        index = getEventIndex(events[i]);

        if (index !== null && !isNaN(index)) {
            result.push(events[i]);
        }
    }
}

function mergeEvents(input) {
    var result = [];

    input = input || {};

    appendEvents(result, input.structureEvents);
    appendEvents(result, input.liquidityEvents);
    appendEvents(result, input.displacementEvents);
    appendEvents(result, input.fvgEvents);

    result.sort(function (event1, event2) {
        var indexDifference =
            getEventIndex(event1) - getEventIndex(event2);

        if (indexDifference !== 0) {
            return indexDifference;
        }

        return getEventPriority(event1) -
            getEventPriority(event2);
    });

    return result;
}

function createSequenceState(sequence, setupType, direction) {
    return {
        sequence: sequence,
        setupType: setupType,
        direction: direction,
        position: 0,
        reasons: [],
        lastIndex: null
    };
}

function resetState(state) {
    state.position = 0;
    state.reasons = [];
    state.lastIndex = null;
}

function processEvent(state, event) {
    var eventIndex = getEventIndex(event);
    var distanceLimit;
    var reasons;
    var setup;
    var i;

    if (event.type === state.sequence[0]) {
        state.position = 1;
        state.reasons = [event.type];
        state.lastIndex = eventIndex;
        return null;
    }

    if (state.position === 0) {
        return null;
    }

    distanceLimit = DEFAULT_DISTANCE_LIMITS[
        state.position - 1
    ];

    if (
        eventIndex - state.lastIndex > distanceLimit
    ) {
        resetState(state);
        return null;
    }

    if (event.type !== state.sequence[state.position]) {
        return null;
    }

    state.reasons.push(event.type);
    state.position++;
    state.lastIndex = eventIndex;

    if (state.position < state.sequence.length) {
        return null;
    }

    reasons = [];

    for (i = 0; i < state.reasons.length; i++) {
        reasons.push(state.reasons[i]);
    }

    setup = {
        type: state.setupType,
        triggerIndex: getEventIndex(event),
        direction: state.direction,
        reasons: reasons
    };

    resetState(state);

    return setup;
}

function findSetups(events) {
    var result = [];
    var longState = createSequenceState(
        LONG_SEQUENCE,
        'LONG_SETUP',
        'BULLISH'
    );
    var shortState = createSequenceState(
        SHORT_SEQUENCE,
        'SHORT_SETUP',
        'BEARISH'
    );
    var setup;
    var i;

    for (i = 0; i < events.length; i++) {
        setup = processEvent(longState, events[i]);

        if (setup) {
            result.push(setup);
        }

        setup = processEvent(shortState, events[i]);

        if (setup) {
            result.push(setup);
        }
    }

    result.sort(function (setup1, setup2) {
        return setup1.triggerIndex - setup2.triggerIndex;
    });

    return result;
}

function analyze(input) {
    return findSetups(mergeEvents(input));
}

module.exports = {
    analyze: analyze,
    mergeEvents: mergeEvents,
    findSetups: findSetups
};
