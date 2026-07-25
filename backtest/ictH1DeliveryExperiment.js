'use strict';

const HtfBiasV2 = require('../indicators/ictHtfBiasEngineV2');
const H1Delivery = require('../indicators/ictH1DeliveryEngine');

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

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function distribution(states, selector, values) {
  const counts = Object.fromEntries(
    values.map((value) => [value, 0])
  );
  for (const state of states) {
    const value = selector(state);
    if (!Object.prototype.hasOwnProperty.call(counts, value)) {
      counts[value] = 0;
    }
    counts[value] += 1;
  }
  return {
    totalSnapshots: states.length,
    values: Object.fromEntries(Object.entries(counts).map(
      ([value, count]) => [
        value,
        {
          snapshots: count,
          rate: rate(count, states.length),
        },
      ]
    )),
  };
}

function h4BiasDistribution(states) {
  return distribution(
    states,
    (state) => state.narrative.bias,
    ['BULLISH', 'BEARISH', 'NEUTRAL']
  );
}

function deliveryDistribution(states) {
  return {
    direction: distribution(
      states,
      (state) => state.deliveryDirection,
      ['BULLISH', 'BEARISH', 'TRANSITION', 'NEUTRAL']
    ),
    state: distribution(
      states,
      (state) => state.deliveryState,
      [
        'ALIGNED_BULLISH',
        'ALIGNED_BEARISH',
        'RETRACEMENT',
        'COUNTER_TREND',
        'NEUTRAL',
      ]
    ),
    relation: distribution(
      states,
      (state) => state.relationToH4,
      ['ALIGNED', 'RETRACEMENT', 'COUNTER_TREND', 'UNCLEAR']
    ),
  };
}

function extractAlignedEvents(states) {
  const events = [];
  let previousAligned = false;
  for (const state of states) {
    const aligned = state.relationToH4 === 'ALIGNED';
    if (aligned && !previousAligned && state.h4Context.primaryDraw) {
      events.push({
        index: state.index,
        availableIndex: state.availableIndex,
        time: state.time,
        year: new Date(state.time).getUTCFullYear(),
        referencePrice: state.referencePrice,
        deliveryState: state.deliveryState,
        h4Bias: state.h4Context.bias,
        primaryDraw: { ...state.h4Context.primaryDraw },
      });
    }
    previousAligned = aligned;
  }
  return events;
}

function evaluateAlignedEvent(event, h1Klines, horizonHours) {
  const endIndex = event.index + horizonHours;
  if (endIndex >= h1Klines.length) return null;
  const bullish = event.primaryDraw.side === 'BUY_SIDE';
  let maximumHigh = -Infinity;
  let minimumLow = Infinity;
  let closestDistance = Math.abs(
    event.primaryDraw.price - event.referencePrice
  );
  let targetHitIndex = null;

  for (
    let index = event.index + 1;
    index <= endIndex;
    index += 1
  ) {
    const bar = h1Klines[index];
    maximumHigh = Math.max(maximumHigh, bar.high);
    minimumLow = Math.min(minimumLow, bar.low);
    const favorablePrice = bullish ? bar.high : bar.low;
    closestDistance = Math.min(
      closestDistance,
      Math.abs(event.primaryDraw.price - favorablePrice)
    );
    const hit = bullish
      ? bar.high >= event.primaryDraw.price
      : bar.low <= event.primaryDraw.price;
    if (hit && targetHitIndex === null) targetHitIndex = index;
  }

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
  const startingDistance = Math.abs(
    event.primaryDraw.price - event.referencePrice
  );
  return {
    horizonHours,
    targetHit: targetHitIndex !== null,
    targetHitIndex,
    directionalDelivery: mfe > mae,
    mfe: Math.max(0, mfe),
    mae: Math.max(0, mae),
    progressToTarget: startingDistance > 0
      ? Math.max(
        0,
        Math.min(1, (startingDistance - closestDistance) /
          startingDistance)
      )
      : 1,
  };
}

function attachOutcomes(events, h1Klines, horizons) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateAlignedEvent(event, h1Klines, hours),
    ])),
  }));
}

function summarizeAligned(events, horizonHours) {
  const key = horizonHours + 'h';
  const outcomes = events
    .map((event) => event.outcomes[key])
    .filter(Boolean);
  const targetHits = outcomes.filter(
    (outcome) => outcome.targetHit
  ).length;
  const directional = outcomes.filter(
    (outcome) => outcome.directionalDelivery
  ).length;
  return {
    eligibleEvents: outcomes.length,
    directionalDeliveries: directional,
    directionalDeliveryRate: rate(directional, outcomes.length),
    primaryDrawHits: targetHits,
    primaryDrawHitRate: rate(targetHits, outcomes.length),
    averageMFE: average(outcomes.map((outcome) => outcome.mfe)),
    averageMAE: average(outcomes.map((outcome) => outcome.mae)),
    averageProgressToTarget: average(
      outcomes.map((outcome) => outcome.progressToTarget)
    ),
  };
}

function summarizeAlignedHorizons(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => [
    hours + 'h',
    summarizeAligned(events, hours),
  ]));
}

function extractRelationPeriods(states, relation) {
  const periods = [];
  let current = null;
  for (const state of states) {
    if (state.relationToH4 !== relation) {
      if (current) periods.push(current);
      current = null;
      continue;
    }
    if (!current) {
      current = {
        relation,
        startIndex: state.index,
        endIndex: state.index,
        startTime: state.time,
        endTime: state.time,
        hours: 1,
      };
    } else {
      current.endIndex = state.index;
      current.endTime = state.time;
      current.hours += 1;
    }
  }
  if (current) periods.push(current);
  return periods;
}

function summarizeDurations(periods) {
  const hours = periods.map((period) => period.hours);
  return {
    periods: periods.length,
    averageHours: average(hours),
    medianHours: median(hours),
    maxHours: hours.length > 0 ? Math.max(...hours) : null,
  };
}

function counterTrendFrequency(states) {
  const count = states.filter(
    (state) => state.relationToH4 === 'COUNTER_TREND'
  ).length;
  const directionalContext = states.filter((state) => (
    state.h4Context.structure === 'BULLISH' ||
    state.h4Context.structure === 'BEARISH'
  )).length;
  return {
    snapshots: count,
    rateOfAllSnapshots: rate(count, states.length),
    directional4HContextSnapshots: directionalContext,
    rateWithinDirectional4HContext: rate(
      count,
      directionalContext
    ),
  };
}

function buildYearly(
  h4States,
  h1States,
  events,
  retracementPeriods,
  years,
  horizons
) {
  return Object.fromEntries(years.map((year) => {
    const yearH4 = h4States.filter(
      (state) => new Date(state.time).getUTCFullYear() === year
    );
    const yearH1 = h1States.filter(
      (state) => new Date(state.time).getUTCFullYear() === year
    );
    const yearEvents = events.filter((event) => event.year === year);
    const yearRetracements = retracementPeriods.filter(
      (period) => (
        new Date(period.startTime).getUTCFullYear() === year
      )
    );
    return [
      String(year),
      {
        h4BiasDistribution: h4BiasDistribution(yearH4),
        deliveryDistribution: deliveryDistribution(yearH1),
        alignedEventCount: yearEvents.length,
        aligned: summarizeAlignedHorizons(yearEvents, horizons),
        retracementDuration: summarizeDurations(yearRetracements),
        counterTrendFrequency: counterTrendFrequency(yearH1),
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
  });
  const events = attachOutcomes(
    extractAlignedEvents(h1.states),
    input.h1Klines,
    horizons
  );
  const retracementPeriods = extractRelationPeriods(
    h1.states,
    'RETRACEMENT'
  );

  return {
    protocol: {
      experiment: 'ICT_H1_DELIVERY_EXPERIMENT',
      inputs: [
        'Complete closed 4H Klines',
        'Complete closed 1H Klines',
      ],
      reads5m: false,
      readsSetup: false,
      readsEntryExit: false,
      readsTrades: false,
      modifiesProduction: false,
      alignedSample:
        'First 1H snapshot of each continuous ALIGNED period',
      directionalDeliveryDefinition:
        'MFE toward the frozen 4H draw is greater than MAE',
    },
    source: {
      h4Klines: input.h4Klines.length,
      h1Klines: input.h1Klines.length,
      from: input.h1Klines[0].openTime,
      to: input.h1Klines[input.h1Klines.length - 1].closeTime,
    },
    h4BiasDistribution: h4BiasDistribution(h4.states),
    deliveryDistribution: deliveryDistribution(h1.states),
    alignedEventCount: events.length,
    aligned: summarizeAlignedHorizons(events, horizons),
    retracementDuration: summarizeDurations(retracementPeriods),
    counterTrendFrequency: counterTrendFrequency(h1.states),
    yearly: buildYearly(
      h4.states,
      h1.states,
      events,
      retracementPeriods,
      years,
      horizons
    ),
    events,
  };
}

module.exports = {
  HORIZONS,
  YEARS,
  analyze,
  attachOutcomes,
  buildYearly,
  counterTrendFrequency,
  deliveryDistribution,
  distribution,
  evaluateAlignedEvent,
  extractAlignedEvents,
  extractRelationPeriods,
  h4BiasDistribution,
  summarizeAligned,
  summarizeAlignedHorizons,
  summarizeDurations,
};
