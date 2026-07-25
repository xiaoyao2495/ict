'use strict';

const AnalystReport = require(
  '../indicators/ictHtfAnalystReport'
);

const BIAS_HORIZONS = Object.freeze([4, 12, 24, 48]);
const PRIMARY_DRAW_HORIZONS = Object.freeze([24, 48, 72]);
const OBSERVATION_HORIZONS = Object.freeze([1, 4, 12]);
const DELIVERY_HORIZON = 24;
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);
const DELIVERY_RELATIONS = Object.freeze([
  'ALIGNED',
  'RETRACEMENT',
  'COUNTER_TREND',
]);
const PRIMARY_DRAW_TYPES = Object.freeze([
  'PWH',
  'PWL',
  'PDH',
  'PDL',
  'H4_SWING',
]);

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) /
      values.length
    : null;
}

function rate(count, total) {
  return total > 0 ? count / total : null;
}

function normalizePrimaryDrawType(type) {
  if (type === 'H4_SWING_HIGH' || type === 'H4_SWING_LOW') {
    return 'H4_SWING';
  }
  return PRIMARY_DRAW_TYPES.includes(type) ? type : null;
}

function primaryDrawSignature(draw) {
  return draw
    ? [
      draw.type,
      draw.side,
      draw.price,
      draw.availableIndex,
    ].join(':')
    : null;
}

function eventBase(snapshot, direction, sourceIndex) {
  return {
    index: snapshot.index,
    availableIndex: snapshot.availableIndex,
    sourceAvailableIndex: sourceIndex,
    time: snapshot.asOf,
    year: new Date(snapshot.asOf).getUTCFullYear(),
    referencePrice: snapshot.referencePrice,
    direction,
  };
}

function extractAnalystEvents(input) {
  const events = {
    h4Bias: [],
    primaryDraw: [],
    h1Delivery: [],
    observations: [],
  };
  let lastH4Index = null;
  let lastH1Index = null;
  let previousBias = 'UNAVAILABLE';
  let previousDrawSignature = null;
  let previousDeliverySignature = null;

  AnalystReport.analyze({
    ...input,
    retainSnapshots: false,
    onSnapshot(snapshot) {
      const h4 = snapshot.fourHourAnalysis;
      const h1 = snapshot.oneHourAnalysis;
      const observation =
        snapshot.fiveMinuteObservation.potentialObservation;
      const referencePrice = input.ltf5mKlines[
        snapshot.index
      ].close;
      const enrichedSnapshot = {
        ...snapshot,
        referencePrice,
      };

      if (
        h4.status === 'AVAILABLE' &&
        h4.index !== lastH4Index
      ) {
        lastH4Index = h4.index;
        if (
          (h4.bias === 'BULLISH' ||
            h4.bias === 'BEARISH') &&
          h4.bias !== previousBias
        ) {
          events.h4Bias.push({
            ...eventBase(
              enrichedSnapshot,
              h4.bias,
              h4.availableIndex
            ),
            bias: h4.bias,
          });
        }
        previousBias = h4.bias;

        const draw = h4.primaryDraw;
        const normalizedType = draw
          ? normalizePrimaryDrawType(draw.type)
          : null;
        const signature = primaryDrawSignature(draw);
        if (
          draw &&
          normalizedType &&
          signature !== previousDrawSignature
        ) {
          events.primaryDraw.push({
            ...eventBase(
              enrichedSnapshot,
              h4.bias,
              h4.availableIndex
            ),
            draw: { ...draw },
            drawType: normalizedType,
          });
        }
        previousDrawSignature = signature;
      }

      if (
        h1.status === 'AVAILABLE' &&
        h1.index !== lastH1Index
      ) {
        lastH1Index = h1.index;
        const direction = h1.deliveryDirection;
        const relation = h1.relationToH4;
        const eligible = (
          DELIVERY_RELATIONS.includes(relation) &&
          (
            direction === 'BULLISH' ||
            direction === 'BEARISH'
          )
        );
        const signature = eligible
          ? relation + ':' + direction
          : null;
        if (
          eligible &&
          signature !== previousDeliverySignature
        ) {
          events.h1Delivery.push({
            ...eventBase(
              enrichedSnapshot,
              direction,
              h1.availableIndex
            ),
            relation,
            deliveryDirection: direction,
            h4Bias: h1.h4Bias,
          });
        }
        previousDeliverySignature = signature;
      }

      if (
        observation.state ===
          'POTENTIAL_LONG_OBSERVATION' ||
        observation.state ===
          'POTENTIAL_SHORT_OBSERVATION'
      ) {
        const direction = observation.side === 'LONG'
          ? 'BULLISH'
          : 'BEARISH';
        events.observations.push({
          ...eventBase(
            enrichedSnapshot,
            direction,
            observation.availableIndex
          ),
          observation: observation.state,
          side: observation.side,
          h4Bias: h4.bias,
          h1Relation: h1.relationToH4,
        });
      }
    },
  });
  return events;
}

function evaluateDirectional(event, klines, horizonHours) {
  const endIndex = event.index + horizonHours * 12;
  if (endIndex >= klines.length) return null;
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
  const move = bullish
    ? endClose - event.referencePrice
    : event.referencePrice - endClose;
  const mfe = bullish
    ? maximumHigh - event.referencePrice
    : event.referencePrice - minimumLow;
  const mae = bullish
    ? event.referencePrice - minimumLow
    : maximumHigh - event.referencePrice;
  return {
    horizonHours,
    directionCorrect: move > 0,
    directionalReturn: move / event.referencePrice * 100,
    mfe: Math.max(0, mfe) / event.referencePrice * 100,
    mae: Math.max(0, mae) / event.referencePrice * 100,
  };
}

function attachDirectionalOutcomes(events, klines, horizons) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluateDirectional(event, klines, hours),
    ])),
  }));
}

function evaluatePrimaryDraw(event, klines, horizonHours) {
  const endIndex = event.index + horizonHours * 12;
  if (endIndex >= klines.length) return null;
  let hitIndex = null;
  for (
    let index = event.index + 1;
    index <= endIndex;
    index += 1
  ) {
    const hit = event.draw.side === 'BUY_SIDE'
      ? klines[index].high >= event.draw.price
      : klines[index].low <= event.draw.price;
    if (hit) {
      hitIndex = index;
      break;
    }
  }
  return {
    horizonHours,
    hit: hitIndex !== null,
    hitIndex,
  };
}

function attachPrimaryDrawOutcomes(events, klines, horizons) {
  return events.map((event) => ({
    ...event,
    outcomes: Object.fromEntries(horizons.map((hours) => [
      hours + 'h',
      evaluatePrimaryDraw(event, klines, hours),
    ])),
  }));
}

function summarizeDirectional(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => {
    const outcomes = events
      .map((event) => event.outcomes[hours + 'h'])
      .filter(Boolean);
    const correct = outcomes.filter(
      (outcome) => outcome.directionCorrect
    ).length;
    return [
      hours + 'h',
      {
        eligibleEvents: outcomes.length,
        directionCorrect: correct,
        directionAccuracy: rate(correct, outcomes.length),
        averageDirectionalReturn: average(
          outcomes.map((outcome) => outcome.directionalReturn)
        ),
        averageMFE: average(
          outcomes.map((outcome) => outcome.mfe)
        ),
        averageMAE: average(
          outcomes.map((outcome) => outcome.mae)
        ),
      },
    ];
  }));
}

function summarizePrimaryDraw(events, horizons) {
  return Object.fromEntries(horizons.map((hours) => {
    const outcomes = events
      .map((event) => event.outcomes[hours + 'h'])
      .filter(Boolean);
    const hits = outcomes.filter(
      (outcome) => outcome.hit
    ).length;
    return [
      hours + 'h',
      {
        eligibleEvents: outcomes.length,
        hits,
        hitRate: rate(hits, outcomes.length),
      },
    ];
  }));
}

function directionalBreakdown(
  events,
  groups,
  key,
  horizons
) {
  return Object.fromEntries(groups.map((group) => {
    const samples = events.filter(
      (event) => event[key] === group
    );
    return [
      group,
      {
        events: samples.length,
        horizons: summarizeDirectional(samples, horizons),
      },
    ];
  }));
}

function primaryDrawBreakdown(events, horizons) {
  return Object.fromEntries(PRIMARY_DRAW_TYPES.map((type) => {
    const samples = events.filter(
      (event) => event.drawType === type
    );
    return [
      type,
      {
        events: samples.length,
        horizons: summarizePrimaryDraw(samples, horizons),
      },
    ];
  }));
}

function yearlyDirectional(
  events,
  years,
  horizons,
  breakdownGroups,
  breakdownKey
) {
  return Object.fromEntries(years.map((year) => {
    const samples = events.filter(
      (event) => event.year === year
    );
    return [
      String(year),
      {
        events: samples.length,
        horizons: summarizeDirectional(samples, horizons),
        breakdown: breakdownGroups
          ? directionalBreakdown(
            samples,
            breakdownGroups,
            breakdownKey,
            horizons
          )
          : null,
      },
    ];
  }));
}

function yearlyPrimaryDraw(events, years, horizons) {
  return Object.fromEntries(years.map((year) => {
    const samples = events.filter(
      (event) => event.year === year
    );
    return [
      String(year),
      {
        events: samples.length,
        horizons: summarizePrimaryDraw(samples, horizons),
        byType: primaryDrawBreakdown(samples, horizons),
      },
    ];
  }));
}

function analyze(input) {
  input = input || {};
  const years = input.years || YEARS;
  const events = extractAnalystEvents(input);
  const biasEvents = attachDirectionalOutcomes(
    events.h4Bias,
    input.ltf5mKlines,
    BIAS_HORIZONS
  );
  const drawEvents = attachPrimaryDrawOutcomes(
    events.primaryDraw,
    input.ltf5mKlines,
    PRIMARY_DRAW_HORIZONS
  );
  const deliveryEvents = attachDirectionalOutcomes(
    events.h1Delivery,
    input.ltf5mKlines,
    [DELIVERY_HORIZON]
  );
  const observationEvents = attachDirectionalOutcomes(
    events.observations,
    input.ltf5mKlines,
    OBSERVATION_HORIZONS
  );
  return {
    protocol: {
      validation: 'ICT_HTF_ANALYST_REPORT_VALIDATION_V1',
      sourceReport: 'ICT_HTF_ANALYST_REPORT_V1',
      eventSampling: {
        h4Bias: 'First state of each continuous directional Bias period',
        primaryDraw: 'First state of each unique active Primary Draw',
        h1Delivery:
          'First state of each continuous relation + delivery direction period',
        observation:
          'Each confirmed Potential Long/Short observation',
      },
      signalStateUsesFutureData: false,
      futureDataUsedOnlyForPostEventValidation: true,
      prefixInvariantEventExtraction: true,
      readsTrades: false,
      generatesTrade: false,
      generatesEquityCurve: false,
      parameterSearch: false,
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
    eventCounts: {
      h4Bias: biasEvents.length,
      primaryDraw: drawEvents.length,
      h1Delivery: deliveryEvents.length,
      observations: observationEvents.length,
    },
    h4BiasValidation: {
      events: biasEvents.length,
      directionDistribution: {
        BULLISH: biasEvents.filter(
          (event) => event.bias === 'BULLISH'
        ).length,
        BEARISH: biasEvents.filter(
          (event) => event.bias === 'BEARISH'
        ).length,
      },
      horizons: summarizeDirectional(
        biasEvents,
        BIAS_HORIZONS
      ),
      byBias: directionalBreakdown(
        biasEvents,
        ['BULLISH', 'BEARISH'],
        'bias',
        BIAS_HORIZONS
      ),
      yearly: yearlyDirectional(
        biasEvents,
        years,
        BIAS_HORIZONS,
        ['BULLISH', 'BEARISH'],
        'bias'
      ),
    },
    primaryDrawValidation: {
      events: drawEvents.length,
      horizons: summarizePrimaryDraw(
        drawEvents,
        PRIMARY_DRAW_HORIZONS
      ),
      byType: primaryDrawBreakdown(
        drawEvents,
        PRIMARY_DRAW_HORIZONS
      ),
      yearly: yearlyPrimaryDraw(
        drawEvents,
        years,
        PRIMARY_DRAW_HORIZONS
      ),
    },
    h1DeliveryValidation: {
      events: deliveryEvents.length,
      byRelation: directionalBreakdown(
        deliveryEvents,
        DELIVERY_RELATIONS,
        'relation',
        [DELIVERY_HORIZON]
      ),
      yearly: yearlyDirectional(
        deliveryEvents,
        years,
        [DELIVERY_HORIZON],
        DELIVERY_RELATIONS,
        'relation'
      ),
    },
    observationValidation: {
      events: observationEvents.length,
      directionDistribution: {
        LONG: observationEvents.filter(
          (event) => event.side === 'LONG'
        ).length,
        SHORT: observationEvents.filter(
          (event) => event.side === 'SHORT'
        ).length,
      },
      horizons: summarizeDirectional(
        observationEvents,
        OBSERVATION_HORIZONS
      ),
      bySide: directionalBreakdown(
        observationEvents,
        ['LONG', 'SHORT'],
        'side',
        OBSERVATION_HORIZONS
      ),
      yearly: yearlyDirectional(
        observationEvents,
        years,
        OBSERVATION_HORIZONS,
        ['LONG', 'SHORT'],
        'side'
      ),
    },
    events: input.includeEvents === true
      ? {
        h4Bias: biasEvents,
        primaryDraw: drawEvents,
        h1Delivery: deliveryEvents,
        observations: observationEvents,
      }
      : null,
  };
}

module.exports = {
  BIAS_HORIZONS,
  DELIVERY_HORIZON,
  DELIVERY_RELATIONS,
  OBSERVATION_HORIZONS,
  PRIMARY_DRAW_HORIZONS,
  PRIMARY_DRAW_TYPES,
  YEARS,
  analyze,
  attachDirectionalOutcomes,
  attachPrimaryDrawOutcomes,
  directionalBreakdown,
  evaluateDirectional,
  evaluatePrimaryDraw,
  extractAnalystEvents,
  normalizePrimaryDrawType,
  primaryDrawBreakdown,
  primaryDrawSignature,
  summarizeDirectional,
  summarizePrimaryDraw,
  yearlyDirectional,
  yearlyPrimaryDraw,
};
