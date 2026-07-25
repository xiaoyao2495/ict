'use strict';

const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const HtfPdArray = require('../indicators/ictHtfPdArrayEngine');
const H1Delivery = require('../indicators/ictH1DeliveryEngine');
const LtfExecution = require(
  '../indicators/ictLtfExecutionEngine'
);
const DeliveryValidation = require(
  './ictHtfBiasLtfConfirmationValidation'
);

const HORIZONS = Object.freeze([24, 48, 72]);
const YEARS = Object.freeze([
  2020, 2021, 2022, 2023, 2024, 2025, 2026,
]);
const PD_CATEGORIES = Object.freeze([
  'FVG', 'OB', 'BREAKER', 'BPR',
]);

function stateAtTime(states, time) {
  const index = LtfExecution.latestSnapshotIndex(states, time);
  return index >= 0 ? states[index] : null;
}

function matchingLocation(bias, location) {
  return (
    (bias === 'BULLISH' && location === 'DISCOUNT') ||
    (bias === 'BEARISH' && location === 'PREMIUM')
  );
}

function groupEligibleTouches(
  touches,
  h4States,
  periodByH4Index
) {
  const byPeriod = new Map();
  const eligible = [];
  for (const touch of touches) {
    const state = stateAtTime(h4States, touch.time);
    if (!state) continue;
    const period = periodByH4Index[state.index];
    if (
      !period ||
      state.narrative.bias !== touch.direction ||
      !matchingLocation(
        state.narrative.bias,
        state.dealingRange.location
      )
    ) {
      continue;
    }
    const item = {
      ...touch,
      periodId: period.id,
      bias: period.bias,
      location: state.dealingRange.location,
    };
    eligible.push(item);
    if (!byPeriod.has(period.id)) byPeriod.set(period.id, []);
    byPeriod.get(period.id).push(item);
  }
  for (const items of byPeriod.values()) {
    items.sort((left, right) => left.time - right.time);
  }
  return { eligible, byPeriod };
}

function matchConfluenceEvents(
  mssEvents,
  h4States,
  periodByH4Index,
  touchesByPeriod,
  ltfKlines
) {
  const events = [];
  const usedPeriods = new Set();
  for (const mss of mssEvents) {
    const sweep = mss.sweep;
    if (!sweep || !sweep.level) continue;
    const sweepPeriod = DeliveryValidation.periodAtTime(
      sweep.time,
      h4States,
      periodByH4Index
    );
    const mssPeriod = DeliveryValidation.periodAtTime(
      mss.time,
      h4States,
      periodByH4Index
    );
    if (
      !sweepPeriod ||
      !mssPeriod ||
      sweepPeriod.id !== mssPeriod.id ||
      mss.direction !== mssPeriod.bias ||
      !DeliveryValidation.allowedSweep(
        mssPeriod.bias,
        sweep.level
      ) ||
      usedPeriods.has(mssPeriod.id)
    ) {
      continue;
    }
    const priorTouches = (
      touchesByPeriod.get(mssPeriod.id) || []
    ).filter((touch) => touch.time < sweep.time);
    if (priorTouches.length === 0) continue;
    const referencePrice = ltfKlines[mss.index].close;
    if (!DeliveryValidation.primaryDrawAhead(
      mssPeriod,
      referencePrice
    )) {
      continue;
    }
    const categories = [...new Set(
      priorTouches.map((touch) => touch.category)
    )].sort();
    usedPeriods.add(mssPeriod.id);
    events.push({
      periodId: mssPeriod.id,
      bias: mssPeriod.bias,
      biasTime: mssPeriod.startTime,
      primaryDraw: { ...mssPeriod.primaryDraw },
      liquidityType: mssPeriod.primaryDraw.type,
      location: mssPeriod.bias === 'BULLISH'
        ? 'DISCOUNT'
        : 'PREMIUM',
      pdCategories: categories,
      pdTouches: priorTouches,
      sweep: {
        side: sweep.side,
        level: sweep.level,
        index: sweep.index,
        time: sweep.time,
      },
      mss,
      index: mss.index,
      availableIndex: mss.index,
      time: mss.time,
      year: new Date(mss.time).getUTCFullYear(),
      referencePrice,
    });
  }
  return events;
}

function distribution(items, keySelector) {
  return items.reduce((result, item) => {
    const key = keySelector(item);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function summarizeCategory(events, category, horizons) {
  const samples = events.filter(
    (event) => event.pdCategories.includes(category)
  );
  return {
    events: samples.length,
    directionDistribution: {
      BULLISH: samples.filter(
        (event) => event.bias === 'BULLISH'
      ).length,
      BEARISH: samples.filter(
        (event) => event.bias === 'BEARISH'
      ).length,
    },
    horizons: DeliveryValidation.summarizeHorizons(
      samples,
      horizons
    ),
  };
}

function buildCategoryStats(events, categories, horizons) {
  return Object.fromEntries(categories.map((category) => [
    category,
    summarizeCategory(events, category, horizons),
  ]));
}

function buildYearly(events, years, categories, horizons) {
  return Object.fromEntries(years.map((year) => {
    const samples = events.filter((event) => event.year === year);
    return [
      String(year),
      {
        events: samples.length,
        directionDistribution: {
          BULLISH: samples.filter(
            (event) => event.bias === 'BULLISH'
          ).length,
          BEARISH: samples.filter(
            (event) => event.bias === 'BEARISH'
          ).length,
        },
        horizons: DeliveryValidation.summarizeHorizons(
          samples,
          horizons
        ),
        byPdArray: buildCategoryStats(
          samples,
          categories,
          horizons
        ),
      },
    ];
  }));
}

function compareHorizons(control, treatment, horizons) {
  return Object.fromEntries(horizons.map((hours) => {
    const key = hours + 'h';
    const left = control[key];
    const right = treatment[key];
    function difference(rightValue, leftValue) {
      return rightValue === null || leftValue === null
        ? null
        : rightValue - leftValue;
    }
    return [
      key,
      {
        directionSuccessRateDelta:
          difference(
            right.directionSuccessRate,
            left.directionSuccessRate
          ),
        directionSuccessPercentagePointDelta:
          difference(
            right.directionSuccessRate,
            left.directionSuccessRate
          ) === null
            ? null
            : difference(
              right.directionSuccessRate,
              left.directionSuccessRate
            ) * 100,
        primaryDrawHitRateDelta:
          difference(
            right.primaryDrawHitRate,
            left.primaryDrawHitRate
          ),
        primaryDrawHitPercentagePointDelta:
          difference(
            right.primaryDrawHitRate,
            left.primaryDrawHitRate
          ) === null
            ? null
            : difference(
              right.primaryDrawHitRate,
              left.primaryDrawHitRate
            ) * 100,
        averageMFEDelta: difference(
          right.averageMFE,
          left.averageMFE
        ),
        averageMAEDelta: difference(
          right.averageMAE,
          left.averageMAE
        ),
      },
    ];
  }));
}

function analyze(input) {
  input = input || {};
  const horizons = input.horizons || HORIZONS;
  const years = input.years || YEARS;
  const h4 = HtfBiasV3.analyze({ h4Klines: input.h4Klines });
  const pd = HtfPdArray.analyze({
    h4Klines: input.h4Klines,
    retainStates: false,
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
  const biasTimeline = DeliveryValidation.buildBiasPeriods(
    h4.states
  );
  const touchTimeline = groupEligibleTouches(
    pd.events.touches,
    h4.states,
    biasTimeline.periodByH4Index
  );
  const confirmations = matchConfluenceEvents(
    ltf.events.mss,
    h4.states,
    biasTimeline.periodByH4Index,
    touchTimeline.byPeriod,
    input.ltf5mKlines
  );
  const controlConfirmations =
    DeliveryValidation.matchConfirmationEvents(
      ltf.events.mss,
      h4.states,
      biasTimeline.periodByH4Index,
      input.ltf5mKlines
    );
  const events = DeliveryValidation.attachOutcomes(
    confirmations,
    input.ltf5mKlines,
    horizons
  );
  const controlEvents = DeliveryValidation.attachOutcomes(
    controlConfirmations,
    input.ltf5mKlines,
    horizons
  );
  const controlHorizons =
    DeliveryValidation.summarizeHorizons(
      controlEvents,
      horizons
    );
  const confluenceHorizons =
    DeliveryValidation.summarizeHorizons(events, horizons);
  return {
    protocol: {
      validation:
        'ICT_HTF_PD_ARRAY_CONFLUENCE_VALIDATION_V1',
      htfBiasVersion: 'ICT_HTF_BIAS_ENGINE_V3',
      pdArrayVersion: pd.protocol.version,
      flow: [
        '4H directional Bias and Primary Draw',
        '4H Discount/Premium location',
        'Confirmed 4H FVG/OB/Breaker/BPR touch',
        'Later allowed opposite-side 5m liquidity sweep',
        'Same-direction 5m MSS after sweep',
        'Future HTF delivery validation',
      ],
      pdCategoryCohortsOverlap: true,
      readsTrades: false,
      readsBaseline: false,
      generatesEntry: false,
      generatesStop: false,
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
    eventCounts: {
      h4BiasPeriods: biasTimeline.periods.length,
      allPdArrays: pd.arrays.length,
      allPdTouches: pd.events.touches.length,
      eligibleBiasLocationPdTouches:
        touchTimeline.eligible.length,
      allowedSweeps: DeliveryValidation.countAllowedSweeps(
        ltf.events.sweeps,
        input.ltf5mKlines,
        h4.states,
        biasTimeline.periodByH4Index
      ),
      allLtfMss: ltf.events.mss.length,
      confirmedConfluenceEvents: events.length,
    },
    pdArrayDistribution: distribution(
      pd.arrays,
      (item) => item.category
    ),
    eligiblePdTouchDistribution: distribution(
      touchTimeline.eligible,
      (item) => item.category
    ),
    directionDistribution: {
      BULLISH: events.filter(
        (event) => event.bias === 'BULLISH'
      ).length,
      BEARISH: events.filter(
        (event) => event.bias === 'BEARISH'
      ).length,
    },
    sweepTypeDistribution: distribution(
      events,
      (event) => event.sweep.level.type
    ),
    primaryDrawTypeDistribution: distribution(
      events,
      (event) => event.liquidityType
    ),
    horizons: confluenceHorizons,
    comparison: {
      control:
        'Same 4H Bias → opposite-side 5m Sweep → same-direction MSS, without PD Array requirement',
      withoutPdArray: {
        events: controlEvents.length,
        horizons: controlHorizons,
      },
      withPdArrayConfluence: {
        events: events.length,
        horizons: confluenceHorizons,
      },
      delta: compareHorizons(
        controlHorizons,
        confluenceHorizons,
        horizons
      ),
    },
    byPdArray: buildCategoryStats(
      events,
      PD_CATEGORIES,
      horizons
    ),
    yearly: buildYearly(
      events,
      years,
      PD_CATEGORIES,
      horizons
    ),
    events,
  };
}

module.exports = {
  HORIZONS,
  PD_CATEGORIES,
  YEARS,
  analyze,
  buildCategoryStats,
  buildYearly,
  compareHorizons,
  groupEligibleTouches,
  matchConfluenceEvents,
  matchingLocation,
  stateAtTime,
  summarizeCategory,
};
