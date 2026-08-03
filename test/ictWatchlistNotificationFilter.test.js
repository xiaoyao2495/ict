'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Filter = require(
  '../notifications/ictWatchlistNotificationFilter'
);
const ChineseFormatter = require(
  '../formatters/ictAnalystChineseFormatter'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function mss(index, direction, structurePrice) {
  direction = direction || 'BULLISH';
  return {
    id: 'MSS-' + index,
    direction,
    index,
    availableIndex: index,
    time: 1000 + index,
    brokenStructureLevel: {
      id: 'PIVOT-' + index,
      label: direction === 'BULLISH' ? 'LH' : 'HL',
      type: direction === 'BULLISH' ? 'HIGH' : 'LOW',
      index: index - 2,
      availableIndex: index,
      time: 900 + index,
      price: structurePrice === undefined
        ? 100
        : structurePrice,
    },
  };
}

function sweep(index, side) {
  return {
    id: 'SWEEP-' + index,
    type: side === 'BUY_SIDE'
      ? 'LTF_SWING_HIGH'
      : 'LTF_SWING_LOW',
    side: side || 'SELL_SIDE',
    availableIndex: index,
    time: 2000 + index,
  };
}

function result(symbol, options) {
  options = options || {};
  return {
    symbol,
    status: 'SUCCESS',
    formatted: 'formatted ' + symbol,
    report: {
      symbol,
      current: {
        fourHourAnalysis: {
          bias: options.bias || 'BULLISH',
        },
        fiveMinuteConfirmationStatus:
          options.confirmationStatus || 'WAITING',
        alignment: {
          status: options.alignmentStatus || 'WAITING',
          direction: options.alignmentDirection || null,
          reason: options.alignmentReason || '',
        },
        opportunity: options.opportunity,
        ...(options.decisionGate
          ? { decisionGate: options.decisionGate }
          : {}),
        fiveMinuteObservation: {
          currentConfirmed: {
            confirmation:
              options.confirmationStatus &&
              options.confirmationStatus !== 'WAITING'
                ? {
                  status: 'CONFIRMED',
                  direction:
                    options.confirmationDirection ||
                    (options.confirmationStatus ===
                      'CONFIRMED_BULLISH'
                      ? 'BULLISH'
                      : 'BEARISH'),
                  reason: options.confirmationReason || '',
                }
                : null,
          },
          latestConfirmed: {
            mss: options.mss === undefined
              ? null
              : options.mss,
            liquiditySweep:
              options.sweep === undefined
                ? null
                : options.sweep,
          },
        },
      },
    },
  };
}

function committed(decision) {
  return decision.nextState;
}

function decisionGate(state, from, options) {
  options = options || {};
  return {
    state,
    direction: Object.prototype.hasOwnProperty.call(
      options,
      'direction'
    )
      ? options.direction
      : 'BULLISH',
    activeOpportunity:
      Object.prototype.hasOwnProperty.call(
        options,
        'activeOpportunity'
      )
        ? options.activeOpportunity
        : null,
    progress: {
      sweepCompleted: false,
      mssCompleted: false,
      displacementCompleted: false,
      strictConfirmationCompleted: false,
      ...(options.progress || {}),
    },
    blockers: options.blockers || [],
    reasonCode: options.reasonCode || state,
    transition: {
      changed: options.changed === undefined
        ? from !== state
        : options.changed,
      from: from || null,
      to: state,
      occurredAt: options.occurredAt || 123456,
    },
    informationalOnly: true,
  };
}

test('first symbol state sends once', () => {
  const decision = Filter.evaluate(
    [result('BTCUSDT')],
    null
  );

  assert.strictEqual(decision.shouldNotify, true);
  assert.strictEqual(decision.changes.length, 1);
  assert.deepStrictEqual(
    decision.changedSymbols,
    ['BTCUSDT']
  );
  assert.deepStrictEqual(
    decision.notificationSymbols,
    ['BTCUSDT']
  );
  assert.deepStrictEqual(
    decision.changes[0].reasons,
    ['INITIAL_STATE']
  );
  assert.strictEqual(
    decision.nextState.symbols.BTCUSDT.symbol,
    'BTCUSDT'
  );
  assert.strictEqual(
    decision.nextState.version,
    Filter.STATE_VERSION
  );
});

test('Decision Gate WAITING transitions to WATCH_ZONE', () => {
  const waiting = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WAITING_OPPORTUNITY',
        null,
        { changed: true }
      ),
    }),
  ], null);
  const activeOpportunity = {
    id: 'ignored-window-id',
    direction: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
    price: 62782,
    enteredAvailableIndex: 200,
  };
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WAITING_OPPORTUNITY',
        {
          activeOpportunity,
          reasonCode: 'OPPORTUNITY_ACTIVE',
        }
      ),
    }),
  ], committed(waiting));

  assert.strictEqual(changed.shouldNotify, true);
  assert.deepStrictEqual(changed.changes[0].reasons, [
    'DECISION_GATE_TRANSITION',
  ]);
  assert.deepStrictEqual(
    changed.changes[0].decisionGateTransition,
    {
      changed: true,
      from: 'WAITING_OPPORTUNITY',
      to: 'WATCH_ZONE',
      direction: 'BULLISH',
      reasonCode: 'OPPORTUNITY_ACTIVE',
      activeOpportunity: {
        id: 'BULLISH|EQUAL_LOW|62782',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62782,
      },
      priority: false,
    }
  );
});

test('Decision Gate WATCH_ZONE transitions to CONFIRMING', () => {
  const opportunity = {
    direction: 'BULLISH',
    liquidityType: 'PDL',
    price: 62000,
  };
  const watching = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        changed: true,
        activeOpportunity: opportunity,
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'CONFIRMING',
        'WATCH_ZONE',
        {
          activeOpportunity: opportunity,
          progress: { sweepCompleted: true },
          reasonCode: 'SWEEP_COMPLETED',
        }
      ),
    }),
  ], committed(watching));

  assert.strictEqual(changed.shouldNotify, true);
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.from,
    'WATCH_ZONE'
  );
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.to,
    'CONFIRMING'
  );
});

test('Decision Gate CONFIRMING transitions to READY', () => {
  const opportunity = {
    direction: 'BEARISH',
    liquidityType: 'EQUAL_HIGH',
    price: 67000,
  };
  const confirming = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('CONFIRMING', null, {
        changed: true,
        direction: 'BEARISH',
        activeOpportunity: opportunity,
        progress: { sweepCompleted: true },
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'READY_OBSERVATION',
        'CONFIRMING',
        {
          direction: 'BEARISH',
          activeOpportunity: opportunity,
          progress: {
            sweepCompleted: true,
            mssCompleted: true,
            displacementCompleted: true,
            strictConfirmationCompleted: true,
          },
          reasonCode: 'STRICT_CONFIRMATION_COMPLETED',
        }
      ),
    }),
  ], committed(confirming));

  assert.strictEqual(changed.shouldNotify, true);
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.to,
    'READY_OBSERVATION'
  );
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.priority,
    true
  );
});

test('Decision Gate READY invalidation always notifies', () => {
  const ready = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'READY_OBSERVATION',
        null,
        { changed: true }
      ),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'INVALIDATED',
        'READY_OBSERVATION',
        {
          direction: null,
          reasonCode: 'HTF_DIRECTION_CHANGED',
        }
      ),
    }),
  ], committed(ready));

  assert.strictEqual(changed.shouldNotify, true);
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.priority,
    true
  );
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.to,
    'INVALIDATED'
  );
});

test('Decision Gate HTF_CONFLICT always notifies', () => {
  const waiting = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WAITING_OPPORTUNITY',
        null,
        { changed: true }
      ),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'HTF_CONFLICT',
        'WAITING_OPPORTUNITY',
        {
          direction: null,
          reasonCode: 'HTF_STRUCTURE_CONFLICT',
        }
      ),
    }),
  ], committed(waiting));

  assert.strictEqual(changed.shouldNotify, true);
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.to,
    'HTF_CONFLICT'
  );
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.priority,
    true
  );
});

test('ordinary fields cannot notify while Gate is unchanged', () => {
  const opportunity = {
    direction: 'BULLISH',
    liquidityType: 'PDL',
    price: 62000,
  };
  const gate = decisionGate('WATCH_ZONE', null, {
    changed: true,
    activeOpportunity: opportunity,
  });
  const initial = result('BTCUSDT', {
    decisionGate: gate,
  });
  initial.report.current.liquidityRoadmap = [{
    type: 'PDL',
    distancePercent: 0.2,
    availableIndex: 10,
  }];
  const first = Filter.evaluate([initial], null);
  const next = result('BTCUSDT', {
    bias: 'BEARISH',
    alignmentStatus: 'ALIGNED',
    opportunity: {
      status: 'WAITING',
      direction: 'BEARISH',
      distancePercent: 0.9,
    },
    decisionGate: decisionGate(
      'WATCH_ZONE',
      null,
      {
        changed: true,
        activeOpportunity: opportunity,
        occurredAt: 999999,
      }
    ),
  });
  next.report.current.liquidityRoadmap = [{
    type: 'PWL',
    distancePercent: 0.9,
    availableIndex: 99,
  }];
  const unchanged = Filter.evaluate(
    [next],
    committed(first)
  );

  assert.strictEqual(unchanged.shouldNotify, false);
  assert.deepStrictEqual(unchanged.changes, []);
});

test('WATCH_ZONE Sweep false to true sends progress notification', () => {
  const opportunity = {
    direction: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
    price: 62782,
  };
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: opportunity,
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WATCH_ZONE',
        {
          changed: true,
          activeOpportunity: opportunity,
          progress: { sweepCompleted: true },
          reasonCode: 'SWEEP_COMPLETED',
        }
      ),
    }),
  ], committed(initial));

  assert.strictEqual(changed.shouldNotify, true);
  assert.deepStrictEqual(changed.changes[0].reasons, [
    'DECISION_GATE_PROGRESS',
  ]);
  assert.strictEqual(
    changed.changes[0].notificationType,
    'DECISION_GATE_PROGRESS'
  );
  assert.strictEqual(
    changed.changes[0].decisionGateTransition,
    null
  );
  assert.deepStrictEqual(
    changed.changes[0].decisionGateProgress.completedFields,
    ['sweepCompleted']
  );
  assert.strictEqual(
    changed.nextState.symbols.BTCUSDT
      .previousDecisionGateProgress.sweepCompleted,
    true
  );

  const text = ChineseFormatter.formatNotificationChange(
    changed.changes[0].result.report,
    changed.changes[0].reasons,
    changed.changes[0]
  );
  assert.ok(text.includes('🔔 BTCUSDT 事件更新'));
  assert.ok(text.includes('状态：\n🟡 观察区（Watch Zone）'));
  assert.ok(text.includes('事件进展：\n目标流动性已经被扫取'));
  assert.ok(text.includes('4H交易背景：\n🟢 偏多'));
  assert.ok(text.includes('⏳ 5分钟看涨 MSS'));
  assert.ok(text.includes(
    '交易逻辑：\n卖方流动性已扫取，等待多头模型形成'
  ));
});

test('CONFIRMING MSS false to true sends progress notification', () => {
  const opportunity = {
    direction: 'BULLISH',
    liquidityType: 'PDL',
    price: 62000,
  };
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('CONFIRMING', null, {
        activeOpportunity: opportunity,
        progress: { sweepCompleted: true },
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'CONFIRMING',
        'CONFIRMING',
        {
          changed: true,
          activeOpportunity: opportunity,
          progress: {
            sweepCompleted: true,
            mssCompleted: true,
          },
          reasonCode: 'MSS_COMPLETED',
        }
      ),
    }),
  ], committed(initial));

  assert.deepStrictEqual(changed.changes[0].reasons, [
    'DECISION_GATE_PROGRESS',
  ]);
  assert.deepStrictEqual(
    changed.changes[0].decisionGateProgress.completedFields,
    ['mssCompleted']
  );
  const text = ChineseFormatter.formatNotificationChange(
    changed.changes[0].result.report,
    changed.changes[0].reasons,
    changed.changes[0]
  );
  assert.ok(text.includes('状态：\n🟠 确认中（Confirming）'));
  assert.ok(text.includes(
    '事件进展：\n5分钟看涨 MSS已经确认'
  ));
  assert.ok(text.includes('✅ 5分钟看涨 MSS'));
  assert.ok(text.includes('⏳ 看涨 Displacement'));
  assert.ok(text.includes(
    '交易逻辑：\n5分钟看涨 MSS 已确认，等待看涨 Displacement'
  ));
});

test('CONFIRMING Displacement false to true sends progress notification', () => {
  const opportunity = {
    direction: 'BEARISH',
    liquidityType: 'EQUAL_HIGH',
    price: 67000,
  };
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('CONFIRMING', null, {
        direction: 'BEARISH',
        activeOpportunity: opportunity,
        progress: {
          sweepCompleted: true,
          mssCompleted: true,
        },
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'CONFIRMING',
        'CONFIRMING',
        {
          changed: true,
          direction: 'BEARISH',
          activeOpportunity: opportunity,
          progress: {
            sweepCompleted: true,
            mssCompleted: true,
            displacementCompleted: true,
          },
        }
      ),
    }),
  ], committed(initial));

  assert.deepStrictEqual(
    changed.changes[0].decisionGateProgress.completedFields,
    ['displacementCompleted']
  );
});

test('unchanged and true to false progress do not notify', () => {
  const gate = decisionGate('CONFIRMING', null, {
    progress: {
      sweepCompleted: true,
      mssCompleted: true,
    },
  });
  const initial = Filter.evaluate([
    result('BTCUSDT', { decisionGate: gate }),
  ], null);
  const unchanged = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'CONFIRMING',
        'CONFIRMING',
        {
          changed: false,
          progress: {
            sweepCompleted: true,
            mssCompleted: true,
          },
        }
      ),
    }),
  ], committed(initial));
  const reset = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'CONFIRMING',
        'CONFIRMING',
        {
          changed: true,
          progress: {
            sweepCompleted: true,
            mssCompleted: false,
          },
        }
      ),
    }),
  ], committed(initial));

  assert.strictEqual(unchanged.shouldNotify, false);
  assert.strictEqual(reset.shouldNotify, false);
});

test('Gate price change without progress does not notify', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: {
          direction: 'BULLISH',
          liquidityType: 'EQUAL_LOW',
          price: 62782,
        },
      }),
    }),
  ], null);
  const changedPrice = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WATCH_ZONE',
        {
          changed: true,
          activeOpportunity: {
            direction: 'BULLISH',
            liquidityType: 'EQUAL_LOW',
            price: 62790,
          },
        }
      ),
    }),
  ], committed(initial));

  assert.strictEqual(changedPrice.shouldNotify, false);
  assert.deepStrictEqual(changedPrice.changes, []);
});

test('Notification State stores raw and canonical Zone identity', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: {
          direction: 'BULLISH',
          liquidityType: 'EQUAL_LOW',
          price: 62782,
        },
      }),
    }),
  ], null);
  const state = initial.nextState.symbols.BTCUSDT;

  assert.strictEqual(
    state.activeZoneId,
    'BULLISH|EQUAL_LOW|62782'
  );
  assert.strictEqual(
    state.canonicalOpportunityId,
    'BULLISH|EQUAL_LOW|62782'
  );
  assert.strictEqual(
    state.rawOpportunityId,
    'BULLISH|EQUAL_LOW|62782'
  );
  assert.strictEqual(state.opportunityIdentity.anchorPrice, 62782);
});

test('same Zone OPPORTUNITY_REPLACED does not notify', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62782,
      },
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: {
          direction: 'BULLISH',
          liquidityType: 'EQUAL_LOW',
          price: 62782,
        },
      }),
    }),
  ], null);
  const replacement = Filter.evaluate([
    result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'EQUAL_LOW',
        price: 62861,
      },
      decisionGate: decisionGate(
        'INVALIDATED',
        'WATCH_ZONE',
        {
          activeOpportunity: null,
          reasonCode: 'OPPORTUNITY_REPLACED',
        }
      ),
    }),
  ], committed(initial));

  assert.strictEqual(replacement.shouldNotify, false);
  assert.deepStrictEqual(replacement.changes, []);
});

test('same Zone re-entry does not regress CONFIRMING notification', () => {
  const firstOpportunity = {
    direction: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
    price: 62782,
  };
  const nextOpportunity = {
    ...firstOpportunity,
    price: 62861,
  };
  const confirming = Filter.evaluate([
    result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        ...firstOpportunity,
      },
      decisionGate: decisionGate('CONFIRMING', null, {
        activeOpportunity: firstOpportunity,
        progress: { sweepCompleted: true },
      }),
    }),
  ], null);
  const replacement = Filter.evaluate([
    result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        ...nextOpportunity,
      },
      decisionGate: decisionGate(
        'INVALIDATED',
        'CONFIRMING',
        {
          activeOpportunity: null,
          progress: { sweepCompleted: true },
          reasonCode: 'OPPORTUNITY_REPLACED',
        }
      ),
    }),
  ], committed(confirming));
  const reentered = Filter.evaluate([
    result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        ...nextOpportunity,
      },
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'INVALIDATED',
        {
          activeOpportunity: nextOpportunity,
          progress: { sweepCompleted: false },
        }
      ),
    }),
  ], committed(confirming));

  assert.strictEqual(replacement.shouldNotify, false);
  assert.strictEqual(reentered.shouldNotify, false);
});

test('SAME_ZONE_REPRICE remains silent across repeated prices', () => {
  const opportunity = (price) => ({
    direction: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
    price,
  });
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: opportunity(62782),
      }),
    }),
  ], null);
  const second = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WATCH_ZONE',
        {
          changed: true,
          activeOpportunity: opportunity(62861),
        }
      ),
    }),
  ], committed(initial));
  const third = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WATCH_ZONE',
        {
          changed: true,
          activeOpportunity: opportunity(62886),
        }
      ),
    }),
  ], committed(initial));

  assert.strictEqual(second.shouldNotify, false);
  assert.strictEqual(third.shouldNotify, false);
});

test('new Zone with unchanged Gate state notifies normally', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: {
          direction: 'BULLISH',
          liquidityType: 'EQUAL_LOW',
          price: 62782,
        },
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WATCH_ZONE',
        {
          changed: true,
          activeOpportunity: {
            direction: 'BULLISH',
            liquidityType: 'EQUAL_LOW',
            price: 62920,
          },
        }
      ),
    }),
  ], committed(initial));

  assert.strictEqual(changed.shouldNotify, true);
  assert.deepStrictEqual(changed.changes[0].reasons, [
    'DECISION_GATE_TRANSITION',
  ]);
  assert.strictEqual(
    changed.changes[0].currentState.activeZoneId,
    'BULLISH|EQUAL_LOW|62920'
  );
});

test('same Zone reprice still allows progress rising notification', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: {
          direction: 'BULLISH',
          liquidityType: 'EQUAL_LOW',
          price: 62782,
        },
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WATCH_ZONE',
        {
          changed: true,
          activeOpportunity: {
            direction: 'BULLISH',
            liquidityType: 'EQUAL_LOW',
            price: 62861,
          },
          progress: { sweepCompleted: true },
          reasonCode: 'SWEEP_COMPLETED',
        }
      ),
    }),
  ], committed(initial));

  assert.strictEqual(changed.shouldNotify, true);
  assert.deepStrictEqual(changed.changes[0].reasons, [
    'DECISION_GATE_PROGRESS',
  ]);
  assert.strictEqual(
    changed.changes[0].currentState.activeZoneId,
    'BULLISH|EQUAL_LOW|62782'
  );
  assert.strictEqual(
    changed.changes[0].currentState.rawOpportunityId,
    'BULLISH|EQUAL_LOW|62861'
  );
});

test('legacy V7 Gate state is upgraded with Zone identity', () => {
  const opportunity = {
    direction: 'BULLISH',
    liquidityType: 'EQUAL_LOW',
    price: 62782,
  };
  const legacy = {
    version: 7,
    symbols: {
      BTCUSDT: Filter.extractSymbolState(
        result('BTCUSDT', {
          decisionGate: decisionGate('WATCH_ZONE', null, {
            activeOpportunity: opportunity,
          }),
        })
      ),
    },
  };
  delete legacy.symbols.BTCUSDT.__identityObservedAt;
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'WATCH_ZONE',
        'WATCH_ZONE',
        {
          changed: true,
          activeOpportunity: {
            ...opportunity,
            price: 62861,
          },
          progress: { sweepCompleted: true },
        }
      ),
    }),
  ], legacy);

  assert.strictEqual(changed.previousState.version, 8);
  assert.strictEqual(changed.shouldNotify, true);
  assert.deepStrictEqual(changed.changes[0].reasons, [
    'DECISION_GATE_PROGRESS',
  ]);
  assert.strictEqual(
    changed.changes[0].currentState.activeZoneId,
    'BULLISH|EQUAL_LOW|62782'
  );
});

test('state and progress changing together sends state transition only', () => {
  const opportunity = {
    direction: 'BULLISH',
    liquidityType: 'PDL',
    price: 62000,
  };
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate('WATCH_ZONE', null, {
        activeOpportunity: opportunity,
      }),
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      decisionGate: decisionGate(
        'CONFIRMING',
        'WATCH_ZONE',
        {
          activeOpportunity: opportunity,
          progress: { sweepCompleted: true },
        }
      ),
    }),
  ], committed(initial));

  assert.deepStrictEqual(changed.changes[0].reasons, [
    'DECISION_GATE_TRANSITION',
  ]);
  assert.strictEqual(
    changed.changes[0].notificationType,
    'DECISION_GATE_TRANSITION'
  );
  assert.strictEqual(
    changed.changes[0].decisionGateProgress,
    null
  );
  assert.strictEqual(
    changed.changes[0].decisionGateTransition.changed,
    true
  );
});

test('reports without Decision Gate keep legacy comparison', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT', {
      opportunity: {
        status: 'WAITING',
        direction: 'BULLISH',
      },
    }),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99.5,
      },
    }),
  ], committed(initial));

  assert.strictEqual(changed.shouldNotify, true);
  assert.deepStrictEqual(changed.changes[0].reasons, [
    'OPPORTUNITY_CHANGED',
  ]);
  assert.strictEqual(
    changed.changes[0].decisionGateTransition,
    null
  );
});

test('identical state and ordinary candle changes are filtered', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT')],
    null
  );
  const duplicate = Filter.evaluate(
    [result('BTCUSDT')],
    committed(initial)
  );

  assert.strictEqual(duplicate.shouldNotify, false);
  assert.deepStrictEqual(duplicate.changes, []);
  assert.deepStrictEqual(duplicate.changedSymbols, []);
  assert.deepStrictEqual(
    duplicate.notificationSymbols,
    []
  );
});

test('notification state excludes every window locator and Sweep', () => {
  const state = Filter.extractSymbolState(
    result('BTCUSDT', {
      mss: mss(10),
      sweep: sweep(10, 'SELL_SIDE'),
    })
  );

  assert.deepStrictEqual(state, {
    symbol: 'BTCUSDT',
    h4Bias: 'BULLISH',
    confirmation: {
      status: 'WAITING',
      direction: null,
    },
    alignment: {
      status: 'WAITING',
      direction: null,
      reason: '',
    },
    opportunity: {
      status: 'WAITING',
      direction: null,
      liquidityType: null,
      price: null,
    },
    latestMss: {
      direction: 'BULLISH',
      brokenStructureLevel: {
        type: 'HIGH',
        price: 100,
      },
    },
  });
  assert.strictEqual(
    JSON.stringify(state).includes('index'),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      state,
      'latestSweep'
    ),
    false
  );
});

test('raw symbol Analyst Reports are accepted directly', () => {
  const row = result('BTCUSDT');
  const decision = Filter.evaluate([row.report], null);

  assert.strictEqual(decision.shouldNotify, true);
  assert.strictEqual(
    decision.changes[0].symbol,
    'BTCUSDT'
  );
});

test('4H Bias change sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT')],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', { bias: 'BEARISH' })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['H4_BIAS_CHANGED']
  );
});

test('window locator changes keep the same stable MSS state', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(10) })],
    null
  );
  const sameEventLaterPublication = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(99) })],
    committed(initial)
  );

  assert.strictEqual(
    sameEventLaterPublication.shouldNotify,
    false
  );
  assert.deepStrictEqual(
    sameEventLaterPublication.changes,
    []
  );
});

test('legacy 15m fields do not notify', () => {
  const first = result('BTCUSDT');
  first.report.current.fifteenMinuteAnalysis = {
    deliveryDirection: 'BULLISH',
    relationToH4: 'ALIGNED',
    index: 10,
    time: 1000,
  };
  const initial = Filter.evaluate([first], null);

  const next = result('BTCUSDT');
  next.report.current.fifteenMinuteAnalysis = {
    deliveryDirection: 'BEARISH',
    relationToH4: 'RETRACEMENT',
    index: 20,
    time: 2000,
  };
  const unchanged = Filter.evaluate(
    [next],
    committed(initial)
  );

  assert.strictEqual(unchanged.shouldNotify, false);
  assert.deepStrictEqual(unchanged.changes, []);
});

test('new stable 5m MSS event does not send', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(10) })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', { mss: mss(20, null, 120) })],
    committed(initial)
  );

  assert.strictEqual(changed.shouldNotify, false);
  assert.deepStrictEqual(changed.changes, []);
});

test('MSS direction change does not send without confirmation', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      mss: {
        direction: 'BULLISH',
        availableIndex: 10,
        time: 1000,
      },
    })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      mss: {
        direction: 'BEARISH',
        availableIndex: 20,
        time: 2000,
      },
    })],
    committed(initial)
  );

  assert.strictEqual(changed.shouldNotify, false);
  assert.deepStrictEqual(changed.changes, []);
});

test('WAITING to CONFIRMED_BULLISH sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT')],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
    })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['CONFIRMATION_STATUS_CHANGED']
  );
  assert.deepStrictEqual(
    changed.changes[0].currentState.confirmation,
    {
      status: 'CONFIRMED_BULLISH',
      direction: 'BULLISH',
    }
  );
});

test('alignment WAITING to ALIGNED sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
    })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
      alignmentStatus: 'ALIGNED',
      alignmentDirection: 'BULLISH',
      alignmentReason: '4小时与5分钟方向一致：偏多',
    })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['ALIGNMENT_STATUS_CHANGED']
  );
  assert.deepStrictEqual(
    changed.changes[0].currentState.alignment,
    {
      status: 'ALIGNED',
      direction: 'BULLISH',
      reason: '4小时与5分钟方向一致：偏多',
    }
  );
});

test('alignment reason change does not send', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      alignmentStatus: 'ALIGNED',
      alignmentDirection: 'BULLISH',
      alignmentReason: '初始解释',
    })],
    null
  );
  const changedReasonOnly = Filter.evaluate(
    [result('BTCUSDT', {
      alignmentStatus: 'ALIGNED',
      alignmentDirection: 'BULLISH',
      alignmentReason: '更新后的人工解释',
    })],
    committed(initial)
  );

  assert.strictEqual(
    changedReasonOnly.shouldNotify,
    false
  );
  assert.deepStrictEqual(changedReasonOnly.changes, []);
});

test('alignment direction change sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      alignmentStatus: 'CONFLICT',
      alignmentDirection: 'BULLISH',
    })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      alignmentStatus: 'CONFLICT',
      alignmentDirection: 'BEARISH',
    })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['ALIGNMENT_STATUS_CHANGED']
  );
});

test('confirmation reason change does not send', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
      confirmationReason: '初始解释',
    })],
    null
  );
  const changedReasonOnly = Filter.evaluate(
    [result('BTCUSDT', {
      confirmationStatus: 'CONFIRMED_BULLISH',
      confirmationDirection: 'BULLISH',
      confirmationReason: '更新后的人工解释',
    })],
    committed(initial)
  );

  assert.strictEqual(
    changedReasonOnly.shouldNotify,
    false
  );
  assert.deepStrictEqual(changedReasonOnly.changes, []);
});

test('opportunity WAITING to WATCH_ZONE sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WAITING',
        direction: 'BULLISH',
        liquidityType: null,
        price: null,
      },
    })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99.6,
        distancePercent: 0.4,
        reason: 'PRICE_NEAR_PDL',
      },
    })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['OPPORTUNITY_CHANGED']
  );
  assert.deepStrictEqual(
    changed.changes[0].currentState.opportunity,
    {
      status: 'WATCH_ZONE',
      direction: 'BULLISH',
      liquidityType: 'PDL',
      price: 99.6,
    }
  );
});

test('repeated WATCH_ZONE ignores price and distance changes', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99.6,
        distancePercent: 0.4,
      },
    })],
    null
  );
  const repeated = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99.7,
        distancePercent: 0.3,
      },
    })],
    committed(initial)
  );

  assert.strictEqual(repeated.shouldNotify, false);
  assert.deepStrictEqual(repeated.changes, []);
});

test('opportunity reason change does not send', () => {
  const base = {
    status: 'WATCH_ZONE',
    direction: 'BEARISH',
    liquidityType: 'PDH',
    price: 100.2,
  };
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        ...base,
        reason: '初始解释',
      },
    })],
    null
  );
  const changedReasonOnly = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        ...base,
        reason: '更新后的解释',
      },
    })],
    committed(initial)
  );

  assert.strictEqual(
    changedReasonOnly.shouldNotify,
    false
  );
  assert.deepStrictEqual(changedReasonOnly.changes, []);
});

test('opportunity liquidity type change sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99.6,
      },
    })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PWL',
        price: 99.5,
      },
    })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['OPPORTUNITY_CHANGED']
  );
});

test('opportunity direction change sends', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BULLISH',
        liquidityType: 'PDL',
        price: 99.6,
      },
    })],
    null
  );
  const changed = Filter.evaluate(
    [result('BTCUSDT', {
      opportunity: {
        status: 'WATCH_ZONE',
        direction: 'BEARISH',
        liquidityType: 'PDL',
        price: 99.6,
      },
    })],
    committed(initial)
  );

  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['OPPORTUNITY_CHANGED']
  );
});

test('Sweep identity count index and time changes never send', () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      sweep: sweep(10, 'SELL_SIDE'),
    })],
    null
  );
  const changedSweepOnly = Filter.evaluate(
    [result('BTCUSDT', {
      sweep: sweep(20, 'BUY_SIDE'),
    })],
    committed(initial)
  );

  assert.strictEqual(changedSweepOnly.shouldNotify, false);
  assert.deepStrictEqual(changedSweepOnly.changes, []);
});

test('old persisted locator fields are normalized before comparison', () => {
  const previous = {
    version: 1,
    symbols: {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        h4Bias: 'BULLISH',
        h1Relation: 'ALIGNED',
        h1DeliveryDirection: 'BULLISH',
        m15Relation: 'ALIGNED',
        m15DeliveryDirection: 'BULLISH',
        latestMss: mss(10),
        latestSweep: sweep(10, 'SELL_SIDE'),
      },
    },
  };
  const decision = Filter.evaluate([
    result('BTCUSDT', {
      mss: mss(99),
      sweep: sweep(99, 'BUY_SIDE'),
    }),
  ], previous);

  assert.strictEqual(decision.shouldNotify, false);
  assert.deepStrictEqual(decision.changes, []);
  assert.deepStrictEqual(
    decision.previousState.symbols.BTCUSDT,
    Filter.extractSymbolState(
      result('BTCUSDT', { mss: mss(10) })
    )
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      decision.previousState.symbols.BTCUSDT,
      'h1Relation'
    ),
    false
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      decision.previousState.symbols.BTCUSDT,
      'm15Relation'
    ),
    false
  );
  assert.deepStrictEqual(
    decision.previousState.symbols.BTCUSDT.confirmation,
    {
      status: 'WAITING',
      direction: null,
    }
  );
  assert.deepStrictEqual(
    decision.previousState.symbols.BTCUSDT.alignment,
    {
      status: 'WAITING',
      direction: null,
      reason: '',
    }
  );
  assert.deepStrictEqual(
    decision.previousState.symbols.BTCUSDT.opportunity,
    {
      status: 'WAITING',
      direction: null,
      liquidityType: null,
      price: null,
    }
  );
});

test('15m relation change is ignored', () => {
  const first = result('BTCUSDT');
  first.report.current.fifteenMinuteAnalysis = {
    relationToH4: 'ALIGNED',
    deliveryDirection: 'BULLISH',
  };
  const initial = Filter.evaluate(
    [first],
    null
  );
  const next = result('BTCUSDT');
  next.report.current.fifteenMinuteAnalysis = {
    relationToH4: 'RETRACEMENT',
    deliveryDirection: 'NEUTRAL',
  };
  const changed = Filter.evaluate(
    [next],
    committed(initial)
  );

  assert.strictEqual(changed.shouldNotify, false);
  assert.deepStrictEqual(changed.changes, []);
});

test('symbols maintain independent state', () => {
  const initial = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT'),
  ], null);
  const changed = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT', {
      bias: 'BEARISH',
      sweep: sweep(30, 'SELL_SIDE'),
    }),
    {
      symbol: 'SKHYUSDT',
      status: 'FAILED',
    },
  ], committed(initial));

  assert.strictEqual(changed.changes.length, 1);
  assert.strictEqual(
    changed.changes[0].symbol,
    'ETHUSDT'
  );
  assert.deepStrictEqual(
    changed.changes[0].reasons,
    ['H4_BIAS_CHANGED']
  );
  assert.deepStrictEqual(
    changed.nextState.symbols.BTCUSDT,
    initial.nextState.symbols.BTCUSDT
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      changed.nextState.symbols,
      'SKHYUSDT'
    ),
    false
  );
});

test('webhook success is required before state update', async () => {
  const store = Filter.createMemoryStore();
  const rows = [result('BTCUSDT')];

  await assert.rejects(
    () => Filter.processNotifications({
      results: rows,
      store,
      async send() {
        throw new Error('webhook failed');
      },
    }),
    /webhook failed/
  );
  assert.strictEqual(await store.load(), null);

  await assert.rejects(
    () => Filter.processNotifications({
      results: rows,
      store,
      async send() {
        return { data: { errcode: 310000 } };
      },
    }),
    /did not accept/
  );
  assert.strictEqual(await store.load(), null);

  const processed = await Filter.processNotifications({
    results: rows,
    store,
    async send(changes) {
      assert.strictEqual(changes.length, 1);
      return { data: { errcode: 0 } };
    },
  });
  assert.strictEqual(processed.sent, true);
  assert.ok((await store.load()).symbols.BTCUSDT);
});

test('file store persists independent symbol states', async () => {
  const filePath = path.join(
    os.tmpdir(),
    'ict-watchlist-notification-' +
      process.pid + '-' + Date.now() + '.json'
  );
  const state = Filter.evaluate([
    result('BTCUSDT'),
    result('ETHUSDT'),
  ], null).nextState;

  try {
    const writer = Filter.createFileStore(filePath);
    assert.strictEqual(await writer.load(), null);
    await writer.save(state);

    const reader = Filter.createFileStore(filePath);
    assert.deepStrictEqual(await reader.load(), state);
  } finally {
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
});

test('notification debug is silent when disabled', async () => {
  const logs = [];
  const processed = await Filter.processNotifications({
    results: [result('BTCUSDT')],
    store: Filter.createMemoryStore(),
    debugNotification: false,
    logger: {
      log(value) {
        logs.push(value);
      },
    },
    async send() {
      return { data: { errcode: 0 } };
    },
  });

  assert.strictEqual(processed.sent, true);
  assert.deepStrictEqual(logs, []);
});

test('DEBUG_NOTIFICATION environment switch is supported', () => {
  const original = process.env.DEBUG_NOTIFICATION;

  try {
    process.env.DEBUG_NOTIFICATION = 'true';
    assert.strictEqual(
      Filter.debugNotificationEnabled(),
      true
    );
    process.env.DEBUG_NOTIFICATION = 'false';
    assert.strictEqual(
      Filter.debugNotificationEnabled(),
      false
    );
  } finally {
    if (original === undefined) {
      delete process.env.DEBUG_NOTIFICATION;
    } else {
      process.env.DEBUG_NOTIFICATION = original;
    }
  }
});

test('notification debug prints compared states and decision', async () => {
  const initial = Filter.evaluate(
    [result('BTCUSDT', {
      mss: mss(10),
      sweep: sweep(10, 'SELL_SIDE'),
    })],
    null
  ).nextState;
  const logs = [];
  const processed = await Filter.processNotifications({
    results: [result('BTCUSDT', {
      mss: mss(99),
      sweep: sweep(20, 'BUY_SIDE'),
    })],
    store: Filter.createMemoryStore(initial),
    debugNotification: true,
    logger: {
      log(value) {
        logs.push(value);
      },
    },
  });
  const output = logs.join('\n');

  assert.strictEqual(processed.shouldNotify, false);
  assert.ok(output.includes('State File:'));
  assert.ok(output.includes('<memory/custom store>'));
  assert.ok(output.includes('Load Success:\ntrue'));
  assert.ok(output.includes(
    'Previous State Exists:\ntrue'
  ));
  assert.ok(output.includes(
    '========== Previous Watchlist State =========='
  ));
  assert.ok(output.includes(
    '========== Current Watchlist State =========='
  ));
  assert.ok(output.includes('Symbol:\nBTCUSDT'));
  assert.ok(output.includes(
    'Changed Fields:\nNONE'
  ));
  assert.strictEqual(
    output.includes('Dynamic field detected:'),
    false
  );
  assert.ok(output.includes(
    'shouldNotify:\nfalse'
  ));
  assert.ok(output.includes(
    'Reason:\nNo state changed'
  ));
  assert.strictEqual(
    output.includes('Notification Symbols:'),
    false
  );
});

test('notification debug prints changed and sent symbols', async () => {
  const logs = [];
  const processed = await Filter.processNotifications({
    results: [result('SPCXUSDT')],
    store: Filter.createMemoryStore(),
    debugNotification: true,
    logger: {
      log(value) {
        logs.push(value);
      },
    },
    async send() {
      return { data: { errcode: 0 } };
    },
  });
  const output = logs.join('\n');

  assert.strictEqual(processed.sent, true);
  assert.ok(output.includes(
    'shouldNotify:\ntrue'
  ));
  assert.ok(output.includes(
    'Reason:\nSPCXUSDT changed'
  ));
  assert.ok(output.includes(
    'Changed Symbols:\n[\n  "SPCXUSDT"\n]'
  ));
  assert.ok(output.includes(
    'Notification Symbols:\n[\n  "SPCXUSDT"\n]'
  ));
});

test('notification debug records state load failure', async () => {
  const logs = [];

  await assert.rejects(
    () => Filter.processNotifications({
      results: [result('BTCUSDT')],
      store: {
        filePath: '/tmp/broken-state.json',
        async load() {
          throw new Error('state read failed');
        },
      },
      debugNotification: true,
      logger: {
        log(value) {
          logs.push(value);
        },
      },
    }),
    /state read failed/
  );

  const output = logs.join('\n');
  assert.ok(output.includes(
    'State File:\n/tmp/broken-state.json'
  ));
  assert.ok(output.includes('Load Success:\nfalse'));
  assert.ok(output.includes(
    'Previous State Exists:\nfalse'
  ));
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
