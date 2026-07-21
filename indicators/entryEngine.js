function findMatchingFVG(setup, fvgs) {
    var expectedType = setup.type === 'LONG_SETUP'
        ? 'BULLISH_FVG'
        : 'BEARISH_FVG';
    var i;

    for (i = 0; i < fvgs.length; i++) {
        if (
            fvgs[i].type === expectedType &&
            fvgs[i].endIndex === setup.triggerIndex
        ) {
            return fvgs[i];
        }
    }

    return null;
}

function appendLiquidityPrices(
    result,
    levels,
    expectedType
) {
    var i;

    if (!levels || !levels.length) {
        return;
    }

    for (i = 0; i < levels.length; i++) {
        if (
            levels[i].type === expectedType &&
            typeof levels[i].price === 'number'
        ) {
            result.push(levels[i].price);
        }
    }
}

function findLongTarget(entry, stop, liquidity) {
    var prices = [];
    var target = null;
    var i;

    liquidity = liquidity || {};

    appendLiquidityPrices(
        prices,
        liquidity.equalHighs,
        'EQUAL_HIGH'
    );
    appendLiquidityPrices(
        prices,
        liquidity.previousDayLevels,
        'PDH'
    );

    for (i = 0; i < prices.length; i++) {
        if (
            prices[i] > entry &&
            (target === null || prices[i] < target)
        ) {
            target = prices[i];
        }
    }

    if (target === null) {
        target = entry + (entry - stop) * 2;
    }

    return target;
}

function findShortTarget(entry, stop, liquidity) {
    var prices = [];
    var target = null;
    var i;

    liquidity = liquidity || {};

    appendLiquidityPrices(
        prices,
        liquidity.equalLows,
        'EQUAL_LOW'
    );
    appendLiquidityPrices(
        prices,
        liquidity.previousDayLevels,
        'PDL'
    );

    for (i = 0; i < prices.length; i++) {
        if (
            prices[i] < entry &&
            (target === null || prices[i] > target)
        ) {
            target = prices[i];
        }
    }

    if (target === null) {
        target = entry - (stop - entry) * 2;
    }

    return target;
}

function createLongEntry(setup, fvg, klines, liquidity) {
    var result = {
        type: 'LONG_ENTRY',
        status: 'SETUP_FORMED',
        entry: fvg.midpoint,
        setupIndex: setup.triggerIndex,
        triggerIndex: null,
        stop: fvg.bottom,
        target: findLongTarget(
            fvg.midpoint,
            fvg.bottom,
            liquidity
        )
    };
    var startIndex = Math.max(
        setup.triggerIndex,
        fvg.endIndex
    ) + 1;
    var i;

    for (i = startIndex; i < klines.length; i++) {
        if (klines[i].low <= fvg.bottom) {
            result.status = 'INVALIDATED';
            result.triggerIndex = i;
            return result;
        }

        if (klines[i].low <= fvg.midpoint) {
            result.status = 'ENTRY_TRIGGERED';
            result.triggerIndex = i;
            return result;
        }
    }

    return result;
}

function createShortEntry(setup, fvg, klines, liquidity) {
    var result = {
        type: 'SHORT_ENTRY',
        status: 'SETUP_FORMED',
        entry: fvg.midpoint,
        setupIndex: setup.triggerIndex,
        triggerIndex: null,
        stop: fvg.top,
        target: findShortTarget(
            fvg.midpoint,
            fvg.top,
            liquidity
        )
    };
    var startIndex = Math.max(
        setup.triggerIndex,
        fvg.endIndex
    ) + 1;
    var i;

    for (i = startIndex; i < klines.length; i++) {
        if (klines[i].high >= fvg.top) {
            result.status = 'INVALIDATED';
            result.triggerIndex = i;
            return result;
        }

        if (klines[i].high >= fvg.midpoint) {
            result.status = 'ENTRY_TRIGGERED';
            result.triggerIndex = i;
            return result;
        }
    }

    return result;
}

function analyze(input) {
    var result = [];
    var setups;
    var fvgs;
    var klines;
    var liquidity;
    var setup;
    var fvg;
    var i;

    input = input || {};
    setups = input.setups || [];
    fvgs = input.fvgs || [];
    klines = input.klines || [];
    liquidity = input.liquidity || {};

    for (i = 0; i < setups.length; i++) {
        setup = setups[i];
        fvg = findMatchingFVG(setup, fvgs);

        if (!fvg) {
            continue;
        }

        if (setup.type === 'LONG_SETUP') {
            result.push(
                createLongEntry(
                    setup,
                    fvg,
                    klines,
                    liquidity
                )
            );
        }

        if (setup.type === 'SHORT_SETUP') {
            result.push(
                createShortEntry(
                    setup,
                    fvg,
                    klines,
                    liquidity
                )
            );
        }
    }

    return result;
}

module.exports = {
    analyze: analyze
};
