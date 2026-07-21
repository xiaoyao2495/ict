function analyzeStructure(swings) {
    var result = [];
    var lastHigh = null;
    var lastLow = null;
    var i;
    var swing;
    var structure;

    if (!swings || !swings.length) {
        return result;
    }

    for (i = 0; i < swings.length; i++) {
        swing = swings[i];
        structure = null;

        if (swing.type === 'HIGH') {
            if (!lastHigh) {
                structure = 'H';
            } else if (swing.price > lastHigh.price) {
                structure = 'HH';
            } else if (swing.price < lastHigh.price) {
                structure = 'LH';
            } else {
                structure = 'EH';
            }

            lastHigh = swing;
        }

        if (swing.type === 'LOW') {
            if (!lastLow) {
                structure = 'L';
            } else if (swing.price > lastLow.price) {
                structure = 'HL';
            } else if (swing.price < lastLow.price) {
                structure = 'LL';
            } else {
                structure = 'EL';
            }

            lastLow = swing;
        }

        result.push({
            index: swing.index,
            time: swing.time,
            price: swing.price,
            pivotType: swing.type,
            structure: structure
        });
    }

    return result;
}

module.exports = {
    analyzeStructure: analyzeStructure
};