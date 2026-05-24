import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNearestWindowLookup,
  createRecentMotionSummaryIndex,
  recentMotionStats
} from '../src/timeWindowIndex.mjs';

test('nearest window lookup preserves overlap and tie behavior', () => {
  const windows = [
    { id: 'older', startElapsedRealtimeNanos: 0, endElapsedRealtimeNanos: 10 },
    { id: 'covering', startElapsedRealtimeNanos: 9, endElapsedRealtimeNanos: 20 },
    { id: 'after', startElapsedRealtimeNanos: 21, endElapsedRealtimeNanos: 22 }
  ];
  const lookup = createNearestWindowLookup(windows);

  assert.equal(lookup.nearest(15).id, 'covering');
  assert.equal(lookup.nearest(20.5).id, 'covering');
  assert.equal(lookup.nearest(21.5).id, 'after');
});

test('recent motion index matches linear recent-window counts', () => {
  const motionSummaries = [
    {
      firstElapsedRealtimeNanos: 0,
      lastElapsedRealtimeNanos: 1,
      isDeviceStill: true
    },
    {
      firstElapsedRealtimeNanos: 2,
      lastElapsedRealtimeNanos: 3,
      dynamicAccelRmsMps2: 0.4
    },
    {
      firstElapsedRealtimeNanos: 6,
      lastElapsedRealtimeNanos: 7,
      isDeviceStill: true
    }
  ];
  const index = createRecentMotionSummaryIndex(motionSummaries, 5);

  assert.deepEqual(recentMotionStats(7, index, 5), recentMotionStats(7, motionSummaries, 5));
  assert.deepEqual(recentMotionStats(7, index, 5), {
    total: 2,
    still: 1,
    active: 1
  });
});
