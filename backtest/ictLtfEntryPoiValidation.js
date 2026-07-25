'use strict';

const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const H1Delivery = require('../indicators/ictH1DeliveryEngine');
const LtfExecution = require(
  '../indicators/ictLtfExecutionEngine'
);
const PdArray = require('../indicators/ictHtfPdArrayEngine');
const DeliveryValidation = require(
  './ictHtfBiasLtfConfirmationValidation'
);

const RETURN_HORIZONS = Object.freeze([4, 12, 24]);
const R_HORIZON_HOURS = 24;
const YEARS = DeliveryValidation.YEARS;
const GROUP_CATEGORY = Object.freeze({
  B: 'FVG',
  C: 'OB',
  D: 'BREAKER',
  E: 'BPR',
});

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) /
      values.length
    : null;
}

function rate(count, total) {
  return total > 0 ? count / total : null;
}

function latestClosedKlineIndex(klines, time) {
  let low = 0;
  let high = klines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle].closeTime <= time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
}

function buildEntryEvent(base, details, klines) {
  const bullish = base.bias === 'BULLISH';
  const sweepIndex = base.sweep.index;
  if (
    !Number.isInteger(sweepIndex) ||
    !klines[sweepIndex]
  ) {
    return null;
  }
  const riskAnchor = bullish
    ? klines[sweepIndex].low
    : klines[sweepIndex].high;
  const referencePrice = details.referencePrice;
  const risk = bullish
    ? referencePrice - riskAnchor
    : riskAnchor - referencePrice;
  if (!(risk > 0)) return null;
  return {
    sourcePeriodId: base.periodId,
    sourceMssIndex: base.index,
    group: details.group,
    category: details.category || null,
    bias: base.bias,
    primaryDraw: { ...base.primaryDraw },
    sweep: base.sweep,
    mss: base.mss,
    poi: details.poi || null,
    index: details.index,
    availableIndex: details.index,
    time: details.time,
    year: new Date(details.time).getUTCFullYear(),
    referencePrice,
    riskAnchor,
    risk,
  };
}

function directMssEntry(base, klines) {
  return buildEntryEvent(base, {
    group: 'A',
    index: base.index,
    time: base.time,
    referencePrice: klines[base.index].close,
  }, klines);
}

function selectPoiEntriesForMss(
  base,
  pdResult,
  sliceStart,
  klines
) {
  const arraysById = new Map(
    pdResult.arrays.map((item) => [item.id, item])
  );
  const firstByCategory = new Map();
  for (const touch of pdResult.events.touches) {
    const item = arraysById.get(touch.arrayId);
    if (!item || item.direction !== base.bias) continue;
    const absoluteAvailableIndex =
      item.availableIndex + sliceStart;
    const absoluteTouchIndex = touch.index + sliceStart;
    if (
      absoluteAvailableIndex <= base.index ||
      absoluteTouchIndex <= absoluteAvailableIndex ||
      absoluteTouchIndex <= base.index ||
      touch.time <= base.time ||
      firstByCategory.has(item.category)
    ) {
      continue;
    }
    const referencePrice = base.bias === 'BULLISH'
      ? item.top
      : item.bottom;
    const entry = buildEntryEvent(base, {
      group: null,
      category: item.category,
      index: absoluteTouchIndex,
      time: touch.time,
      referencePrice,
      poi: {
        id: item.id,
        type: item.type,
        category: item.category,
        direction: item.direction,
        top: item.top,
        bottom: item.bottom,
        originIndex: item.originIndex + sliceStart,
        availableIndex: absoluteAvailableIndex,
        touchIndex: absoluteTouchIndex,
      },
    }, klines);
    if (entry) firstByCategory.set(item.category, entry);
  }
  return firstByCategory;
}

function findPoiEntries(
  confirmations,
  periods,
  klines
) {
  const periodById = new Map(
    periods.map((period) => [period.id, period])
  );
  const result = {
    A: [],
    B: [],
    C: [],
    D: [],
    E: [],
    F: [],
  };
  for (const base of confirmations) {
    const direct = directMssEntry(base, klines);
    if (direct) result.A.push(direct);
    const period = periodById.get(base.periodId);
    if (!period) continue;
    const endIndex = latestClosedKlineIndex(
      klines,
      period.endTime
    );
    const sliceStart = Math.max(0, base.index - 2);
    if (endIndex <= base.index + 1) continue;
    const slice = klines.slice(sliceStart, endIndex + 1);
    const pdResult = PdArray.analyze({
      klines: slice,
      intervalMilliseconds: LtfExecution.FIVE_MINUTES,
      retainStates: false,
    });
    const byCategory = selectPoiEntriesForMss(
      base,
      pdResult,
      sliceStart,
      klines
    );
    for (const [group, category] of Object.entries(
      GROUP_CATEGORY
    )) {
      const entry = byCategory.get(category);
      if (entry) result[group].push({ ...entry, group });
    }
    const any = [...byCategory.values()].sort(
      (left, right) => left.index - right.index
    )[0];
    if (any) result.F.push({ ...any, group: 'F' });
  }
  return result;
}

function directionalMove(bias, from, to) {
  return bias === 'BULLISH' ? to - from : from - to;
}

function evaluateRPath(entry, klines, horizonHours) {
  const endIndex = entry.index + horizonHours * 12;
  if (endIndex >= klines.length) return null;
  const bullish = entry.bias === 'BULLISH';
  const targets = [
    entry.referencePrice + (bullish ? 1 : -1) * entry.risk,
    entry.referencePrice + (bullish ? 2 : -2) * entry.risk,
  ];
  const reached = [false, false];
  const failed = [false, false];
  for (
    let index = entry.index + 1;
    index <= endIndex;
    index += 1
  ) {
    const bar = klines[index];
    const stopTouched = bullish
      ? bar.low <= entry.riskAnchor
      : bar.high >= entry.riskAnchor;
    for (let targetIndex = 0; targetIndex < 2; targetIndex += 1) {
      if (reached[targetIndex] || failed[targetIndex]) continue;
      const targetTouched = bullish
        ? bar.high >= targets[targetIndex]
        : bar.low <= targets[targetIndex];
      if (stopTouched) {
        failed[targetIndex] = true;
      } else if (targetTouched) {
        reached[targetIndex] = true;
      }
    }
    if (
      reached.every(Boolean) ||
      failed.every(Boolean)
    ) {
      break;
    }
  }
  return {
    horizonHours,
    oneRReached: reached[0],
    twoRReached: reached[1],
  };
}

function evaluateEntry(
  entry,
  klines,
  returnHorizons,
  rHorizonHours
) {
  const returns = {};
  for (const hours of returnHorizons) {
    const endIndex = entry.index + hours * 12;
    returns[hours + 'h'] = endIndex < klines.length
      ? directionalMove(
        entry.bias,
        entry.referencePrice,
        klines[endIndex].close
      ) / entry.referencePrice * 100
      : null;
  }
  const excursionEnd =
    entry.index + rHorizonHours * 12;
  let mfe = null;
  let mae = null;
  if (excursionEnd < klines.length) {
    let maximumFavorable = 0;
    let maximumAdverse = 0;
    for (
      let index = entry.index + 1;
      index <= excursionEnd;
      index += 1
    ) {
      const favorablePrice = entry.bias === 'BULLISH'
        ? klines[index].high
        : klines[index].low;
      const adversePrice = entry.bias === 'BULLISH'
        ? klines[index].low
        : klines[index].high;
      maximumFavorable = Math.max(
        maximumFavorable,
        directionalMove(
          entry.bias,
          entry.referencePrice,
          favorablePrice
        )
      );
      maximumAdverse = Math.max(
        maximumAdverse,
        -directionalMove(
          entry.bias,
          entry.referencePrice,
          adversePrice
        )
      );
    }
    mfe = maximumFavorable /
      entry.referencePrice * 100;
    mae = maximumAdverse /
      entry.referencePrice * 100;
  }
  return {
    ...entry,
    outcome: {
      rPath: evaluateRPath(
        entry,
        klines,
        rHorizonHours
      ),
      directionalReturns: returns,
      mfe,
      mae,
    },
  };
}

function summarize(entries, returnHorizons) {
  const rOutcomes = entries
    .map((entry) => entry.outcome.rPath)
    .filter(Boolean);
  const oneRReached = rOutcomes.filter(
    (outcome) => outcome.oneRReached
  ).length;
  const twoRReached = rOutcomes.filter(
    (outcome) => outcome.twoRReached
  ).length;
  return {
    entries: entries.length,
    rEligibleEntries: rOutcomes.length,
    oneRReached,
    oneRRate: rate(oneRReached, rOutcomes.length),
    twoRReached,
    twoRRate: rate(twoRReached, rOutcomes.length),
    averageDirectionalReturns: Object.fromEntries(
      returnHorizons.map((hours) => {
        const values = entries
          .map((entry) => (
            entry.outcome.directionalReturns[hours + 'h']
          ))
          .filter((value) => value !== null);
        return [hours + 'h', average(values)];
      })
    ),
    averageMFE: average(
      entries.map((entry) => entry.outcome.mfe)
        .filter((value) => value !== null)
    ),
    averageMAE: average(
      entries.map((entry) => entry.outcome.mae)
        .filter((value) => value !== null)
    ),
  };
}

function buildYearly(entries, years, returnHorizons) {
  return Object.fromEntries(years.map((year) => [
    String(year),
    summarize(
      entries.filter((entry) => entry.year === year),
      returnHorizons
    ),
  ]));
}

function analyze(input) {
  input = input || {};
  const returnHorizons =
    input.returnHorizons || RETURN_HORIZONS;
  const rHorizonHours =
    input.rHorizonHours || R_HORIZON_HOURS;
  const years = input.years || YEARS;
  const h4 = HtfBiasV3.analyze({
    h4Klines: input.h4Klines,
  });
  const h1 = H1Delivery.analyze({
    h1Klines: input.h1Klines,
    h4BiasSnapshots: h4.states,
    includeLiquidity: false,
  });
  const ltf = LtfExecution.analyze({
    ltfKlines: input.ltf5mKlines,
    intervalMilliseconds: LtfExecution.FIVE_MINUTES,
    h4BiasSnapshots: h4.states,
    h1DeliverySnapshots: h1.states,
    retainStates: false,
  });
  const timeline = DeliveryValidation.buildBiasPeriods(
    h4.states
  );
  const confirmations =
    DeliveryValidation.matchConfirmationEvents(
      ltf.events.mss,
      h4.states,
      timeline.periodByH4Index,
      input.ltf5mKlines
    );
  const rawGroups = findPoiEntries(
    confirmations,
    timeline.periods,
    input.ltf5mKlines
  );
  const groups = Object.fromEntries(
    Object.entries(rawGroups).map(([group, entries]) => {
      const evaluated = entries.map((entry) => evaluateEntry(
        entry,
        input.ltf5mKlines,
        returnHorizons,
        rHorizonHours
      ));
      return [
        group,
        {
          definition: group === 'A'
            ? 'MSS confirmation reference'
            : group === 'F'
              ? 'First retest of any post-MSS PD Array'
              : 'First retest of post-MSS ' +
                GROUP_CATEGORY[group],
          ...summarize(evaluated, returnHorizons),
          yearly: buildYearly(
            evaluated,
            years,
            returnHorizons
          ),
        },
      ];
    })
  );
  return {
    protocol: {
      validation: 'ICT_LTF_ENTRY_POI_VALIDATION_V1',
      flow: [
        '4H Bias + Primary Draw',
        'Opposite-side 5m Liquidity Sweep',
        'Same-direction 5m MSS',
        'Confirmed post-MSS 5m PD Array',
        'First later 5m retest',
      ],
      entryReference:
        'Bullish zone top / Bearish zone bottom; MSS close for Group A',
      riskAnchor:
        'Extreme of the 5m candle that swept liquidity',
      rHorizonHours,
      rCollisionPolicy:
        'If stop and R target are touched in the same 5m candle, stop wins',
      excursionHorizonHours: rHorizonHours,
      readsTrades: false,
      readsBaseline: false,
      callsEntryEngine: false,
      generatesOrders: false,
      parameterSearch: false,
      usesConfirmedCandles: true,
      usesAvailableIndex: true,
      modifiesProduction: false,
    },
    source: {
      h4Klines: input.h4Klines.length,
      h1Klines: input.h1Klines.length,
      ltf5mKlines: input.ltf5mKlines.length,
      from: input.ltf5mKlines[0].openTime,
      to: input.ltf5mKlines[
        input.ltf5mKlines.length - 1
      ].closeTime,
    },
    upstream: {
      h4BiasPeriods: timeline.periods.length,
      ltfMss: ltf.events.mss.length,
      confirmedSweepMssEvents: confirmations.length,
    },
    groups,
  };
}

module.exports = {
  GROUP_CATEGORY,
  R_HORIZON_HOURS,
  RETURN_HORIZONS,
  YEARS,
  analyze,
  buildEntryEvent,
  buildYearly,
  directMssEntry,
  directionalMove,
  evaluateEntry,
  evaluateRPath,
  findPoiEntries,
  latestClosedKlineIndex,
  selectPoiEntriesForMss,
  summarize,
};
