'use strict';

const IDENTITY_VERSION = 2;
const DEFAULT_ZONE_TOLERANCE = 0.002;
const DEFAULT_MAX_ZONE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOLERANCE_SOURCE = 'DEFAULT';
const DEFAULT_AGE_SOURCE = 'DEFAULT';

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function validDirection(value) {
  return value === 'BULLISH' || value === 'BEARISH';
}

function validPrice(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0;
}

function normalizeOpportunity(value) {
  if (!isObject(value)) return null;
  if (
    !validDirection(value.direction) ||
    typeof value.liquidityType !== 'string' ||
    value.liquidityType.length === 0 ||
    !validPrice(value.price)
  ) {
    return null;
  }
  return {
    direction: value.direction,
    liquidityType: value.liquidityType,
    price: value.price,
  };
}

function rawOpportunityId(value) {
  const opportunity = normalizeOpportunity(value);
  if (!opportunity) return null;
  return [
    opportunity.direction,
    opportunity.liquidityType,
    String(opportunity.price),
  ].join('|');
}

function normalizeTimestamp(value) {
  let timestamp;
  if (value === undefined || value === null) return null;
  if (value instanceof Date) timestamp = value.getTime();
  else if (typeof value === 'string') timestamp = Date.parse(value);
  else timestamp = value;
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? timestamp
    : null;
}

function configuredTolerance(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : DEFAULT_ZONE_TOLERANCE;
}

function configuredMaxAge(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : DEFAULT_MAX_ZONE_AGE_MS;
}

function priceDistancePercent(anchorPrice, currentPrice) {
  if (!validPrice(anchorPrice) || !validPrice(currentPrice)) {
    return null;
  }
  return Math.abs(currentPrice - anchorPrice) / anchorPrice;
}

function previousZone(value) {
  if (!isObject(value)) return null;
  if (
    !validDirection(value.direction) ||
    typeof value.liquidityType !== 'string' ||
    !value.liquidityType ||
    !validPrice(value.anchorPrice)
  ) {
    return null;
  }
  const zoneId = typeof value.zoneId === 'string' && value.zoneId
    ? value.zoneId
    : typeof value.canonicalZoneId === 'string' &&
        value.canonicalZoneId
      ? value.canonicalZoneId
      : rawOpportunityId({
        direction: value.direction,
        liquidityType: value.liquidityType,
        price: value.anchorPrice,
      });
  if (!zoneId) return null;
  return {
    identityVersion: IDENTITY_VERSION,
    zoneId,
    canonicalZoneId: zoneId,
    direction: value.direction,
    liquidityType: value.liquidityType,
    anchorPrice: value.anchorPrice,
    currentPrice: validPrice(value.currentPrice)
      ? value.currentPrice
      : value.anchorPrice,
    tolerancePercent: configuredTolerance(
      value.tolerancePercent
    ),
    toleranceSource:
      typeof value.toleranceSource === 'string' &&
      value.toleranceSource
        ? value.toleranceSource
        : DEFAULT_TOLERANCE_SOURCE,
    maxZoneAgeMs: configuredMaxAge(value.maxZoneAgeMs),
    ageSource:
      typeof value.ageSource === 'string' && value.ageSource
        ? value.ageSource
        : DEFAULT_AGE_SOURCE,
    createdAt: normalizeTimestamp(value.createdAt),
    lastObservedAt: normalizeTimestamp(value.lastObservedAt),
    minObservedPrice: validPrice(value.minObservedPrice)
      ? value.minObservedPrice
      : value.anchorPrice,
    maxObservedPrice: validPrice(value.maxObservedPrice)
      ? value.maxObservedPrice
      : value.anchorPrice,
    rawOpportunityIds: Array.isArray(value.rawOpportunityIds)
      ? value.rawOpportunityIds.filter((id) => (
        typeof id === 'string' && id.length > 0
      ))
      : [],
  };
}

function lifecycleWindow(previous, observedAt) {
  if (!previous || previous.createdAt === null || observedAt === null) {
    return { valid: true, ageMs: null };
  }
  const ageMs = observedAt - previous.createdAt;
  return {
    valid: ageMs >= 0 && ageMs <= previous.maxZoneAgeMs,
    ageMs,
  };
}

function matchReason(previous, opportunity, observedAt) {
  if (!previous) return 'ZONE_CREATED';
  if (previous.direction !== opportunity.direction) {
    return 'DIRECTION_CHANGED';
  }
  if (previous.liquidityType !== opportunity.liquidityType) {
    return 'LIQUIDITY_TYPE_CHANGED';
  }
  const window = lifecycleWindow(previous, observedAt);
  if (!window.valid) {
    return window.ageMs < 0
      ? 'NON_CAUSAL_OBSERVATION'
      : 'ZONE_AGE_EXCEEDED';
  }
  const distance = priceDistancePercent(
    previous.anchorPrice,
    opportunity.price
  );
  if (distance > previous.tolerancePercent) {
    return 'PRICE_OUTSIDE_ZONE_TOLERANCE';
  }
  return 'WITHIN_ZONE_TOLERANCE';
}

function appendRawId(ids, rawId) {
  const result = Array.isArray(ids) ? ids.slice() : [];
  if (!result.includes(rawId)) result.push(rawId);
  return result;
}

function createZone(opportunity, rawId, options, reason) {
  const observedAt = normalizeTimestamp(options.observedAt);
  const tolerancePercent = configuredTolerance(
    options.tolerancePercent
  );
  const maxZoneAgeMs = configuredMaxAge(options.maxZoneAgeMs);
  return {
    identityVersion: IDENTITY_VERSION,
    zoneId: rawId,
    canonicalZoneId: rawId,
    rawOpportunityId: rawId,
    direction: opportunity.direction,
    liquidityType: opportunity.liquidityType,
    anchorPrice: opportunity.price,
    currentPrice: opportunity.price,
    tolerancePercent,
    toleranceSource:
      typeof options.toleranceSource === 'string' &&
      options.toleranceSource
        ? options.toleranceSource
        : DEFAULT_TOLERANCE_SOURCE,
    toleranceValue: opportunity.price * tolerancePercent,
    maxZoneAgeMs,
    ageSource:
      typeof options.ageSource === 'string' && options.ageSource
        ? options.ageSource
        : DEFAULT_AGE_SOURCE,
    createdAt: observedAt,
    lastObservedAt: observedAt,
    minObservedPrice: opportunity.price,
    maxObservedPrice: opportunity.price,
    rawOpportunityIds: [rawId],
    sameZone: false,
    distancePercent: 0,
    reason,
  };
}

function continueZone(previous, opportunity, rawId, observedAt) {
  const distancePercent = priceDistancePercent(
    previous.anchorPrice,
    opportunity.price
  );
  return {
    identityVersion: IDENTITY_VERSION,
    zoneId: previous.zoneId,
    canonicalZoneId: previous.zoneId,
    rawOpportunityId: rawId,
    direction: previous.direction,
    liquidityType: previous.liquidityType,
    anchorPrice: previous.anchorPrice,
    currentPrice: opportunity.price,
    tolerancePercent: previous.tolerancePercent,
    toleranceSource: previous.toleranceSource,
    toleranceValue:
      previous.anchorPrice * previous.tolerancePercent,
    maxZoneAgeMs: previous.maxZoneAgeMs,
    ageSource: previous.ageSource,
    createdAt: previous.createdAt,
    lastObservedAt: observedAt === null
      ? previous.lastObservedAt
      : observedAt,
    minObservedPrice: Math.min(
      previous.minObservedPrice,
      opportunity.price
    ),
    maxObservedPrice: Math.max(
      previous.maxObservedPrice,
      opportunity.price
    ),
    rawOpportunityIds: appendRawId(
      previous.rawOpportunityIds,
      rawId
    ),
    sameZone: true,
    distancePercent,
    reason: 'WITHIN_ZONE_TOLERANCE',
  };
}

function resolve(input) {
  input = isObject(input) ? input : {};
  const opportunity = normalizeOpportunity(
    input.opportunity || input.currentOpportunity
  );
  if (!opportunity) {
    throw new Error(
      'A directional Opportunity with liquidityType and price is required.'
    );
  }
  const rawId = rawOpportunityId(opportunity);
  const previous = previousZone(
    input.previousIdentity || input.previousZone
  );
  const observedAt = normalizeTimestamp(input.observedAt);
  const reason = matchReason(previous, opportunity, observedAt);
  if (reason === 'WITHIN_ZONE_TOLERANCE') {
    return continueZone(
      previous,
      opportunity,
      rawId,
      observedAt
    );
  }
  return createZone(opportunity, rawId, input, reason);
}

module.exports = {
  DEFAULT_AGE_SOURCE,
  DEFAULT_MAX_ZONE_AGE_MS,
  DEFAULT_TOLERANCE_SOURCE,
  DEFAULT_ZONE_TOLERANCE,
  IDENTITY_VERSION,
  appendRawId,
  clone,
  configuredMaxAge,
  configuredTolerance,
  lifecycleWindow,
  matchReason,
  normalizeOpportunity,
  normalizeTimestamp,
  previousZone,
  priceDistancePercent,
  rawOpportunityId,
  resolve,
};
