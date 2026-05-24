const DEFAULT_WINDOW_START_FIELDS = [
  'startElapsedRealtimeNanos',
  'firstElapsedRealtimeNanos'
];
const DEFAULT_WINDOW_END_FIELDS = [
  'endElapsedRealtimeNanos',
  'lastElapsedRealtimeNanos'
];

export function createNearestWindowLookup(windows, options = {}) {
  const startFields = options.startFields || DEFAULT_WINDOW_START_FIELDS;
  const endFields = options.endFields || DEFAULT_WINDOW_END_FIELDS;
  const entries = [];
  for (let order = 0; order < (windows || []).length; order++) {
    const window = windows[order];
    const start = firstNumberField(window, startFields);
    const end = firstNumberField(window, endFields);
    if (start === null || end === null) continue;
    entries.push({ window, start, end, order });
  }

  const byStart = [...entries].sort((a, b) =>
    a.start - b.start || a.end - b.end || a.order - b.order);
  const starts = byStart.map((entry) => entry.start);
  const maxDuration = byStart.reduce((max, entry) =>
    Math.max(max, Math.max(0, entry.end - entry.start)), 0);

  return {
    nearest(elapsedRealtimeNanos) {
      const elapsed = finiteNumber(elapsedRealtimeNanos);
      if (elapsed === null || entries.length === 0) return null;
      const insertion = upperBound(starts, elapsed);
      let best = null;
      for (let index = insertion - 1; index >= 0; index--) {
        const candidate = byStart[index];
        if (best && elapsed - candidate.start > best.distance + maxDuration) break;
        best = betterNearestWindow(best, candidate, elapsed);
      }
      for (let index = insertion; index < byStart.length; index++) {
        const candidate = byStart[index];
        if (best && candidate.start - elapsed > best.distance) break;
        best = betterNearestWindow(best, candidate, elapsed);
      }
      return best?.window || null;
    }
  };
}

export function createRecentMotionSummaryIndex(motionSummaries, windowNanos) {
  const entries = [];
  for (const summary of motionSummaries || []) {
    const first = numberField(summary, 'firstElapsedRealtimeNanos');
    const last = numberField(summary, 'lastElapsedRealtimeNanos');
    if (first === null || last === null || first > last) continue;
    entries.push({
      first,
      last,
      still: summary.deviceStill === true || summary.isDeviceStill === true,
      active: isRecentActiveMotionSummary(summary)
    });
  }

  const byFirst = [...entries].sort((a, b) => a.first - b.first || a.last - b.last);
  const byLast = [...entries].sort((a, b) => a.last - b.last || a.first - b.first);
  const firstTimes = byFirst.map((entry) => entry.first);
  const lastTimes = byLast.map((entry) => entry.last);
  const firstStillPrefix = prefixCount(byFirst, 'still');
  const lastStillPrefix = prefixCount(byLast, 'still');
  const firstActivePrefix = prefixCount(byFirst, 'active');
  const lastActivePrefix = prefixCount(byLast, 'active');
  const cache = new Map();

  return {
    source: motionSummaries || [],
    recentStats(elapsedRealtimeNanos) {
      const elapsed = finiteNumber(elapsedRealtimeNanos);
      if (elapsed === null || entries.length === 0) return emptyRecentMotionStats();
      if (cache.has(elapsed)) return cache.get(elapsed);
      const cutoff = elapsed - windowNanos;
      const startedCount = upperBound(firstTimes, elapsed);
      const endedBeforeCutoff = lowerBound(lastTimes, cutoff);
      const stats = {
        total: Math.max(0, startedCount - endedBeforeCutoff),
        still: Math.max(0,
          firstStillPrefix[startedCount] - lastStillPrefix[endedBeforeCutoff]),
        active: Math.max(0,
          firstActivePrefix[startedCount] - lastActivePrefix[endedBeforeCutoff])
      };
      cache.set(elapsed, stats);
      return stats;
    }
  };
}

export function recentMotionStats(elapsedRealtimeNanos, motionSource, windowNanos) {
  if (motionSource && typeof motionSource.recentStats === 'function') {
    return motionSource.recentStats(elapsedRealtimeNanos);
  }
  if (!Array.isArray(motionSource)) return emptyRecentMotionStats();
  return recentMotionStatsLinear(elapsedRealtimeNanos, motionSource, windowNanos);
}

function betterNearestWindow(best, candidate, elapsedRealtimeNanos) {
  if (!candidate) return best;
  const distance = elapsedRealtimeNanos >= candidate.start && elapsedRealtimeNanos <= candidate.end
    ? 0
    : Math.min(Math.abs(elapsedRealtimeNanos - candidate.start),
      Math.abs(elapsedRealtimeNanos - candidate.end));
  if (!best || distance < best.distance
      || (distance === best.distance && candidate.order < best.order)) {
    return { ...candidate, distance };
  }
  return best;
}

function recentMotionStatsLinear(elapsedRealtimeNanos, motionSummaries, windowNanos) {
  const elapsed = finiteNumber(elapsedRealtimeNanos);
  if (elapsed === null) return emptyRecentMotionStats();
  const cutoff = elapsed - windowNanos;
  const stats = emptyRecentMotionStats();
  for (const summary of motionSummaries) {
    const first = numberField(summary, 'firstElapsedRealtimeNanos');
    const last = numberField(summary, 'lastElapsedRealtimeNanos');
    if (first === null || last === null || last < cutoff || first > elapsed) continue;
    stats.total++;
    if (summary.deviceStill === true || summary.isDeviceStill === true) stats.still++;
    if (isRecentActiveMotionSummary(summary)) stats.active++;
  }
  return stats;
}

function isRecentActiveMotionSummary(summary) {
  const accel = numberField(summary, 'dynamicAccelRmsMps2') ?? 0;
  const gyro = numberField(summary, 'gyroscopeRmsRadps') ?? 0;
  const stepDelta = numberField(summary, 'stepDelta') ?? 0;
  const stepDetectorCount = numberField(summary, 'stepDetectorCount') ?? 0;
  return accel >= 0.35 || gyro >= 0.12 || stepDelta > 0 || stepDetectorCount > 0;
}

function prefixCount(entries, field) {
  const prefix = [0];
  for (const entry of entries) {
    prefix.push(prefix[prefix.length - 1] + (entry[field] ? 1 : 0));
  }
  return prefix;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function firstNumberField(object, fields) {
  for (const field of fields) {
    const value = numberField(object, field);
    if (value !== null) return value;
  }
  return null;
}

function numberField(object, field) {
  if (!object || object[field] === null || object[field] === undefined) {
    return null;
  }
  const value = Number(object[field]);
  return Number.isFinite(value) ? value : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function emptyRecentMotionStats() {
  return { total: 0, still: 0, active: 0 };
}
