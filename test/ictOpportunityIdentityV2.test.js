'use strict';

const assert = require('assert');
const Identity = require(
  '../indicators/ictOpportunityIdentityV2'
);

const START = Date.UTC(2026, 7, 1, 0, 0, 0);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function opportunity(price, options) {
  options = options || {};
  return {
    id: 'UNTRUSTED-' + price,
    direction: options.direction || 'BULLISH',
    liquidityType: options.liquidityType || 'EQUAL_LOW',
    price,
    availableIndex: options.availableIndex || 100,
  };
}

function resolve(previousIdentity, price, options) {
  options = options || {};
  return Identity.resolve({
    opportunity: opportunity(price, options),
    previousIdentity,
    observedAt: options.observedAt,
    tolerancePercent: options.tolerancePercent,
    toleranceSource: options.toleranceSource,
    maxZoneAgeMs: options.maxZoneAgeMs,
  });
}

function sequence(prices) {
  let current = null;
  return prices.map((price, index) => {
    current = resolve(current, price, {
      observedAt: START + index * 300000,
    });
    return current;
  });
}

test('default tolerance is centralized at 0.2 percent', () => {
  const identity = resolve(null, 62782, { observedAt: START });
  assert.strictEqual(Identity.DEFAULT_ZONE_TOLERANCE, 0.002);
  assert.strictEqual(identity.tolerancePercent, 0.002);
  assert.strictEqual(identity.toleranceSource, 'DEFAULT');
  assert.strictEqual(identity.maxZoneAgeMs, 24 * 60 * 60 * 1000);
});

test('62782 62861 and 62886 resolve to one Zone', () => {
  const identities = sequence([62782, 62861, 62886]);
  assert.strictEqual(
    identities[0].zoneId,
    'BULLISH|EQUAL_LOW|62782'
  );
  assert.strictEqual(identities[1].zoneId, identities[0].zoneId);
  assert.strictEqual(identities[2].zoneId, identities[0].zoneId);
  assert.strictEqual(identities[1].sameZone, true);
  assert.strictEqual(identities[2].sameZone, true);
  assert.deepStrictEqual(identities[2].rawOpportunityIds, [
    'BULLISH|EQUAL_LOW|62782',
    'BULLISH|EQUAL_LOW|62861',
    'BULLISH|EQUAL_LOW|62886',
  ]);
  assert.strictEqual(
    identities[2].rawOpportunityId,
    'BULLISH|EQUAL_LOW|62886'
  );
});

test('62920 is outside the anchored Zone', () => {
  const first = resolve(null, 62782, { observedAt: START });
  const next = resolve(first, 62920, {
    observedAt: START + 300000,
  });
  assert.strictEqual(next.sameZone, false);
  assert.strictEqual(
    next.reason,
    'PRICE_OUTSIDE_ZONE_TOLERANCE'
  );
  assert.strictEqual(next.zoneId, 'BULLISH|EQUAL_LOW|62920');
});

test('Zone Anchor and tolerance never drift', () => {
  const first = resolve(null, 62782, {
    observedAt: START,
    tolerancePercent: 0.002,
    toleranceSource: 'DEFAULT',
  });
  const second = resolve(first, 62861, {
    observedAt: START + 300000,
    tolerancePercent: 0.01,
    toleranceSource: 'OVERRIDE',
  });
  const third = resolve(second, 62886, {
    observedAt: START + 600000,
  });
  assert.strictEqual(second.anchorPrice, 62782);
  assert.strictEqual(third.anchorPrice, 62782);
  assert.strictEqual(second.tolerancePercent, 0.002);
  assert.strictEqual(third.tolerancePercent, 0.002);
  assert.strictEqual(second.toleranceSource, 'DEFAULT');
});

test('adjacent prices cannot create chain drift', () => {
  const first = resolve(null, 100, { observedAt: START });
  const second = resolve(first, 100.19, {
    observedAt: START + 300000,
  });
  const third = resolve(second, 100.38, {
    observedAt: START + 600000,
  });
  assert.strictEqual(second.sameZone, true);
  assert.strictEqual(third.sameZone, false);
  assert.strictEqual(third.anchorPrice, 100.38);
});

test('different direction never merges', () => {
  const first = resolve(null, 62782, { observedAt: START });
  const next = resolve(first, 62790, {
    direction: 'BEARISH',
    observedAt: START + 300000,
  });
  assert.strictEqual(next.sameZone, false);
  assert.strictEqual(next.reason, 'DIRECTION_CHANGED');
  assert.strictEqual(next.zoneId, 'BEARISH|EQUAL_LOW|62790');
});

test('different liquidity type never merges', () => {
  const first = resolve(null, 62782, { observedAt: START });
  const next = resolve(first, 62790, {
    liquidityType: 'PDL',
    observedAt: START + 300000,
  });
  assert.strictEqual(next.sameZone, false);
  assert.strictEqual(next.reason, 'LIQUIDITY_TYPE_CHANGED');
  assert.strictEqual(next.zoneId, 'BULLISH|PDL|62790');
});

test('same nearby price after max Zone age creates a new Zone', () => {
  const first = resolve(null, 62782, { observedAt: START });
  const next = resolve(first, 62790, {
    observedAt: START + Identity.DEFAULT_MAX_ZONE_AGE_MS + 1,
  });
  assert.strictEqual(next.sameZone, false);
  assert.strictEqual(next.reason, 'ZONE_AGE_EXCEEDED');
  assert.strictEqual(next.anchorPrice, 62790);
});

test('Identity resolution is deterministic and input immutable', () => {
  const previous = resolve(null, 62782, { observedAt: START });
  const input = {
    opportunity: opportunity(62861),
    previousIdentity: previous,
    observedAt: START + 300000,
  };
  const before = JSON.stringify(input);
  const first = Identity.resolve(input);
  const second = Identity.resolve(input);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(JSON.stringify(input), before);
});

test('future observations cannot alter prefix Zone identities', () => {
  const prices = [62782, 62861, 62886, 62920];
  const full = sequence(prices);
  for (let length = 1; length <= prices.length; length += 1) {
    const prefix = sequence(prices.slice(0, length));
    assert.deepStrictEqual(
      prefix,
      full.slice(0, length),
      'prefix length ' + length
    );
  }
  assert.strictEqual(full[0].anchorPrice, 62782);
  assert.strictEqual(full[1].anchorPrice, 62782);
  assert.strictEqual(full[2].anchorPrice, 62782);
  assert.strictEqual(full[3].anchorPrice, 62920);
});

(async () => {
  for (const item of tests) {
    try {
      await item.callback();
      testsPassed += 1;
      console.log('PASS:', item.name);
    } catch (error) {
      console.error('FAIL:', item.name);
      throw error;
    }
  }
  console.log('\n' + testsPassed + ' tests passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
