var Pivot = require('./pivot');
var Swing = require('./swing');
var StructureEngineV2 = require('./structureEngineV2');
var Liquidity = require('./liquidity');
var EventAdapter = require('./eventAdapter');
var FVG = require('./fvg');
var SetupEngine = require('./setupEngine');
var HTFContextAnalyzer = require('./htfContextAnalyzer');

function analyzeMarket(klines) {
    var pivots = Pivot.findPivots(klines, 2, 2);
    var swings = Swing.filterSwings(pivots);
    var structureResult = StructureEngineV2.analyze(
        klines,
        swings,
        {
            averageLength: 20,
            displacementMultiplier: 1.5,
            minBodyRatio: 0.65
        }
    );
    var liquidity = Liquidity.analyze(swings, klines);
    var displacementEvents =
        EventAdapter.createDisplacementEvents(klines);
    var fvgs = FVG.findFVGs(klines);
    var setups = SetupEngine.analyze({
        structureEvents: structureResult.events,
        liquidityEvents: liquidity.sweeps,
        displacementEvents: displacementEvents,
        fvgEvents: fvgs
    });

    setups = HTFContextAnalyzer.attachContexts(
        setups,
        klines
    );

    return {
        swings: swings,
        structureEvents: structureResult.events,
        liquidity: liquidity,
        displacementEvents: displacementEvents,
        fvgs: fvgs,
        setups: setups
    };
}

module.exports = {
    analyzeMarket: analyzeMarket
};
