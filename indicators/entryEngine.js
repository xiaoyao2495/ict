var ENTRY_MODES = {
    FVG_EDGE: 'FVG_EDGE',
    FVG_MIDPOINT: 'FVG_MIDPOINT',
    FVG_75_PERCENT: 'FVG_75_PERCENT'
};

function normalizeEntryMode(entryMode) {
    entryMode = entryMode || ENTRY_MODES.FVG_MIDPOINT;

    if (
        entryMode !== ENTRY_MODES.FVG_EDGE &&
        entryMode !== ENTRY_MODES.FVG_MIDPOINT &&
        entryMode !== ENTRY_MODES.FVG_75_PERCENT
    ) {
        throw new Error('Unsupported Entry mode: ' + entryMode);
    }

    return entryMode;
}

function getEntryPrice(direction, fvg, entryMode) {
    var depth;

    entryMode = normalizeEntryMode(entryMode);

    if (entryMode === ENTRY_MODES.FVG_EDGE) {
        return direction === 'LONG'
            ? fvg.top
            : fvg.bottom;
    }

    if (entryMode === ENTRY_MODES.FVG_75_PERCENT) {
        depth = (fvg.top - fvg.bottom) * 0.75;

        return direction === 'LONG'
            ? fvg.top - depth
            : fvg.bottom + depth;
    }

    return fvg.midpoint;
}

function getLevelActiveFrom(level) {
    if (typeof level.activeFrom === 'number') {
        return level.activeFrom;
    }

    if (typeof level.availableIndex === 'number') {
        return level.availableIndex;
    }

    if (typeof level.formedIndex === 'number') {
        return level.formedIndex;
    }

    if (typeof level.index2 === 'number') {
        return level.index2;
    }

    if (typeof level.index === 'number') {
        return level.index;
    }

    return 0;
}

function isLiquidityValidAt(level, index) {
    return getLevelActiveFrom(level) <= index &&
        (
            typeof level.consumedAt !== 'number' ||
            level.consumedAt > index
        );
}

function isLiquidityAvailableAtBarOpen(level, index) {
    return getLevelActiveFrom(level) <= index &&
        (
            typeof level.consumedAt !== 'number' ||
            level.consumedAt >= index
        );
}

function appendLiquidityLevels(
    result,
    levels,
    expectedType,
    index,
    validator
) {
    var i;

    if (!levels || !levels.length) {
        return;
    }

    for (i = 0; i < levels.length; i++) {
        if (
            levels[i].type === expectedType &&
            typeof levels[i].price === 'number' &&
            validator(levels[i], index)
        ) {
            result.push(levels[i]);
        }
    }
}

function findDirectionalTargetLevel(
    direction,
    entry,
    liquidity,
    index,
    validator
) {
    var levels = [];
    var targetLevel = null;
    var i;

    liquidity = liquidity || {};

    if (direction === 'LONG') {
        appendLiquidityLevels(
            levels,
            liquidity.equalHighs,
            'EQUAL_HIGH',
            index,
            validator
        );
        appendLiquidityLevels(
            levels,
            liquidity.previousDayLevels,
            'PDH',
            index,
            validator
        );
    } else {
        appendLiquidityLevels(
            levels,
            liquidity.equalLows,
            'EQUAL_LOW',
            index,
            validator
        );
        appendLiquidityLevels(
            levels,
            liquidity.previousDayLevels,
            'PDL',
            index,
            validator
        );
    }

    for (i = 0; i < levels.length; i++) {
        if (
            direction === 'LONG' &&
            levels[i].price > entry &&
            (
                targetLevel === null ||
                levels[i].price < targetLevel.price
            )
        ) {
            targetLevel = levels[i];
        }

        if (
            direction === 'SHORT' &&
            levels[i].price < entry &&
            (
                targetLevel === null ||
                levels[i].price > targetLevel.price
            )
        ) {
            targetLevel = levels[i];
        }
    }

    return targetLevel;
}

function findTarget(
    direction,
    entry,
    stop,
    liquidity,
    entryIndex
) {
    var targetLevel = findDirectionalTargetLevel(
        direction,
        entry,
        liquidity,
        entryIndex,
        isLiquidityValidAt
    );

    if (targetLevel !== null) {
        return {
            price: targetLevel.price,
            source: 'LIQUIDITY',
            liquidityType: targetLevel.type,
            level: targetLevel
        };
    }

    return {
        price: direction === 'LONG'
            ? entry + (entry - stop) * 2
            : entry - (stop - entry) * 2,
        source: 'FALLBACK_2R',
        liquidityType: null,
        level: null
    };
}

function applyTarget(result, target) {
    result.target = target.price;
    result.targetSource = target.source;
    result.targetLiquidityType = target.liquidityType;
    result.targetLevel = target.level;
}

function getEventAvailableIndex(event) {
    if (!event) {
        return null;
    }

    if (typeof event.availableIndex === 'number') {
        return event.availableIndex;
    }

    if (typeof event.confirmationIndex === 'number') {
        return event.confirmationIndex;
    }

    if (typeof event.breakIndex === 'number') {
        return event.breakIndex;
    }

    if (typeof event.index === 'number') {
        return event.index;
    }

    return null;
}

function hasOppositeMssAt(
    structureEvents,
    type,
    index
) {
    var i;

    for (i = 0; i < structureEvents.length; i++) {
        if (
            structureEvents[i].type === type &&
            getEventAvailableIndex(structureEvents[i]) === index
        ) {
            return true;
        }
    }

    return false;
}

function createEntryResult(
    setup,
    direction,
    entryMode,
    entryPrice,
    sweepExtreme,
    structureLevel,
    fvg,
    klines
) {
    return {
        type: direction + '_ENTRY',
        entryMode: entryMode,
        status: 'SETUP_FORMED',
        entry: entryPrice,
        setupIndex: setup.triggerIndex,
        setupAvailableIndex: setup.availableIndex,
        triggerIndex: null,
        stop: sweepExtreme,
        sweepStop: sweepExtreme,
        structureStop: structureLevel,
        target: null,
        targetSource: null,
        targetLiquidityType: null,
        targetLevel: null,
        setupAgeBars: Math.max(
            0,
            klines.length - 1 - setup.availableIndex
        ),
        invalidatedAt: null,
        invalidationReason: null
    };
}

function invalidate(result, setup, index, status) {
    result.status = status;
    result.invalidatedAt = index;
    result.invalidationReason = status;
    result.setupAgeBars = Math.max(
        0,
        index - setup.availableIndex
    );

    return result;
}

function isFormationValid(
    direction,
    midpoint,
    sweepExtreme,
    structureLevel
) {
    if (
        typeof midpoint !== 'number' ||
        typeof sweepExtreme !== 'number' ||
        typeof structureLevel !== 'number'
    ) {
        return false;
    }

    if (direction === 'LONG') {
        return midpoint > sweepExtreme &&
            midpoint > structureLevel;
    }

    return midpoint < sweepExtreme &&
        midpoint < structureLevel;
}

function targetWasTakenBeforeEntry(
    direction,
    entry,
    liquidity,
    index
) {
    var targetLevel = findDirectionalTargetLevel(
        direction,
        entry,
        liquidity,
        index,
        isLiquidityAvailableAtBarOpen
    );

    return targetLevel !== null &&
        targetLevel.consumedAt === index;
}

function triggerEntry(
    result,
    setup,
    direction,
    liquidity,
    index
) {
    result.status = 'ENTRY_TRIGGERED';
    result.triggerIndex = index;
    result.setupAgeBars = index - setup.availableIndex;
    applyTarget(
        result,
        findTarget(
            direction,
            result.entry,
            result.stop,
            liquidity,
            index
        )
    );

    return result;
}

function processLongSetup(
    setup,
    klines,
    liquidity,
    structureEvents,
    entryMode
) {
    var fvg = setup.fvg;
    var entryPrice = getEntryPrice(
        'LONG',
        fvg,
        entryMode
    );
    var sweepExtreme = setup.sweepExtreme;
    var structureLevel = setup.structureInvalidationLevel;
    var result = createEntryResult(
        setup,
        'LONG',
        entryMode,
        entryPrice,
        sweepExtreme,
        structureLevel,
        fvg,
        klines
    );
    var i;
    var entryTouched;

    if (!isFormationValid(
        'LONG',
        entryPrice,
        sweepExtreme,
        structureLevel
    )) {
        return invalidate(
            result,
            setup,
            setup.availableIndex,
            'INVALIDATED_AT_FORMATION'
        );
    }

    for (i = setup.availableIndex + 1; i < klines.length; i++) {
        entryTouched = klines[i].low <= entryPrice;

        if (entryTouched) {
            return triggerEntry(
                result,
                setup,
                'LONG',
                liquidity,
                i
            );
        }

        if (klines[i].low < sweepExtreme) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_SWEEP'
            );
        }

        if (klines[i].low < structureLevel) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_STRUCTURE'
            );
        }

        if (hasOppositeMssAt(
            structureEvents,
            'BEARISH_MSS',
            i
        )) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_OPPOSITE_MSS'
            );
        }

        if (targetWasTakenBeforeEntry(
            'LONG',
            entryPrice,
            liquidity,
            i
        )) {
            return invalidate(
                result,
                setup,
                i,
                'EXPIRED_TARGET_TAKEN'
            );
        }
    }

    return result;
}

function processShortSetup(
    setup,
    klines,
    liquidity,
    structureEvents,
    entryMode
) {
    var fvg = setup.fvg;
    var entryPrice = getEntryPrice(
        'SHORT',
        fvg,
        entryMode
    );
    var sweepExtreme = setup.sweepExtreme;
    var structureLevel = setup.structureInvalidationLevel;
    var result = createEntryResult(
        setup,
        'SHORT',
        entryMode,
        entryPrice,
        sweepExtreme,
        structureLevel,
        fvg,
        klines
    );
    var i;
    var entryTouched;

    if (!isFormationValid(
        'SHORT',
        entryPrice,
        sweepExtreme,
        structureLevel
    )) {
        return invalidate(
            result,
            setup,
            setup.availableIndex,
            'INVALIDATED_AT_FORMATION'
        );
    }

    for (i = setup.availableIndex + 1; i < klines.length; i++) {
        entryTouched = klines[i].high >= entryPrice;

        if (entryTouched) {
            return triggerEntry(
                result,
                setup,
                'SHORT',
                liquidity,
                i
            );
        }

        if (klines[i].high > sweepExtreme) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_SWEEP'
            );
        }

        if (klines[i].high > structureLevel) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_STRUCTURE'
            );
        }

        if (hasOppositeMssAt(
            structureEvents,
            'BULLISH_MSS',
            i
        )) {
            return invalidate(
                result,
                setup,
                i,
                'INVALIDATED_OPPOSITE_MSS'
            );
        }

        if (targetWasTakenBeforeEntry(
            'SHORT',
            entryPrice,
            liquidity,
            i
        )) {
            return invalidate(
                result,
                setup,
                i,
                'EXPIRED_TARGET_TAKEN'
            );
        }
    }

    return result;
}

function analyze(input) {
    var result = [];
    var setups;
    var klines;
    var liquidity;
    var structureEvents;
    var entryMode;
    var setup;
    var i;

    input = input || {};
    setups = input.setups || [];
    klines = input.klines || [];
    liquidity = input.liquidity || {};
    structureEvents = input.structureEvents || [];
    entryMode = normalizeEntryMode(input.entryMode);

    for (i = 0; i < setups.length; i++) {
        setup = setups[i];

        if (!setup.fvg) {
            continue;
        }

        if (setup.type === 'LONG_SETUP') {
            result.push(
                processLongSetup(
                    setup,
                    klines,
                    liquidity,
                    structureEvents,
                    entryMode
                )
            );
        }

        if (setup.type === 'SHORT_SETUP') {
            result.push(
                processShortSetup(
                    setup,
                    klines,
                    liquidity,
                    structureEvents,
                    entryMode
                )
            );
        }
    }

    return result;
}

module.exports = {
    ENTRY_MODES: ENTRY_MODES,
    getEntryPrice: getEntryPrice,
    analyze: analyze
};
