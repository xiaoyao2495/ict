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

    if (!pivots || !pivots.length) {
        return result;
    }

    for (i = 0; i < pivots.length; i++) {
        /*
         * Pivot 在 availableIndex 已经确认后就是不可变事件。
         * 后续同类 Pivot 只能追加，不能删除或替换历史 Swing。
         */
        result.push(normalizeSwing(pivots[i]));
    }

    return result;
}

module.exports = {
    filterSwings: filterSwings
};
