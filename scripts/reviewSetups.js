process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';

var Binance = require('../api/binance');
var AnalysisEngine = require('../indicators/analysisEngine');
var SetupEngine = require('../indicators/setupEngine');

var DISTANCE_LIMITS = [12, 6, 3];

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

function getKlineTime(klines, index) {
    return klines[index]
        ? klines[index].openTime
        : null;
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

function createState(sequence, setupType) {
    return {
        sequence: sequence,
        setupType: setupType,
        position: 0,
        events: [],
        lastIndex: null
    };
}

function resetState(state) {
    state.position = 0;
    state.events = [];
    state.lastIndex = null;
}

function replayEvent(state, event) {
    var eventIndex = getEventIndex(event);
    var distanceLimit;
    var chain;

    if (event.type === state.sequence[0]) {
        state.position = 1;
        state.events = [event];
        state.lastIndex = eventIndex;
        return null;
    }

    if (state.position === 0) {
        return null;
    }

    distanceLimit = DISTANCE_LIMITS[state.position - 1];

    if (eventIndex - state.lastIndex > distanceLimit) {
        resetState(state);
        return null;
    }

    if (event.type !== state.sequence[state.position]) {
        return null;
    }

    state.events.push(event);
    state.position++;
    state.lastIndex = eventIndex;

    if (state.position < state.sequence.length) {
        return null;
    }

    chain = {
        type: state.setupType,
        triggerIndex: eventIndex,
        sweep: state.events[0],
        mss: state.events[1],
        displacement: state.events[2],
        fvg: state.events[3]
    };

    resetState(state);

    return chain;
}

function replaySetupChains(analysis) {
    var events = SetupEngine.mergeEvents({
        structureEvents: analysis.structureEvents,
        liquidityEvents: analysis.liquidity.sweeps,
        displacementEvents: analysis.displacementEvents,
        fvgEvents: analysis.fvgs
    });
    var longState = createState(
        LONG_SEQUENCE,
        'LONG_SETUP'
    );
    var shortState = createState(
        SHORT_SEQUENCE,
        'SHORT_SETUP'
    );
    var result = [];
    var chain;
    var i;

    for (i = 0; i < events.length; i++) {
        chain = replayEvent(longState, events[i]);

        if (chain) {
            result.push(chain);
        }

        chain = replayEvent(shortState, events[i]);

        if (chain) {
            result.push(chain);
        }
    }

    return result;
}

function findChain(setup, chains) {
    var i;

    for (i = 0; i < chains.length; i++) {
        if (
            chains[i].type === setup.type &&
            chains[i].triggerIndex === setup.triggerIndex
        ) {
            return chains[i];
        }
    }

    return null;
}

function getEventTimes(event, klines) {
    var index = getEventIndex(event);
    var time = getKlineTime(klines, index);

    return {
        index: index,
        utcTime: formatUtcTime(time),
        localTime: formatLocalTime(time)
    };
}

function printSetup(setup, chain, klines, number) {
    var setupTime = getKlineTime(
        klines,
        setup.triggerIndex
    );
    var sweepTime = getEventTimes(chain.sweep, klines);
    var mssTime = getEventTimes(chain.mss, klines);
    var displacementTime = getEventTimes(
        chain.displacement,
        klines
    );
    var fvgTime = getEventTimes(chain.fvg, klines);
    var startIndex = Math.max(0, setup.triggerIndex - 12);
    var endIndex = Math.min(
        klines.length - 1,
        setup.triggerIndex + 12
    );
    var context = [];
    var i;

    console.log('\n========================================');
    console.log('Setup #' + number);
    console.log('========================================');

    console.log('\nSetup:');
    console.log({
        type: setup.type,
        triggerIndex: setup.triggerIndex,
        utcTime: formatUtcTime(setupTime),
        localTime: formatLocalTime(setupTime)
    });

    console.log('\nComplete Event Chain:');
    console.log('Sweep:', {
        type: chain.sweep.type,
        index: sweepTime.index,
        utcTime: sweepTime.utcTime,
        localTime: sweepTime.localTime,
        price: chain.sweep.price
    });
    console.log('MSS:', {
        type: chain.mss.type,
        index: mssTime.index,
        utcTime: mssTime.utcTime,
        localTime: mssTime.localTime,
        price: chain.mss.price
    });
    console.log('Displacement:', {
        type: chain.displacement.type,
        index: displacementTime.index,
        utcTime: displacementTime.utcTime,
        localTime: displacementTime.localTime,
        score: chain.displacement.score,
        bodyRatio: chain.displacement.bodyRatio
    });
    console.log('FVG:', {
        type: chain.fvg.type,
        startIndex: chain.fvg.startIndex,
        endIndex: chain.fvg.endIndex,
        utcTime: fvgTime.utcTime,
        localTime: fvgTime.localTime,
        top: chain.fvg.top,
        bottom: chain.fvg.bottom,
        midpoint: chain.fvg.midpoint
    });

    console.log('\nEvent Distances:');
    console.log({
        'Sweep -> MSS bars':
            mssTime.index - sweepTime.index,
        'MSS -> Displacement bars':
            displacementTime.index - mssTime.index,
        'Displacement -> FVG bars':
            fvgTime.index - displacementTime.index
    });

    for (i = startIndex; i <= endIndex; i++) {
        context.push({
            index: i,
            utcTime: formatUtcTime(klines[i].openTime),
            localTime: formatLocalTime(klines[i].openTime),
            open: klines[i].open,
            high: klines[i].high,
            low: klines[i].low,
            close: klines[i].close
        });
    }

    console.log('\nKlines: 12 bars before and after Setup');
    console.table(context);
}

console.log(
    'Fetching BTCUSDT 1000 x 5m Klines through ' +
    'http://127.0.0.1:7890...'
);

Binance.getKlines('BTCUSDT', '5m', 1000)
    .then(function (klines) {
        var analysis = AnalysisEngine.analyzeMarket(klines);
        var chains = replaySetupChains(analysis);
        var chain;
        var i;

        console.log('\nSetup count:', analysis.setups.length);

        if (analysis.setups.length === 0) {
            console.log('No setup found.');
            return;
        }

        for (i = 0; i < analysis.setups.length; i++) {
            chain = findChain(analysis.setups[i], chains);

            if (!chain) {
                console.log(
                    'Unable to resolve event chain for Setup:',
                    analysis.setups[i]
                );
                continue;
            }

            printSetup(
                analysis.setups[i],
                chain,
                klines,
                i + 1
            );
        }
    })
    .catch(function (error) {
        console.error(
            error.response
                ? error.response.data
                : error.message
        );

        process.exitCode = 1;
    });
