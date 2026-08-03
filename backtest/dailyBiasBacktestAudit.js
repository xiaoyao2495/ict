'use strict';

/*
 * Daily Bias Backtest Audit V1（D.1.1）
 *
 * 给既有 5m 2R/-1R 回测 trades 打上生产级 HTF 背景标签：
 *
 *   biasSourceVersion: 'daily_bias_v1'
 *   htfMarketBias:     dailyBias.marketBias（BULLISH / BEARISH / NEUTRAL）
 *   setupDirection:    trade.type（LONG / SHORT）
 *   alignment:         ALIGNED / COUNTER / TRANSITION / UNTAGGED
 *
 * Daily Bias 的取数管线与生产完全一致（HtfBiasV3.analyze 于真实 4H K 线 +
 * analyzeStructurePhase + dailyBiasForH4State），且对每个 trade 只使用
 * 其入场时刻之前最近一根已收盘 4H 的状态（无未来信息）。
 *
 * 本模块不修改任何交易判断；只读 trades、只读 K 线、只读 H4 状态。
 */

const HtfBiasV3 = require('../indicators/ictHtfBiasEngineV3');
const AnalystReport = require(
  '../indicators/ictWatchlistAnalystReport'
);

const ALIGNMENTS = Object.freeze({
  ALIGNED: 'ALIGNED',
  COUNTER: 'COUNTER',
  TRANSITION: 'TRANSITION',
  UNTAGGED: 'UNTAGGED',
});

const ALIGNMENT_ORDER = [
  ALIGNMENTS.ALIGNED,
  ALIGNMENTS.COUNTER,
  ALIGNMENTS.TRANSITION,
  ALIGNMENTS.UNTAGGED,
];

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && isFinite(value)
    ? value
    : null;
}

/*
 * 对齐矩阵（D.1 定义）：
 *   BULLISH + LONG   -> ALIGNED
 *   BULLISH + SHORT  -> COUNTER
 *   BEARISH + SHORT  -> ALIGNED
 *   BEARISH + LONG   -> COUNTER
 *   NEUTRAL（含转换阶段）-> TRANSITION
 */
function alignmentOf(marketBias, setupDirection) {
  if (marketBias === 'NEUTRAL') {
    return ALIGNMENTS.TRANSITION;
  }
  const aligned =
    (marketBias === 'BULLISH' && setupDirection === 'LONG') ||
    (marketBias === 'BEARISH' && setupDirection === 'SHORT');
  return aligned
    ? ALIGNMENTS.ALIGNED
    : ALIGNMENTS.COUNTER;
}

function h4StatesOf(h4Klines) {
  return HtfBiasV3.analyze({ h4Klines }).states;
}

function structurePhaseStatesOf(h4Klines) {
  return AnalystReport.analyzeStructurePhase(h4Klines).states;
}

/*
 * 为单个 trade 打标。返回 null 表示该 trade 无法定位入场 K 线。
 * 入场前无已收盘 4H 状态时标记 UNTAGGED（不参与三向对齐统计）。
 */
function tagTrade(trade, klines5m, h4States, structurePhaseStates) {
  if (!isObject(trade) || !Array.isArray(klines5m)) {
    return null;
  }
  const bar = klines5m[trade.entryIndex];
  if (!bar) return null;
  const setupDirection =
    trade.type === 'LONG' || trade.type === 'SHORT'
      ? trade.type
      : null;
  const h4State = AnalystReport.latestStateAtOrBefore(
    h4States,
    bar.openTime
  );
  if (!h4State) {
    return {
      ...trade,
      biasSourceVersion: 'daily_bias_v1',
      htfMarketBias: null,
      transitionDirection: null,
      structureState: null,
      htfLocation: null,
      htfLocationReadiness: null,
      setupDirection,
      alignment: ALIGNMENTS.UNTAGGED,
    };
  }
  const dailyBias = AnalystReport.dailyBiasForH4State(
    h4State,
    structurePhaseStates
  );
  const marketBias = dailyBias.marketBias || 'NEUTRAL';
  return {
    ...trade,
    biasSourceVersion: 'daily_bias_v1',
    htfMarketBias: marketBias,
    transitionDirection:
      dailyBias.transitionDirection || null,
    structureState: dailyBias.structureState || null,
    htfLocation: dailyBias.location &&
      typeof dailyBias.location.state === 'string'
      ? dailyBias.location.state
      : null,
    htfLocationReadiness:
      dailyBias.htfLocationReadiness || null,
    setupDirection,
    alignment: setupDirection
      ? alignmentOf(marketBias, setupDirection)
      : ALIGNMENTS.UNTAGGED,
  };
}

/*
 * 批量打标。返回新数组（不修改入参 trades）。
 */
function tagTrades(input) {
  input = input || {};
  const trades = Array.isArray(input.trades)
    ? input.trades
    : [];
  const klines5m = Array.isArray(input.klines5m)
    ? input.klines5m
    : [];
  const h4States = Array.isArray(input.h4States)
    ? input.h4States
    : [];
  const structurePhaseStates = Array.isArray(
    input.structurePhaseStates
  ) ? input.structurePhaseStates : [];
  return trades
    .map(function (trade) {
      return tagTrade(
        trade,
        klines5m,
        h4States,
        structurePhaseStates
      );
    })
    .filter(function (trade) {
      return trade !== null;
    });
}

function emptyGroup() {
  return {
    trades: 0,
    win: 0,
    loss: 0,
    winRate: 0,
    avgR: 0,
    totalR: 0,
  };
}

function pushClosedTrade(group, trade) {
  if (trade.status !== 'WIN' && trade.status !== 'LOSS') {
    return;
  }
  group.trades += 1;
  if (trade.status === 'WIN') group.win += 1;
  if (trade.status === 'LOSS') group.loss += 1;
  const r = finiteNumber(trade.r);
  if (r !== null) group.totalR += r;
}

function finalizeGroup(group) {
  group.winRate = group.trades > 0
    ? group.win / group.trades * 100
    : 0;
  group.avgR = group.trades > 0
    ? group.totalR / group.trades
    : 0;
  delete group.totalR;
  return group;
}

function groupStats(taggedTrades) {
  const groups = {};
  ALIGNMENT_ORDER.forEach(function (key) {
    groups[key] = emptyGroup();
  });
  taggedTrades.forEach(function (trade) {
    const group = groups[trade.alignment] ||
      groups[ALIGNMENTS.UNTAGGED];
    pushClosedTrade(group, trade);
  });
  ALIGNMENT_ORDER.forEach(function (key) {
    finalizeGroup(groups[key]);
  });
  return groups;
}

/*
 * 按任意键分组统计（仅已收盘 trade）。键值自定义返回 null 时跳过。
 */
function groupBy(taggedTrades, keyOf) {
  const groups = {};
  taggedTrades.forEach(function (trade) {
    if (trade.status !== 'WIN' && trade.status !== 'LOSS') {
      return;
    }
    const key = keyOf(trade);
    if (key === null || key === undefined) return;
    const group = groups[key] || (groups[key] = emptyGroup());
    pushClosedTrade(group, trade);
  });
  return Object.keys(groups)
    .map(function (key) {
      return { key, ...finalizeGroup(groups[key]) };
    })
    .sort(function (left, right) {
      return right.trades - left.trades ||
        left.key.localeCompare(right.key);
    });
}

function byDirection(taggedTrades) {
  return groupBy(taggedTrades, function (trade) {
    if (!trade.htfMarketBias || !trade.setupDirection) {
      return null;
    }
    return trade.htfMarketBias + '+' + trade.setupDirection;
  });
}

function byLocation(taggedTrades) {
  return groupBy(taggedTrades, function (trade) {
    if (!trade.htfMarketBias || !trade.setupDirection) {
      return null;
    }
    return trade.htfMarketBias + '+' +
      (trade.htfLocation || 'UNKNOWN') + '+' +
      (trade.htfLocationReadiness || 'WAIT');
  });
}

/*
 * TRANSITION 重点：结构阶段（POST_MSS 等）+ transitionDirection。
 */
function transitionDetail(taggedTrades) {
  return groupBy(taggedTrades, function (trade) {
    if (trade.alignment !== ALIGNMENTS.TRANSITION) {
      return null;
    }
    return (trade.structureState || 'UNDETERMINED') +
      ' -> ' + (trade.transitionDirection || 'NEUTRAL');
  });
}

function summarize(taggedTrades) {
  const groups = groupStats(taggedTrades);
  const closed = taggedTrades.filter(function (trade) {
    return trade.status === 'WIN' || trade.status === 'LOSS';
  });
  const totals = {
    trades: closed.length,
    win: closed.filter(function (trade) {
      return trade.status === 'WIN';
    }).length,
    loss: closed.filter(function (trade) {
      return trade.status === 'LOSS';
    }).length,
    winRate: 0,
    avgR: 0,
  };
  const totalR = closed.reduce(function (sum, trade) {
    const r = finiteNumber(trade.r);
    return sum + (r === null ? 0 : r);
  }, 0);
  totals.winRate = totals.trades > 0
    ? totals.win / totals.trades * 100
    : 0;
  totals.avgR = totals.trades > 0
    ? totalR / totals.trades
    : 0;
  return {
    totals,
    byAlignment: groups,
    byDirection: byDirection(taggedTrades),
    byLocation: byLocation(taggedTrades),
    transitionDetail: transitionDetail(taggedTrades),
  };
}

function analyze(input) {
  input = input || {};
  const h4Klines = Array.isArray(input.h4Klines)
    ? input.h4Klines
    : [];
  const h4States = Array.isArray(input.h4States)
    ? input.h4States
    : h4Klines.length > 0
      ? h4StatesOf(h4Klines)
      : [];
  const structurePhaseStates = Array.isArray(
    input.structurePhaseStates
  ) ? input.structurePhaseStates
    : h4Klines.length > 0
      ? structurePhaseStatesOf(h4Klines)
      : [];
  const taggedTrades = tagTrades({
    trades: input.trades,
    klines5m: input.klines5m,
    h4States,
    structurePhaseStates,
  });
  const summary = summarize(taggedTrades);
  return {
    protocol: {
      version: 'DAILY_BIAS_BACKTEST_AUDIT_V1',
      biasSourceVersion: 'daily_bias_v1',
      alignment: {
        ALIGNED: 'htfMarketBias 与 setupDirection 同向',
        COUNTER: 'htfMarketBias 与 setupDirection 反向',
        TRANSITION: 'htfMarketBias = NEUTRAL（含转换阶段）',
        UNTAGGED: '入场前无已收盘 4H Daily Bias，不计入三向',
      },
    },
    symbol: typeof input.symbol === 'string'
      ? input.symbol
      : null,
    source: {
      trades: Array.isArray(input.trades)
        ? input.trades.length
        : 0,
      tagged: taggedTrades.length,
      h4Klines: h4Klines.length,
      h4States: h4States.length,
    },
    ...summary,
    trades: taggedTrades,
  };
}

function analyzeSymbols(input) {
  input = input || {};
  const symbolInputs = Array.isArray(input.symbols)
    ? input.symbols
    : [];
  const results = symbolInputs.map(function (item) {
    return analyze({
      trades: item.trades,
      klines5m: item.klines5m,
      h4Klines: item.h4Klines,
      h4States: item.h4States,
      structurePhaseStates: item.structurePhaseStates,
      symbol: item.symbol,
    });
  });
  return combine(results);
}

/*
 * 多符号聚合：
 *   perSymbol: 每个符号的 analyze() 结果（含 trade 明细）
 *   combined:  全部 trade 汇总（totals / byAlignment / byDirection /
 *              byLocation / transitionDetail）
 */
function combine(perSymbolResults) {
  const symbols = Array.isArray(perSymbolResults)
    ? perSymbolResults
    : [];
  const allTrades = symbols.reduce(function (list, result) {
    return list.concat(result && Array.isArray(result.trades)
      ? result.trades
      : []);
  }, []);
  const summary = summarize(allTrades);
  return {
    protocol: {
      version: 'DAILY_BIAS_BACKTEST_AUDIT_MULTI_V1',
      biasSourceVersion: 'daily_bias_v1',
    },
    source: {
      symbols: symbols.length,
      trades: symbols.reduce(function (sum, result) {
        return sum + (result && result.source
          ? result.source.trades
          : 0);
      }, 0),
      tagged: allTrades.length,
      h4Klines: symbols.reduce(function (sum, result) {
        return sum + (result && result.source
          ? result.source.h4Klines
          : 0);
      }, 0),
    },
    ...summary,
    perSymbol: symbols.map(function (result, index) {
      return {
        symbol: result.symbol || 'SYMBOL_' + index,
        totals: result.totals,
        byAlignment: result.byAlignment,
        source: result.source,
      };
    }),
    trades: allTrades,
  };
}

function formatGroup(group) {
  return (
    group.trades + ' trades, ' +
    'Win Rate ' + group.winRate.toFixed(1) + '%, ' +
    'Avg R ' + (group.avgR >= 0 ? '+' : '') +
    group.avgR.toFixed(2)
  );
}

function formatGroupRows(groups) {
  if (groups.length === 0) {
    return ['  （无样本）'];
  }
  return groups.map(function (item) {
    return '  ' + item.key + ': ' + formatGroup(item);
  });
}

function formatReport(result) {
  const lines = [
    'Daily Bias Backtest Audit',
    '',
    'protocol: ' + result.protocol.version,
    'biasSourceVersion: ' +
      result.protocol.biasSourceVersion,
    '',
    '输入: ' + result.source.trades + ' trades / ' +
      result.source.h4Klines + ' 根 4H K 线',
    '已打标: ' + result.source.tagged + ' trades',
    '',
    '全部 5m Trades:',
    '  ' + formatGroup(result.totals),
    '',
    'HTF ALIGNED:',
    '  ' + formatGroup(result.byAlignment.ALIGNED),
    '',
    'HTF COUNTER:',
    '  ' + formatGroup(result.byAlignment.COUNTER),
    '',
    'HTF TRANSITION:',
    '  ' + formatGroup(result.byAlignment.TRANSITION),
  ];
  if (result.byAlignment.UNTAGGED.trades > 0) {
    lines.push(
      '',
      'UNTAGGED（无已收盘 4H）:',
      '  ' + formatGroup(result.byAlignment.UNTAGGED)
    );
  }
  lines.push('', 'HTF Direction x LTF Direction:');
  lines.push.apply(lines, formatGroupRows(result.byDirection));
  lines.push('', 'HTF Location x Readiness:');
  lines.push.apply(lines, formatGroupRows(result.byLocation));
  lines.push('', 'TRANSITION 明细（结构阶段 -> 转换方向）:');
  lines.push.apply(
    lines,
    formatGroupRows(result.transitionDetail)
  );
  return lines.join('\n') + '\n';
}

function formatMultiReport(combined) {
  const lines = [
    'Daily Bias Backtest Audit - Multi Symbol',
    '',
    'protocol: ' + combined.protocol.version,
    'biasSourceVersion: ' +
      combined.protocol.biasSourceVersion,
    '',
    '符号数: ' + combined.source.symbols,
    '输入: ' + combined.source.trades + ' trades / ' +
      combined.source.h4Klines + ' 根 4H K 线',
    '已打标: ' + combined.source.tagged + ' trades',
    '',
    '===== 总体（全部市场合并）=====',
    '',
    '全部 5m Trades:',
    '  ' + formatGroup(combined.totals),
    '',
    'HTF ALIGNED:',
    '  ' + formatGroup(combined.byAlignment.ALIGNED),
    '',
    'HTF COUNTER:',
    '  ' + formatGroup(combined.byAlignment.COUNTER),
    '',
    'HTF TRANSITION:',
    '  ' + formatGroup(combined.byAlignment.TRANSITION),
  ];
  if (combined.byAlignment.UNTAGGED.trades > 0) {
    lines.push(
      '',
      'UNTAGGED（无已收盘 4H）:',
      '  ' + formatGroup(combined.byAlignment.UNTAGGED)
    );
  }
  lines.push('', 'HTF Direction x LTF Direction:');
  lines.push.apply(
    lines,
    formatGroupRows(combined.byDirection)
  );
  lines.push('', 'HTF Location x Readiness:');
  lines.push.apply(lines, formatGroupRows(combined.byLocation));
  lines.push('', 'TRANSITION 明细（结构阶段 -> 转换方向）:');
  lines.push.apply(
    lines,
    formatGroupRows(combined.transitionDetail)
  );
  combined.perSymbol.forEach(function (item) {
    lines.push(
      '',
      '===== ' + item.symbol + ' =====',
      '',
      '全部: ' + formatGroup(item.totals),
      'ALIGNED: ' + formatGroup(item.byAlignment.ALIGNED),
      'COUNTER: ' + formatGroup(item.byAlignment.COUNTER),
      'TRANSITION: ' +
        formatGroup(item.byAlignment.TRANSITION)
    );
    if (item.byAlignment.UNTAGGED.trades > 0) {
      lines.push(
        'UNTAGGED: ' +
          formatGroup(item.byAlignment.UNTAGGED)
      );
    }
  });
  return lines.join('\n') + '\n';
}

module.exports = {
  ALIGNMENTS,
  ALIGNMENT_ORDER,
  alignmentOf,
  analyze,
  analyzeSymbols,
  byDirection,
  byLocation,
  combine,
  formatGroup,
  formatGroupRows,
  formatMultiReport,
  formatReport,
  groupBy,
  groupStats,
  h4StatesOf,
  structurePhaseStatesOf,
  summarize,
  tagTrade,
  tagTrades,
  transitionDetail,
};
