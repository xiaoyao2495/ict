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
    assert.strictEqual(recorded.state.version, 1);
    assert.strictEqual(lifecycle.events.length, 2);
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
