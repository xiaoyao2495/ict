var Binance = require('./api/binance');
var Pivot = require('./indicators/pivot');
var Swing = require('./indicators/swing');
var Structure = require('./indicators/structure');
var ProtectedSwing = require('./indicators/protectedSwing');
var MarketStructure = require('./indicators/marketStructure');
var StructureEngine = require('./indicators/structureEngine');
var BreakValidator = require('./indicators/breakValidator');
var StructureEngineV2 =
    require('./indicators/structureEngineV2');
Binance.getKlines('BTCUSDT', '1h', 300)
    .then(function (klines) {

        var pivots = Pivot.findPivots(klines, 2, 2);

        var swings = Swing.filterSwings(pivots);

        var structures = Structure.analyzeStructure(swings);

        var protectedSwings =
            ProtectedSwing.findProtectedSwings(swings);

        console.log('\n===== Market Structure =====');
        var market = MarketStructure.analyzeMarketStructure(
            swings,
            protectedSwings
        );

        console.log('\n===== Market Structure Summary =====');

        console.log({
            trend: market.trend,

            protectedLow:
                market.latestProtectedLow
                    ? market.latestProtectedLow.price
                    : null,

            protectedHigh:
                market.latestProtectedHigh
                    ? market.latestProtectedHigh.price
                    : null,

            latestBos: market.latestBos,

            latestMss: market.latestMss
        });
        console.table(
            structures.slice(-20).map(function (item) {
                return {
                    time: new Date(item.time).toLocaleString(),
                    price: item.price,
                    type: item.structure
                };
            })
        );

        console.log('\n===== Protected Swings =====');

        console.table(
            protectedSwings.slice(-10).map(function (item) {
                return {
                    time: new Date(item.time).toLocaleString(),
                    price: item.price,
                    type: item.type,
                    breakPrice: item.breakPrice
                };
            })
        );
        var structureEngineResult = StructureEngine.analyze(swings);

        console.log('\n===== Structure Engine =====');

        console.log('Trend:', structureEngineResult.trend);

        console.log(
            'Protected Low:',
            structureEngineResult.protectedLow
                ? structureEngineResult.protectedLow.price
                : null
        );

        console.log(
            'Protected High:',
            structureEngineResult.protectedHigh
                ? structureEngineResult.protectedHigh.price
                : null
        );

        console.table(
            structureEngineResult.events.slice(-20).map(function (item) {
                return {
                    time: new Date(item.time).toLocaleString(),
                    type: item.type,
                    price: item.price,
                    breakPrice: item.breakPrice
                };
            })
        );
        var market =
    StructureEngineV2.analyze(
        klines,
        swings,
        {
            averageLength: 20,
            displacementMultiplier: 1.5,
            minBodyRatio: 0.65
        }
    );

console.log('\n===== Structure Engine V2 =====');

console.log('Trend:', market.trend);

console.log(
    'Protected Low:',
    market.protectedLow
        ? market.protectedLow.price
        : null
);

console.log(
    'Protected High:',
    market.protectedHigh
        ? market.protectedHigh.price
        : null
);

console.table(
    market.events.slice(-30).map(function (item) {
        return {
            type: item.type,
            level: item.level,
            breakType: item.breakType,
            quality: item.quality || '',
            breakIndex: item.breakIndex
        };
    })
);
    })
    .catch(function (error) {
        console.error(
            error.response
                ? error.response.data
                : error.message
        );
    });