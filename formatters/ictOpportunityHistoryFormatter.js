'use strict';

const BeijingTime = require('./beijingTime');
const OpportunityHistory = require(
  '../history/ictOpportunityHistory'
);

function opportunityKey(entry) {
  if (!entry) return null;
  return [
    entry.h4Bias || '',
    entry.direction || '',
    entry.liquidityType || '',
    Number.isFinite(entry.liquidityPrice)
      ? entry.liquidityPrice
      : '',
  ].join('|');
}

function recentLifecycle(record) {
  const transitions = record &&
    Array.isArray(record.transitions)
    ? record.transitions
    : [];
  if (transitions.length === 0) return [];

  const current = record.current ||
    transitions[transitions.length - 1];
  const end = transitions.length - 1;
  let start = 0;
  const completedSearchStart =
    current.status === 'CONFIRMED' ? end - 1 : end;

  for (
    let index = completedSearchStart;
    index >= 0;
    index -= 1
  ) {
    if (transitions[index].status === 'CONFIRMED') {
      start = index + 1;
      break;
    }
  }

  for (let index = end - 1; index >= start; index -= 1) {
    const prior = transitions[index];
    if (
      prior.h4Bias !== current.h4Bias ||
      (
        prior.direction &&
        current.direction &&
        prior.direction !== current.direction
      )
    ) {
      start = index + 1;
      break;
    }
  }

  for (let index = end; index >= start; index -= 1) {
    if (transitions[index].status === 'WAITING') {
      start = index;
      break;
    }
  }
  return transitions.slice(start);
}

function watchZoneDuration(lifecycle, asOf) {
  let watchIndex = -1;
  for (let index = lifecycle.length - 1; index >= 0; index -= 1) {
    if (lifecycle[index].status === 'WATCH_ZONE') {
      watchIndex = index;
      break;
    }
  }
  if (watchIndex < 0) return null;

  const start = Date.parse(lifecycle[watchIndex].changedAt);
  let end = Number.isFinite(new Date(asOf).getTime())
    ? new Date(asOf).getTime()
    : Date.now();

  for (
    let index = watchIndex + 1;
    index < lifecycle.length;
    index += 1
  ) {
    if (lifecycle[index].status !== 'WATCH_ZONE') {
      end = Date.parse(lifecycle[index].changedAt);
      break;
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return '未记录';
  let seconds = Math.floor(durationMs / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  const parts = [];

  if (days) parts.push(days + '天');
  if (hours) parts.push(hours + '小时');
  if (minutes) parts.push(minutes + '分钟');
  if (seconds || parts.length === 0) {
    parts.push(seconds + '秒');
  }
  return parts.join('');
}

function liquidityStatistics(history) {
  const counts = {};
  for (const record of Object.values(history.symbols)) {
    let previousKey = null;
    for (const entry of record.transitions) {
      if (!entry.liquidityType) {
        previousKey = null;
        continue;
      }
      const key = opportunityKey(entry);
      if (key !== previousKey) {
        counts[entry.liquidityType] =
          (counts[entry.liquidityType] || 0) + 1;
      }
      previousKey = key;
    }
  }
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => (
      right.count - left.count ||
      left.type.localeCompare(right.type)
    ));
}

function summarize(input, options) {
  options = options || {};
  const history = OpportunityHistory.normalizeHistory(input);
  const asOf = options.asOf === undefined
    ? Date.now()
    : options.asOf;
  const symbols = Object.keys(history.symbols)
    .sort()
    .map((symbol) => {
      const record = history.symbols[symbol];
      const lifecycle = recentLifecycle(record);
      return {
        symbol,
        current: record.current,
        lifecycle,
        watchZoneDurationMs: watchZoneDuration(
          lifecycle,
          asOf
        ),
        reachedConfirmed: lifecycle.some(
          (entry) => entry.status === 'CONFIRMED'
        ),
      };
    });

  return {
    generatedAt: new Date(asOf).toISOString(),
    symbols,
    liquidityStatistics: liquidityStatistics(history),
  };
}

function directionLabel(direction) {
  if (direction === 'BULLISH') return 'LONG';
  if (direction === 'BEARISH') return 'SHORT';
  return '未明确';
}

function formatPrice(price) {
  return Number.isFinite(price) ? String(price) : '未记录';
}

function format(summary) {
  const lines = [
    'ICT Opportunity History Report',
    '',
    '生成时间（UTC+8）：' +
      BeijingTime.formatBeijingTime(summary.generatedAt),
    '交易对数量：' + summary.symbols.length,
  ];

  if (summary.symbols.length === 0) {
    lines.push('', '暂无 Opportunity 历史记录。');
  }

  for (const item of summary.symbols) {
    const current = item.current;
    lines.push(
      '',
      '===== ' + item.symbol + ' =====',
      '',
      '1. 最近机会',
      '- 4H Bias：' + current.h4Bias,
      '- 方向：' + directionLabel(current.direction),
      '- 流动性类型：' +
        (current.liquidityType || '未记录'),
      '- 流动性价格：' +
        formatPrice(current.liquidityPrice),
      '- 当前状态：' + current.status,
      '- 最近变化时间（UTC+8）：' +
        BeijingTime.formatBeijingTime(current.changedAt),
      '',
      '2. 生命周期'
    );
    for (const transition of item.lifecycle) {
      lines.push(
        '- ' +
          BeijingTime.formatBeijingTime(
            transition.changedAt
          ) +
          '  ' + transition.status
      );
    }
    lines.push(
      '',
      '3. WATCH_ZONE持续时间：' +
        formatDuration(item.watchZoneDurationMs),
      '',
      '4. 是否达到CONFIRMED：' +
        (item.reachedConfirmed ? '是' : '否')
    );
  }

  lines.push('', '5. 流动性类型统计');
  if (summary.liquidityStatistics.length === 0) {
    lines.push('- 暂无已识别流动性类型');
  } else {
    for (const item of summary.liquidityStatistics) {
      lines.push('- ' + item.type + '：' + item.count + '次');
    }
  }
  return lines.join('\n') + '\n';
}

function formatHistory(input, options) {
  return format(summarize(input, options));
}

module.exports = {
  directionLabel,
  format,
  formatDuration,
  formatHistory,
  liquidityStatistics,
  opportunityKey,
  recentLifecycle,
  summarize,
  watchZoneDuration,
};
