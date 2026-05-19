import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateBatch,
  isSessionJsonPath,
  normalizeSession,
  reportToMarkdown
} from '../src/evaluator.mjs';

function session(overrides) {
  return normalizeSession({
    sessionId: 'S',
    completionState: 'FINISHED',
    integrityState: 'OK',
    selectedAscentSource: 'BAROMETER',
    barometerTotalAscentMeters: 500,
    barometerAscentSampleCount: 100,
    barometerAscentRejectedSampleCount: 0,
    deviceBrand: 'brand',
    deviceModel: 'model',
    ...overrides
  });
}

test('same model batch passes when max relative deviation is within 8 percent', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 500 }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 540 }),
    session({ sessionId: 'C', barometerTotalAscentMeters: 520 })
  ], { deviceGroup: 'same-model' });

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.validDeviceCount, 3);
  assert.equal(report.excludedDeviceCount, 0);
});

test('cross brand same algorithm uses the wider review threshold', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 500, deviceBrand: 'brand-a' }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 660, deviceBrand: 'brand-b' })
  ]);

  assert.equal(report.deviceGroup, 'cross-brand-same-algorithm');
  assert.equal(report.verdict, 'REVIEW');
  assert.equal(report.devices[1].verdict, 'REVIEW');
});

test('same brand different models are detected automatically', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 500, deviceModel: 'model-a' }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 560, deviceModel: 'model-b' })
  ]);

  assert.equal(report.deviceGroup, 'same-brand');
  assert.equal(report.verdict, 'PASS');
});

test('low ascent route can pass by absolute deviation', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 40 }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 54 })
  ]);

  assert.equal(report.verdict, 'PASS');
});

test('invalid sessions are excluded before median calculation', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 500 }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 520 }),
    session({ sessionId: 'C', selectedAscentSource: 'GNSS', barometerTotalAscentMeters: -1 })
  ]);

  assert.equal(report.verdict, 'REVIEW');
  assert.equal(report.validDeviceCount, 2);
  assert.equal(report.excludedDeviceCount, 1);
  assert.equal(report.devices[2].verdict, 'EXCLUDED');
});

test('sessions missing completion or integrity state are excluded', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 500 }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 520 }),
    session({ sessionId: 'C', completionState: '' }),
    session({ sessionId: 'D', integrityState: '' })
  ]);

  assert.equal(report.validDeviceCount, 2);
  assert.equal(report.excludedDeviceCount, 2);
  assert.equal(report.devices[2].verdict, 'EXCLUDED');
  assert.equal(report.devices[3].verdict, 'EXCLUDED');
  assert.deepEqual(report.devices[2].findings, ['缺少 session 完成状态']);
  assert.deepEqual(report.devices[3].findings, ['缺少完整性状态']);
});

test('nonnumeric barometer sample count is excluded', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 500 }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 520 }),
    session({ sessionId: 'C', barometerAscentSampleCount: 'abc' })
  ]);

  assert.equal(report.validDeviceCount, 2);
  assert.equal(report.excludedDeviceCount, 1);
  assert.equal(report.devices[2].verdict, 'EXCLUDED');
  assert.deepEqual(report.devices[2].findings, ['气压计样本数为 0']);
});

test('missing device identity is marked as unknown and caps batch at review', () => {
  const report = evaluateBatch([
    session({
      sessionId: 'A',
      barometerTotalAscentMeters: 500,
      deviceBrand: '',
      deviceModel: '',
      deviceName: '',
      deviceManufacturer: ''
    }),
    session({
      sessionId: 'B',
      barometerTotalAscentMeters: 510,
      deviceBrand: 'brand',
      deviceModel: 'model'
    })
  ]);

  assert.equal(report.deviceGroup, 'unknown-device');
  assert.equal(report.deviceGroupLabel, '未知设备');
  assert.equal(report.verdict, 'REVIEW');
  assert.equal(report.devices[0].verdict, 'PASS');
  assert.deepEqual(report.devices[0].findings, ['设备信息缺失，设备组合需人工确认']);
});

test('single valid session without identity is unknown instead of same model', () => {
  const report = evaluateBatch([
    session({
      sessionId: 'A',
      deviceBrand: '',
      deviceModel: '',
      deviceName: '',
      deviceManufacturer: ''
    })
  ]);

  assert.equal(report.deviceGroup, 'unknown-device');
  assert.equal(report.verdict, 'FAIL');
});

test('markdown report includes device rows', () => {
  const report = evaluateBatch([
    session({ sessionId: 'A', barometerTotalAscentMeters: 500 }),
    session({ sessionId: 'B', barometerTotalAscentMeters: 520 })
  ]);

  const markdown = reportToMarkdown(report);

  assert.match(markdown, /同型号/);
  assert.match(markdown, /\| PASS \|/);
});

test('session json path detection accepts nested session manifests only', () => {
  assert.equal(isSessionJsonPath('session.json'), true);
  assert.equal(isSessionJsonPath('device-a/session.json'), true);
  assert.equal(isSessionJsonPath('device-a/diagnostic.jsonl'), false);
  assert.equal(isSessionJsonPath('session-backup.json'), false);
});
