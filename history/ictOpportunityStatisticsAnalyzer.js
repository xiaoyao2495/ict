'use strict';

const OpportunityHistory = require(
  './ictOpportunityHistory'
);

const LIQUIDITY_TYPES = Object.freeze([
  'PDL',
  'PWL',
  'H4_SWING_LOW',
  'EQUAL_LOW',
  'PDH',
  'PWH',
  'H4_SWING_HIGH',
  'EQUAL_HIGH',
]);

const TIME_BUCKETS = Object.freeze([
  Object.freeze({ label: '0-8', start: 0, end: 8 }),
  Object.freeze({ label: '8-16', start: 8, end: 16 }),
  Object.freeze({ label: '16-24', start: 16, end: 24 }),
]);

function opportunityKey(entry) {
  return [
    entry.symbol || '',
    entry.h4Bias || '',
    entry.direction || '',
    entry.liquidityType || '',
    Number.isFinite(entry.liquidityPrice)
      ? entry.liquidityPrice
      : '',
  ].join('|');
}

function createOpportunity(entry, fromWaiting) {
  return {
    symbol: entry.symbol,
    h4Bias: entry.h4Bias,
    direction: entry.direction,
    liquidityType: entry.liquidityType,
    liquidityPrice: entry.liquidityPrice,
    watchZoneAt:
      entry.status === 'WATCH_ZONE'
        ? entry.changedAt
        : null,
    fromWaiting: Boolean(fromWaiting),
    reachedConfirming:
      entry.status === 'CONFIRMING',
    reachedConfirmed:
      entry.status === 'CONFIRMED',
    key: opportunityKey(entry),
  };
}

function extractSymbolOpportunities(record) {
  const transitions = record.transitions
    .slice()
    .sort((left, right) => (
      Date.parse(left.changedAt) -
      Date.parse(right.changedAt)
    ));
  const opportunities = [];
  let waitingCount = 0;
  let waitingToWatchZoneCount = 0;
  let pendingWaiting = false;
  let active = null;

  function finishActive() {
    if (active && active.watchZoneAt) {
      opportunities.push(active);
    }
    active = null;
  }

  for (const entry of transitions) {
    if (entry.status === 'WAITING') {
      finishActive();
      waitingCount += 1;
      pendingWaiting = true;
      continue;
    }

    const key = opportunityKey(entry);
    if (
      active &&
      (
        active.key !== key ||
        active.reachedConfirmed
      )
    ) {
      finishActive();
    }

    if (entry.status === 'WATCH_ZONE') {
      if (!active) {
        active = createOpportunity(
          entry,
          pendingWaiting
        );
        if (pendingWaiting) {
          waitingToWatchZoneCount += 1;
        }
      }
      if (!active.watchZoneAt) {
        active.watchZoneAt = entry.changedAt;
      }
      pendingWaiting = false;
      continue;
    }

    if (entry.status === 'CONFIRMING') {
      if (!active) {
        active = createOpportunity(entry, false);
      }
      active.reachedConfirming = true;
      pendingWaiting = false;
      continue;
    }

    if (entry.status === 'CONFIRMED') {
      if (!active) {
        active = createOpportunity(entry, false);
      }
      active.reachedConfirmed = true;
      pendingWaiting = false;
      finishActive();
    }
  }
  finishActive();

  return {
    opportunities,
    waitingCount,
    waitingToWatchZoneCount,
  };
}

function ratio(numerator, denominator) {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function createCohort(label) {
  return {
    label,
    count: 0,
    confirmedCount: 0,
    conversionRate: 0,
  };
}

function beijingHour(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return (new Date(timestamp).getUTCHours() + 8) % 24;
}

function findTimeBucket(hour) {
  return TIME_BUCKETS.find(
    (bucket) => hour >= bucket.start &&
      hour < bucket.end
  );
}

function analyze(input) {
  const history = OpportunityHistory.normalizeHistory(input);
  const opportunities = [];
  let waitingCount = 0;
  let waitingToWatchZoneCount = 0;

  for (const record of Object.values(history.symbols)) {
    const extracted = extractSymbolOpportunities(record);
    opportunities.push(...extracted.opportunities);
    waitingCount += extracted.waitingCount;
    waitingToWatchZoneCount +=
      extracted.waitingToWatchZoneCount;
  }

  const watchZoneToConfirmingCount =
    opportunities.filter(
      (item) => item.reachedConfirming
    ).length;
  const watchZoneToConfirmedCount =
    opportunities.filter(
      (item) => item.reachedConfirmed
    ).length;

  const liquidityMap = Object.fromEntries(
    LIQUIDITY_TYPES.map(
      (type) => [type, createCohort(type)]
    )
  );
  const timeMap = Object.fromEntries(
    TIME_BUCKETS.map(
      (bucket) => [
        bucket.label,
        createCohort(bucket.label),
      ]
    )
  );

  for (const opportunity of opportunities) {
    const liquidity =
      liquidityMap[opportunity.liquidityType];
    if (liquidity) {
      liquidity.count += 1;
      if (opportunity.reachedConfirmed) {
        liquidity.confirmedCount += 1;
      }
    }

    const hour = beijingHour(opportunity.watchZoneAt);
    const bucket = hour === null
      ? null
      : findTimeBucket(hour);
    if (bucket) {
      const cohort = timeMap[bucket.label];
      cohort.count += 1;
      if (opportunity.reachedConfirmed) {
        cohort.confirmedCount += 1;
      }
    }
  }

  const liquidityTypes = LIQUIDITY_TYPES.map((type) => {
    const cohort = liquidityMap[type];
    cohort.conversionRate = ratio(
      cohort.confirmedCount,
      cohort.count
    );
    return cohort;
  });
  const timeBuckets = TIME_BUCKETS.map((bucket) => {
    const cohort = timeMap[bucket.label];
    cohort.conversionRate = ratio(
      cohort.confirmedCount,
      cohort.count
    );
    return cohort;
  });

  return {
    totalOpportunities: opportunities.length,
    transitions: {
      waitingToWatchZone: {
        sourceCount: waitingCount,
        convertedCount: waitingToWatchZoneCount,
        ratio: ratio(
          waitingToWatchZoneCount,
          waitingCount
        ),
      },
      watchZoneToConfirming: {
        sourceCount: opportunities.length,
        convertedCount: watchZoneToConfirmingCount,
        ratio: ratio(
          watchZoneToConfirmingCount,
          opportunities.length
        ),
      },
      watchZoneToConfirmed: {
        sourceCount: opportunities.length,
        convertedCount: watchZoneToConfirmedCount,
        ratio: ratio(
          watchZoneToConfirmedCount,
          opportunities.length
        ),
      },
    },
    liquidityTypes,
    timeBuckets,
    opportunities,
  };
}

module.exports = {
  LIQUIDITY_TYPES,
  TIME_BUCKETS,
  analyze,
  beijingHour,
  extractSymbolOpportunities,
  findTimeBucket,
  opportunityKey,
  ratio,
};
