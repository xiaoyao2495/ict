'use strict';

var assert = require('assert');
var Recorder = require(
  '../history/ictOpportunityLifecycleRecorder'
);

var START = Date.UTC(2026, 7, 1, 0, 0, 0);
var tests = [];
var testsPassed = 0;

function test(name, callback) {
  tests.push({ name: name, callback: callback });
}

function activeOpportunity(direction, type, price) {
  return {
    id: 'UNTRUSTED-ID-123',
    direction: direction,
    liquidityType: type,
    price: price,
  };
}

function result(symbol, state, from, options) {
  options = options || {};
  return {
    symbol: symbol,
    status: 'SUCCESS',
    report: {
      symbol: symbol,
      current: {
        decisionGate: {
          state: state,
          direction: options.direction || 'BULLISH',
          activeOpportunity:
            Object.prototype.hasOwnProperty.call(
              options,
              'activeOpportunity'
            )
              ? options.activeOpportunity
              : activeOpportunity(
                options.direction || 'BULLISH',
                options.liquidityType || 'EQUAL_LOW',
                options.price === undefined
                  ? 62782
                  : options.price
              ),
          progress: {
            sweepCompleted: false,
            mssCompleted: false,
            displacementCompleted: false,
            strictConfirmationCompleted: false,
            ...(options.progress || {}),
          },
          sourceState: options.sourceState || {},
          blockers: options.blockers || [],
          reasonCode: options.reasonCode || state,
          transition: {
            changed: options.changed === undefined
              ? true
              : options.changed,
            from: from,
            to: state,
            occurredAt: options.timestamp || START,
          },
          informationalOnly: true,
        },
      },
    },
  };
}

function record(store, input, recordedAt) {
  return Recorder.recordResults({
    results: [input],
    store: store,
    recordedAt: recordedAt || START,
  });
}

function bullishOpportunity() {
  return activeOpportunity('BULLISH', 'EQUAL_LOW', 62782);
}

test('new Opportunity creates an isolated lifecycle record', function () {
  var store = Recorder.createMemoryStore();
  var input = result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY',
    {
      activeOpportunity: bullishOpportunity(),
      reasonCode: 'OPPORTUNITY_ACTIVE',
    }
  );
  var before = JSON.stringify(input);
  return record(store, input).then(function (recorded) {
    var lifecycle = recorded.state.symbols.BTCUSDT
      .opportunities['BULLISH|EQUAL_LOW|62782'];
    assert.strictEqual(recorded.changed, true);
    assert.strictEqual(
      lifecycle.opportunityId,
      'BULLISH|EQUAL_LOW|62782'
    );
    assert.strictEqual(lifecycle.symbol, 'BTCUSDT');
    assert.strictEqual(
      lifecycle.createdAt,
      '2026-08-01T00:00:00.000Z'
    );
    assert.strictEqual(lifecycle.currentState, 'WATCH_ZONE');
    assert.strictEqual(lifecycle.completed, false);
    assert.strictEqual(lifecycle.events.length, 1);
    assert.strictEqual(JSON.stringify(input), before);
  });
});

test('WAITING to WATCH_ZONE records the Gate transition only', function () {
  var applied = Recorder.applyTransition(
    null,
    result(
      'BTCUSDT',
      'WATCH_ZONE',
      'WAITING_OPPORTUNITY',
      {
        reasonCode: 'OPPORTUNITY_ACTIVE',
        progress: { sweepCompleted: false },
      }
    ),
    START
  );
  assert.deepStrictEqual(applied.event, {
    timestamp: '2026-08-01T00:00:00.000Z',
    from: 'WAITING_OPPORTUNITY',
    to: 'WATCH_ZONE',
    reasonCode: 'OPPORTUNITY_ACTIVE',
    activeOpportunity: bullishOpportunity(),
    progress: {
      sweepCompleted: false,
      mssCompleted: false,
      displacementCompleted: false,
      strictConfirmationCompleted: false,
    },
  });
});

test('WATCH_ZONE to CONFIRMING appends lifecycle progress', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY'
  )).then(function () {
    return record(store, result(
      'BTCUSDT',
      'CONFIRMING',
      'WATCH_ZONE',
      {
        timestamp: START + 300000,
        progress: { sweepCompleted: true },
        reasonCode: 'SWEEP_COMPLETED',
      }
    ));
  }).then(function (recorded) {
    var lifecycle = recorded.changes[0].record;
    assert.strictEqual(lifecycle.events.length, 2);
    assert.strictEqual(lifecycle.currentState, 'CONFIRMING');
    assert.strictEqual(
      lifecycle.events[1].progress.sweepCompleted,
      true
    );
  });
});

test('CONFIRMING to READY appends the completed Gate progress', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'CONFIRMING',
    'WATCH_ZONE',
    { progress: { sweepCompleted: true } }
  )).then(function () {
    return record(store, result(
      'BTCUSDT',
      'READY_OBSERVATION',
      'CONFIRMING',
      {
        timestamp: START + 300000,
        progress: {
          sweepCompleted: true,
          mssCompleted: true,
          displacementCompleted: true,
          strictConfirmationCompleted: true,
        },
        reasonCode: 'STRICT_CONFIRMATION_COMPLETED',
      }
    ));
  }).then(function (recorded) {
    var lifecycle = recorded.changes[0].record;
    assert.strictEqual(
      lifecycle.currentState,
      'READY_OBSERVATION'
    );
    assert.strictEqual(lifecycle.completed, false);
    assert.strictEqual(
      lifecycle.events[1].progress
        .strictConfirmationCompleted,
      true
    );
  });
});

test('READY to INVALIDATED closes the current lifecycle', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'READY_OBSERVATION',
    'CONFIRMING',
    {
      progress: {
        sweepCompleted: true,
        mssCompleted: true,
        displacementCompleted: true,
        strictConfirmationCompleted: true,
      },
    }
  )).then(function () {
    return record(store, result(
      'BTCUSDT',
      'INVALIDATED',
      'READY_OBSERVATION',
      {
        timestamp: START + 300000,
        activeOpportunity: null,
        reasonCode: 'HTF_DIRECTION_CHANGED',
      }
    ));
  }).then(function (recorded) {
    var lifecycle = recorded.changes[0].record;
    assert.strictEqual(lifecycle.currentState, 'INVALIDATED');
    assert.strictEqual(lifecycle.completed, true);
    assert.strictEqual(lifecycle.events[1].activeOpportunity, null);
    assert.strictEqual(
      recorded.state.symbols.BTCUSDT.currentOpportunityId,
      null
    );
  });
});

test('duplicate transition is not written twice', function () {
  var store = Recorder.createMemoryStore();
  var first = result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY'
  );
  var duplicate = result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY',
    { timestamp: START + 300000 }
  );
  return record(store, first).then(function () {
    return record(store, duplicate);
  }).then(function (recorded) {
    var lifecycle = recorded.state.symbols.BTCUSDT
      .opportunities['BULLISH|EQUAL_LOW|62782'];
    assert.strictEqual(recorded.changed, false);
    assert.deepStrictEqual(recorded.changes, []);
    assert.strictEqual(lifecycle.events.length, 1);
  });
});

test('transition.changed false is never recorded', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY',
    { changed: false }
  )).then(function (recorded) {
    assert.strictEqual(recorded.changed, false);
    assert.deepStrictEqual(recorded.changes, []);
    assert.deepStrictEqual(recorded.state.symbols, {});
  });
});

test('multiple Symbols keep independent lifecycles', function () {
  var store = Recorder.createMemoryStore();
  return Recorder.recordResults({
    results: [
      result('BTCUSDT', 'WATCH_ZONE', 'WAITING_OPPORTUNITY'),
      result('ETHUSDT', 'WATCH_ZONE', 'WAITING_OPPORTUNITY', {
        direction: 'BEARISH',
        liquidityType: 'EQUAL_HIGH',
        price: 4200,
      }),
    ],
    store: store,
    recordedAt: START,
  }).then(function (recorded) {
    assert.strictEqual(recorded.changes.length, 2);
    assert.ok(recorded.state.symbols.BTCUSDT.opportunities[
      'BULLISH|EQUAL_LOW|62782'
    ]);
    assert.ok(recorded.state.symbols.ETHUSDT.opportunities[
      'BEARISH|EQUAL_HIGH|4200'
    ]);
  });
});

test('same Zone price updates keep one canonical lifecycle', function () {
  var store = Recorder.createMemoryStore();
  var prices = [62782, 62861, 62886];
  var chain = Promise.resolve();
  prices.forEach(function (price, index) {
    chain = chain.then(function () {
      return record(store, result(
        'BTCUSDT',
        'WATCH_ZONE',
        index === 0 ? 'WAITING_OPPORTUNITY' : 'WATCH_ZONE',
        {
          price: price,
          timestamp: START + index * 300000,
        }
      ));
    });
  });
  return chain.then(function (recorded) {
    var symbolState = recorded.state.symbols.BTCUSDT;
    var lifecycle = symbolState.opportunities[
      'BULLISH|EQUAL_LOW|62782'
    ];
    assert.strictEqual(
      Object.keys(symbolState.opportunities).length,
      1
    );
    assert.strictEqual(
      lifecycle.canonicalZoneId,
      'BULLISH|EQUAL_LOW|62782'
    );
    assert.deepStrictEqual(lifecycle.rawOpportunityIds, [
      'BULLISH|EQUAL_LOW|62782',
      'BULLISH|EQUAL_LOW|62861',
      'BULLISH|EQUAL_LOW|62886',
    ]);
    assert.strictEqual(lifecycle.events.length, 1);
    assert.strictEqual(lifecycle.auditEvents.length, 3);
  });
});

test('raw price replacements remain available as audit events', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY',
    { price: 62782 }
  )).then(function () {
    return record(store, result(
      'BTCUSDT',
      'WATCH_ZONE',
      'WATCH_ZONE',
      { price: 62861, timestamp: START + 300000 }
    ));
  }).then(function (recorded) {
    var lifecycle = recorded.changes[0].record;
    assert.strictEqual(recorded.changes[0].canonicalChanged, false);
    assert.strictEqual(recorded.changes[0].event, null);
    assert.strictEqual(
      recorded.changes[0].auditEvent.rawOpportunityId,
      'BULLISH|EQUAL_LOW|62861'
    );
    assert.strictEqual(
      lifecycle.auditEvents[1].canonicalZoneId,
      'BULLISH|EQUAL_LOW|62782'
    );
    assert.strictEqual(lifecycle.auditEvents[1].sameZone, true);
  });
});

test('price outside tolerance creates a new canonical lifecycle', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY',
    { price: 62782 }
  )).then(function () {
    return record(store, result(
      'BTCUSDT',
      'WATCH_ZONE',
      'WATCH_ZONE',
      { price: 62920, timestamp: START + 300000 }
    ));
  }).then(function (recorded) {
    var symbolState = recorded.state.symbols.BTCUSDT;
    assert.strictEqual(
      Object.keys(symbolState.opportunities).length,
      2
    );
    assert.ok(symbolState.opportunities[
      'BULLISH|EQUAL_LOW|62782'
    ]);
    assert.ok(symbolState.opportunities[
      'BULLISH|EQUAL_LOW|62920'
    ]);
    assert.strictEqual(
      symbolState.currentOpportunityId,
      'BULLISH|EQUAL_LOW|62920'
    );
  });
});

test('same Zone progress and canonical state never regress', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'CONFIRMING',
    'WATCH_ZONE',
    {
      price: 62782,
      progress: { sweepCompleted: true },
    }
  )).then(function () {
    return record(store, result(
      'BTCUSDT',
      'WATCH_ZONE',
      'CONFIRMING',
      {
        price: 62861,
        timestamp: START + 300000,
      }
    ));
  }).then(function (recorded) {
    var lifecycle = recorded.state.symbols.BTCUSDT
      .opportunities['BULLISH|EQUAL_LOW|62782'];
    assert.strictEqual(lifecycle.currentState, 'CONFIRMING');
    assert.strictEqual(lifecycle.progress.sweepCompleted, true);
    assert.strictEqual(lifecycle.events.length, 1);
    assert.strictEqual(lifecycle.auditEvents.length, 2);
  });
});

test('same Zone raw replacement invalidation is audit only', function () {
  var store = Recorder.createMemoryStore();
  return record(store, result(
    'BTCUSDT',
    'WATCH_ZONE',
    'WAITING_OPPORTUNITY',
    { price: 62782 }
  )).then(function () {
    var replacement = result(
      'BTCUSDT',
      'INVALIDATED',
      'WATCH_ZONE',
      {
        activeOpportunity: null,
        reasonCode: 'OPPORTUNITY_REPLACED',
        timestamp: START + 300000,
      }
    );
    replacement.report.current.opportunity =
      activeOpportunity('BULLISH', 'EQUAL_LOW', 62861);
    return record(store, replacement);
  }).then(function () {
    return record(store, result(
      'BTCUSDT',
      'WATCH_ZONE',
      'INVALIDATED',
      {
        price: 62861,
        timestamp: START + 600000,
      }
    ));
  }).then(function (recorded) {
    var symbolState = recorded.state.symbols.BTCUSDT;
    var lifecycle = symbolState
      .opportunities['BULLISH|EQUAL_LOW|62782'];
    assert.strictEqual(recorded.changes[0].canonicalChanged, false);
    assert.strictEqual(
      Object.keys(symbolState.opportunities).length,
      1
    );
    assert.strictEqual(lifecycle.currentState, 'WATCH_ZONE');
    assert.strictEqual(lifecycle.completed, false);
    assert.strictEqual(lifecycle.events.length, 1);
    assert.strictEqual(lifecycle.auditEvents.length, 3);
    assert.deepStrictEqual(lifecycle.rawOpportunityIds, [
      'BULLISH|EQUAL_LOW|62782',
      'BULLISH|EQUAL_LOW|62861',
    ]);
  });
});

test('legacy lifecycle data is normalized and remains appendable', function () {
  var legacy = {
    opportunities: [{
      opportunityId: 'BULLISH|EQUAL_LOW|62782',
      symbol: 'BTCUSDT',
      createdAt: '2026-08-01T00:00:00.000Z',
      events: [{
        timestamp: '2026-08-01T00:00:00.000Z',
        from: 'WAITING_OPPORTUNITY',
        to: 'WATCH_ZONE',
        reasonCode: 'OPPORTUNITY_ACTIVE',
        activeOpportunity: bullishOpportunity(),
        progress: {},
      }],
      currentState: 'WATCH_ZONE',
    }],
  };
  var before = JSON.stringify(legacy);
  var store = Recorder.createMemoryStore(legacy);
  return record(store, result(
    'BTCUSDT',
    'CONFIRMING',
    'WATCH_ZONE',
    {
      timestamp: START + 300000,
      progress: { sweepCompleted: true },
      reasonCode: 'SWEEP_COMPLETED',
    }
  )).then(function (recorded) {
    var lifecycle = recorded.state.symbols.BTCUSDT
      .opportunities['BULLISH|EQUAL_LOW|62782'];
    assert.strictEqual(
      recorded.state.version,
      Recorder.STATE_VERSION
    );
    assert.strictEqual(lifecycle.events.length, 2);
    assert.strictEqual(
      lifecycle.canonicalZoneId,
      'BULLISH|EQUAL_LOW|62782'
    );
    assert.deepStrictEqual(lifecycle.rawOpportunityIds, [
      'BULLISH|EQUAL_LOW|62782',
    ]);
    assert.deepStrictEqual(lifecycle.auditEvents, [
      {
        timestamp: '2026-08-01T00:05:00.000Z',
        from: 'WATCH_ZONE',
        to: 'CONFIRMING',
        reasonCode: 'SWEEP_COMPLETED',
        rawOpportunityId: 'BULLISH|EQUAL_LOW|62782',
        canonicalZoneId: 'BULLISH|EQUAL_LOW|62782',
        sameZone: true,
        identityReason: 'WITHIN_ZONE_TOLERANCE',
        activeOpportunity: bullishOpportunity(),
        progress: {
          sweepCompleted: true,
          mssCompleted: false,
          displacementCompleted: false,
          strictConfirmationCompleted: false,
        },
      },
    ]);
    assert.strictEqual(lifecycle.currentState, 'CONFIRMING');
    assert.strictEqual(lifecycle.completed, false);
    assert.strictEqual(JSON.stringify(legacy), before);
  });
});

function runTests(index) {
  if (index >= tests.length) {
    console.log('\n' + testsPassed + ' tests passed.');
    return Promise.resolve();
  }
  return Promise.resolve(tests[index].callback())
    .then(function () {
      testsPassed += 1;
      console.log('PASS:', tests[index].name);
      return runTests(index + 1);
    })
    .catch(function (error) {
      console.error('FAIL:', tests[index].name);
      throw error;
    });
}

runTests(0).catch(function (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
