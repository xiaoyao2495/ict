function filterSwings(pivots) {
    var result = [];
    var i;
    var current;
    var last;

    if (!pivots || !pivots.length) {
        return result;
    }

    for (i = 0; i < pivots.length; i++) {
        current = pivots[i];
        last = result[result.length - 1];

        if (!last) {
            result.push(current);
            continue;
        }

        // 如果类型不同，直接加入
        if (last.type !== current.type) {
            result.push(current);
            continue;
        }

        // 连续两个 HIGH，只保留更高的
        if (current.type === 'HIGH') {
            if (current.price > last.price) {
                result[result.length - 1] = current;
            }
        }

        // 连续两个 LOW，只保留更低的
        if (current.type === 'LOW') {
            if (current.price < last.price) {
                result[result.length - 1] = current;
            }
        }
    }

    return result;
}

module.exports = {
    filterSwings: filterSwings
};