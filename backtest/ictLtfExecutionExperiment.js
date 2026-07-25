'use strict';

const HtfBiasV2 = require('../indicators/ictHtfBiasEngineV2');
const H1Delivery = require('../indicators/ictH1DeliveryEngine');
const LtfExecution = require(
  '../indicators/ictLtfExecutionEngine'
);

const HORIZONS = Object.freeze([24, 48, 72]);
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);

function rate(count, total) {
  return total > 0 ? count / total : null;
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function distribution(items, selector, values) {
  const counts = Object.fromEntries(
    values.map((value) => [value, 0])
  );
  for (const item of items) {
    const value = selector(item);
    if (!Object.prototype.hasOwnProperty.call(counts, value)) {
      counts[value] = 0;
    }
    counts[value] += 1;
  }
  return Object.fromEntries(Object.entries(counts).map(
    ([value, count]) => [
      value,
      {
        count,
        rate: rate(count, items.length),
      },
    ]
  ));
}

function h4BiasStats(states) {
  let appearances = 0;
  let previous = null;
  for (const state of states) {
    const bias = state.narrative.bias;
    if (bias !== previous && bias !== 'NEUTRAL') appearances += 1;
    previous = bias;
  }
  return {
    snapshots: states.length,
    distribution: distribution(
      states,
      (state) => state.narrative.bias,
      ['BULLISH', 'BEARISH', 'NEUTRAL']
    ),
    nonNeutralAppearances: appearances,
  };
}

function evaluateMssEvent(event, klines, horizonHours, duration) {
  const barsPerHour = 60 * 60 * 1000 / duration;
  const horizonBars = horizonHours * barsPerHour;
  const endIndex = event.index + horizonBars;
  if (!Number.isInteger(horizonBars) || endIndex >= klines.length) {
    return null;
  }
  const bullish = event.direction === 'BULLISH';
  let maximumHigh = -Infinity;
  let minimumLow = Infinity;
  for (
    let index = event.index + 1;
    index <= endIndex;
    index += 1
  ) {
    maximumHigh = Math.max(maximumHigh, klines[index].high);
    minimumLow = Math.min(minimumLow, klines[index].low);
  }
  const endClose = klines[endIndex].close;
  const directionSuccess = bullish
    ? endClose > event.referencePrice
    : endClose < event.referencePrice;
  const mfe = bullish
    ? (maximumHigh - event.referencePrice) /
      event.referencePrice * 100
    : (event.referencePrice - minimumLow) /
      event.referencePrice * 100;
  const mae = bullish
    ? (event.referencePrice - minimumLow) /
      event.referencePrice * 100
    : (maximumHigh - event.referencePrice) /
      event.referencePrice * 100;
  return {
    horizonHours,
    directionSuccess,
    returnPercent: bullish
      ? (endClose - event.referencePrice) /
        event.referencePrice * 100
      : (event.referencePrice - endClose) /
        event.referencePrice * 100,
    mfe: Math.max(0, mfe),
    mae: Math.max(0, mae),
  };
}

function attachMssOutcomes(events, klines, horizons, duration) {
  return events.map((event) => ({
    ...event,
    year: new Date(event.time).getUTCFullYear(),
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateMssEvent(event, klines, hours, duration),
    ])),
  }));
}

function summarizeMss(events, horizonHours) {
  const key = horizonHours + 'h';
  const outcomes = events
    .map((event) => event.outcomes[key])
    .filter(Boolean);
  const successes = outcomes.filter(
    (outcome) => outcome.directionSuccess
  ).length;
  return {
    eligibleEvents: outcomes.length,
    successes,
    directionSuccessRate: rate(successes, outcomes.length),
    averageReturn: average(
      outcomes.map((outcome) => outcome.returnPercent)
    ),
    averageMFE: average(outcomes.map((outcome) => outcome.mfe)),
    averageMAE: average(outcomes.map((outcome) => outcome.mae)),
  };
}

function summarizeMssHorizons(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => [
    hours + 'h',
    summarizeMss(events, hours),
  ]));
}

function buildMitigationMap(mitigations) {
  return new Map(mitigations.map(
    (event) => [event.id, event]
  ));
}

function summarizeFvg(
  fvgs,
  mitigations,
  horizons,
  duration,
  totalLtfBars
) {
  const mitigationById = buildMitigationMap(mitigations);
  const eventualMitigated = fvgs.filter(
    (fvg) => mitigationById.has(fvg.id)
  ).length;
  const byHorizon = Object.fromEntries(horizons.map((hours) => {
    const maximumBars = hours *
      (60 * 60 * 1000 / duration);
    const eligible = fvgs.filter(
      (fvg) => fvg.index + maximumBars < totalLtfBars
    );
    const count = eligible.filter((fvg) => {
      const mitigation = mitigationById.get(fvg.id);
      return mitigation &&
        mitigation.index - fvg.index <= maximumBars;
    }).length;
    return [
      hours + 'h',
      {
        eligibleFvgs: eligible.length,
        mitigated: count,
        mitigationRate: rate(count, eligible.length),
      },
    ];
  }));
  return {
    created: fvgs.length,
    eventuallyMitigated: eventualMitigated,
    eventualMitigationRate: rate(eventualMitigated, fvgs.length),
    byHorizon,
  };
}

function buildYearly(
  h4States,
  setups,
  fvgs,
  mitigations,
  horizons,
  duration,
  totalLtfBars,
  years
) {
  return Object.fromEntries(years.map((year) => {
    const yearH4 = h4States.filter(
      (state) => new Date(state.time).getUTCFullYear() === year
    );
    const yearSetups = setups.filter((event) => event.year === year);
    const yearFvgs = fvgs.filter(
      (fvg) => new Date(fvg.createdAt).getUTCFullYear() === year
    );
    return [
      String(year),
      {
        h4Bias: h4BiasStats(yearH4),
        qualifiedMssCount: yearSetups.length,
        mss: summarizeMssHorizons(yearSetups, horizons),
        fvg: summarizeFvg(
          yearFvgs,
          mitigations,
          horizons,
          duration,
          totalLtfBars
        ),
      },
    ];
  }));
}

function analyze(input) {
  input = input || {};
  const horizons = input.horizons || HORIZONS;
  const years = input.years || YEARS;
  const h4 = HtfBiasV2.analyze({ h4Klines: input.h4Klines });
  const h1 = H1Delivery.analyze({
    h1Klines: input.h1Klines,
    h4BiasSnapshots: h4.states,
    includeLiquidity: false,
  });
  const ltf = LtfExecution.analyze({
    ltfKlines: input.ltfKlines,
    intervalMilliseconds: input.intervalMilliseconds,
    h4BiasSnapshots: h4.states,
    h1DeliverySnapshots: h1.states,
    retainStates: false,
  });
  const duration = ltf.protocol.intervalMilliseconds;
  const setups = attachMssOutcomes(
    ltf.events.setups,
    input.ltfKlines,
    horizons,
    duration
  );
  return {
    protocol: {
      experiment: 'ICT_LTF_EXECUTION_EXPERIMENT',
      inputs: [
        'Published 4H HTF Bias',
        'Published 1H Delivery',
        'Complete closed 5m/15m Klines',
      ],
      readsTrades: false,
      readsBaseline: false,
      generatesEntryExit: false,
      modifiesProduction: false,
      qualifiedMssDefinition:
        'HTF Bias + 1H ALIGNED + prior sweep + displacement + MSS',
    },
    source: {
      h4Klines: input.h4Klines.length,
      h1Klines: input.h1Klines.length,
      ltfKlines: input.ltfKlines.length,
      intervalMilliseconds: duration,
      from: input.ltfKlines[0].openTime,
      to: input.ltfKlines[input.ltfKlines.length - 1].closeTime,
    },
    h4Bias: h4BiasStats(h4.states),
    eventCounts: {
      sweeps: ltf.events.sweeps.length,
      displacements: ltf.events.displacements.length,
      allMss: ltf.events.mss.length,
      qualifiedMss: setups.length,
      fvgs: ltf.events.fvgs.length,
      fvgMitigations: ltf.events.fvgMitigations.length,
    },
    qualifiedDirectionDistribution: distribution(
      setups,
      (event) => event.direction,
      ['BULLISH', 'BEARISH']
    ),
    mss: summarizeMssHorizons(setups, horizons),
    fvg: summarizeFvg(
      ltf.events.fvgs,
      ltf.events.fvgMitigations,
      horizons,
      duration,
      input.ltfKlines.length
    ),
    yearly: buildYearly(
      h4.states,
      setups,
      ltf.events.fvgs,
      ltf.events.fvgMitigations,
      horizons,
      duration,
      input.ltfKlines.length,
      years
    ),
    events: {
      qualifiedMss: setups,
    },
  };
}

module.exports = {
  HORIZONS,
  YEARS,
  analyze,
  attachMssOutcomes,
  buildMitigationMap,
  buildYearly,
  distribution,
  evaluateMssEvent,
  h4BiasStats,
  summarizeFvg,
  summarizeMss,
  summarizeMssHorizons,
};
