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
const PdConfluence = require(
  './ictHtfPdArrayConfluenceValidation'
);

const EXECUTION_HORIZONS = Object.freeze([1, 4, 12, 24]);
const TARGET_HORIZON = 72;
const ALL_HORIZONS = Object.freeze([
  ...EXECUTION_HORIZONS,
  TARGET_HORIZON,
]);
const YEARS = DeliveryValidation.YEARS;

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

function eventFromPeriod(period, index, time, klines, stage) {
  if (!Number.isInteger(index) || index < 0) return null;
  const referencePrice = klines[index].close;
  if (!DeliveryValidation.primaryDrawAhead(
    period,
    referencePrice
  )) {
    return null;
  }
  return {
    periodId: period.id,
    stage,
    bias: period.bias,
    biasTime: period.startTime,
    primaryDraw: { ...period.primaryDraw },
    liquidityType: period.primaryDraw.type,
    index,
    availableIndex: index,
    time,
    year: new Date(time).getUTCFullYear(),
    referencePrice,
  };
}

function buildBiasEvents(periods, ltfKlines) {
  const result = [];
  for (const period of periods) {
    const index = latestClosedKlineIndex(
      ltfKlines,
      period.startTime
    );
    const event = eventFromPeriod(
      period,
      index,
      period.startTime,
      ltfKlines,
      'BIAS_PRIMARY_DRAW'
    );
    if (event) result.push(event);
  }
  return result;
}

function buildSweepEvents(
  sweeps,
  h4States,
  periodByH4Index,
  ltfKlines
) {
  const result = [];
  const usedPeriods = new Set();
  for (const sweep of sweeps) {
    const period = DeliveryValidation.periodAtTime(
      sweep.time,
      h4States,
      periodByH4Index
    );
    if (
      !period ||
      usedPeriods.has(period.id) ||
      !DeliveryValidation.allowedSweep(period.bias, sweep)
    ) {
      continue;
    }
    const index = sweep.sweptIndex;
    const event = eventFromPeriod(
      period,
      index,
      sweep.time,
      ltfKlines,
      'BIAS_PRIMARY_DRAW_SWEEP'
    );
    if (!event) continue;
    usedPeriods.add(period.id);
    result.push({
      ...event,
      sweep: {
        side: sweep.side,
        level: sweep,
        index,
        time: sweep.time,
      },
    });
  }
  return result;
}

function buildYearly(events, years, horizons) {
  return Object.fromEntries(years.map((year) => {
    const samples = events.filter(
      (event) => event.year === year
    );
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
      },
    ];
  }));
}

function summarizeGroup(events, years, horizons) {
  return {
    events: events.length,
    directionDistribution: {
      BULLISH: events.filter(
        (event) => event.bias === 'BULLISH'
      ).length,
      BEARISH: events.filter(
        (event) => event.bias === 'BEARISH'
      ).length,
    },
    horizons: DeliveryValidation.summarizeHorizons(
      events,
      horizons
    ),
    yearly: buildYearly(events, years, horizons),
  };
}

function analyze(input) {
  input = input || {};
  const executionHorizons =
    input.executionHorizons || EXECUTION_HORIZONS;
  const targetHorizon =
    input.targetHorizon || TARGET_HORIZON;
  const horizons = [
    ...new Set(executionHorizons.concat(targetHorizon)),
  ];
  const years = input.years || YEARS;

  const h4 = HtfBiasV3.analyze({
    h4Klines: input.h4Klines,
  });
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
  const timeline = DeliveryValidation.buildBiasPeriods(
    h4.states
  );

  const groupA = buildBiasEvents(
    timeline.periods,
    input.ltf5mKlines
  );
  const groupB = buildSweepEvents(
    ltf.events.sweeps,
    h4.states,
    timeline.periodByH4Index,
    input.ltf5mKlines
  );
  const groupC = DeliveryValidation.matchConfirmationEvents(
    ltf.events.mss,
    h4.states,
    timeline.periodByH4Index,
    input.ltf5mKlines
  );
  const touchTimeline = PdConfluence.groupEligibleTouches(
    pd.events.touches,
    h4.states,
    timeline.periodByH4Index
  );
  const groupD = PdConfluence.matchConfluenceEvents(
    ltf.events.mss,
    h4.states,
    timeline.periodByH4Index,
    touchTimeline.byPeriod,
    input.ltf5mKlines
  );

  const attached = {
    A: DeliveryValidation.attachOutcomes(
      groupA,
      input.ltf5mKlines,
      horizons
    ),
    B: DeliveryValidation.attachOutcomes(
      groupB,
      input.ltf5mKlines,
      horizons
    ),
    C: DeliveryValidation.attachOutcomes(
      groupC,
      input.ltf5mKlines,
      horizons
    ),
    D: DeliveryValidation.attachOutcomes(
      groupD,
      input.ltf5mKlines,
      horizons
    ),
  };

  return {
    protocol: {
      validation:
        'ICT_LTF_CONFIRMATION_ABLATION_VALIDATION_V2',
      eventPolicy:
        'First qualifying event per continuous 4H Bias/Primary Draw period',
      groups: {
        A: '4H Bias + Primary Draw',
        B: 'A + opposite-side 5m Liquidity Sweep',
        C: 'B + same-direction 5m MSS',
        D: '4H Bias + matching-location 4H PD Array touch + 5m Sweep + MSS',
      },
      executionHorizonsHours: executionHorizons,
      primaryDrawHorizonHours: targetHorizon,
      readsTrades: false,
      readsBaseline: false,
      generatesEntry: false,
      generatesStop: false,
      generatesTarget: false,
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
      pdArrays: pd.arrays.length,
      pdTouches: pd.events.touches.length,
      ltfSweeps: ltf.events.sweeps.length,
      ltfMss: ltf.events.mss.length,
    },
    groups: Object.fromEntries(
      Object.entries(attached).map(([name, events]) => [
        name,
        summarizeGroup(events, years, horizons),
      ])
    ),
  };
}

module.exports = {
  ALL_HORIZONS,
  EXECUTION_HORIZONS,
  TARGET_HORIZON,
  YEARS,
  analyze,
  buildBiasEvents,
  buildSweepEvents,
  buildYearly,
  eventFromPeriod,
  latestClosedKlineIndex,
  summarizeGroup,
};
