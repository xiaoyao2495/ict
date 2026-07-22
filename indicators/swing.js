function normalizeSwing(pivot) {
    var result = {};
    var property;
    var extremeIndex;
    var confirmationIndex;

    for (property in pivot) {
        if (
            Object.prototype.hasOwnProperty.call(
                pivot,
                property
            )
        ) {
            result[property] = pivot[property];
        }
    }

    extremeIndex = typeof pivot.extremeIndex === 'number'
        ? pivot.extremeIndex
        : pivot.index;
    confirmationIndex =
        typeof pivot.confirmationIndex === 'number'
            ? pivot.confirmationIndex
            : typeof pivot.availableIndex === 'number'
                ? pivot.availableIndex
                : extremeIndex;

    result.index = extremeIndex;
    result.extremeIndex = extremeIndex;
    result.confirmationIndex = confirmationIndex;
    result.availableIndex =
        typeof pivot.availableIndex === 'number'
            ? Math.max(
                pivot.availableIndex,
                confirmationIndex
            )
            : confirmationIndex;

    return result;
}

function filterSwings(pivots) {
    var result = [];
    var i;
    var current;
    var last;

    if (!pivots || !pivots.length) {
        return result;
    }

    for (i = 0; i < pivots.length; i++) {
        current = normalizeSwing(pivots[i]);
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
