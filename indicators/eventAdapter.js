var Displacement = require('./displacement');

function createDisplacementEvents(klines) {
    var result = [];
    var analysis;
    var type;
    var i;

    if (!klines || !klines.length) {
        return result;
    }

    for (i = 0; i < klines.length; i++) {
        analysis = Displacement.analyze(
            klines.slice(0, i + 1)
        );

        if (analysis.bullish === analysis.bearish) {
            continue;
        }

        if (!analysis.expansion) {
            continue;
        }

        if (analysis.bodyRatio < 0.6) {
            continue;
        }

        if (analysis.score < 3) {
            continue;
        }

        type = analysis.bullish
            ? 'BULLISH_DISPLACEMENT'
            : 'BEARISH_DISPLACEMENT';

        result.push({
            type: type,
            index: i,
            score: analysis.score,
            bodyRatio: analysis.bodyRatio,
            momentum: analysis.momentum,
            expansion: analysis.expansion,
            gap: analysis.gap
        });
    }

    return result;
}

module.exports = {
    createDisplacementEvents: createDisplacementEvents
};
