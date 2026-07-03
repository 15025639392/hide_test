import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('platform adapter field mapping json locks critical neutral evidence invariants', async () => {
  const mapping = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'docs/platform-adapter-field-mapping.v1.json'), 'utf8'));

  assert.equal(mapping.schemaVersion, 'platform-adapter-field-mapping-v1');
  assert.equal(mapping.evidenceSchemaVersion, 'outdoor-track-evidence-v1');
  assert.ok(mapping.principles.includes(
    'New platform adapters, including watchOS, emit outdoor-track-evidence-v1 directly as their durable evidence output.'));
  assert.deepEqual(mapping.platforms.map((platform) => platform.platform), [
    'android_legacy_v3',
    'watchos_ios',
    'harmony'
  ]);
  assert.equal(
    byPlatform(mapping, 'watchos_ios').durableOutputSchema,
    'outdoor-track-evidence-v1');
  assert.equal(
    byPlatform(mapping, 'watchos_ios').nativeSchemaAllowedOutsideAdapter,
    false);

  for (const platform of mapping.platforms) {
    assert.ok(
      findMapping(platform, 'location_sample', 'fixElapsedRealtimeNanos')?.required,
      `${platform.platform} must map location fix monotonic time`);
    assert.ok(
      findMapping(platform, 'location_sample', 'horizontalAccuracyMeters')?.required,
      `${platform.platform} must map horizontal accuracy`);
    assert.ok(
      findMapping(platform, 'barometer_window', 'windowAscentMeters')?.required,
      `${platform.platform} must emit barometer ascent`);
    assert.ok(
      findMapping(platform, 'barometer_window', 'windowDescentMeters')?.required,
      `${platform.platform} must emit barometer descent`);
    assert.equal(
      findMapping(platform, 'location_sample', 'callbackDelayNanos')?.diagnosticOnly,
      true,
      `${platform.platform} callback delay must stay diagnostic-only`);
  }

  assert.match(
    findMapping(byPlatform(mapping, 'android_legacy_v3'), 'location_sample', 'fixElapsedRealtimeNanos')
      .sourceField,
    /elapsedRealtimeNanos/);
  assert.match(
    findMapping(byPlatform(mapping, 'watchos_ios'), 'location_sample', 'fixElapsedRealtimeNanos')
      .sourceField,
    /estimatedFixElapsedRealtimeNanos/);
  assert.match(
    findMapping(byPlatform(mapping, 'harmony'), 'location_sample', 'fixElapsedRealtimeNanos')
      .sourceField,
    /estimatedFixElapsedRealtimeNanos|monotonic fix time/);

  const invariantIds = new Set(mapping.criticalInvariants.map((item) => item.id));
  for (const required of [
    'fix-time-primary',
    'event-time-not-continuity',
    'estimated-fix-equivalence',
    'callback-delay-diagnostic-only',
    'gain-loss-first-class',
    'diagnostic-quality-not-truth',
    'watchos-neutral-output',
    'privacy'
  ]) {
    assert.ok(invariantIds.has(required), `missing invariant ${required}`);
  }
});

test('platform adapter field mapping docs point AI to the machine-readable contract', async () => {
  const doc = await readFile(
    path.join(REPO_ROOT, 'docs/platform-adapter-field-mapping.md'), 'utf8');
  const evidenceContract = await readFile(
    path.join(REPO_ROOT, 'docs/platform-neutral-evidence-jsonl-contract.md'), 'utf8');

  for (const required of [
    'docs/platform-adapter-field-mapping.v1.json',
    'watchOS 的持久化轨迹证据输出就是 `outdoor-track-evidence-v1`',
    'fixElapsedRealtimeNanos',
    'estimatedFixElapsedRealtimeNanos',
    'eventElapsedRealtimeNanos',
    'callbackDelayNanos',
    'windowAscentMeters',
    'windowDescentMeters',
    '不能只保留净高度差',
    '不能直接变成 route truth'
  ]) {
    assert.ok(doc.includes(required), `missing mapping doc text: ${required}`);
  }
  assert.ok(evidenceContract.includes(
    'watchOS / iOS 的持久化证据产物也应直接是 `outdoor-track-evidence-v1` JSONL'));
});

test('migration docs require adapter mapping before platform implementation', async () => {
  const migrationPrompt = await readFile(
    path.join(REPO_ROOT, 'docs/cross-platform-migration-prompt-engineering.md'), 'utf8');
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const agents = await readFile(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  const rustReadme = await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-rust/README.md'), 'utf8');
  const rustBoundary = await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-rust/01-core-boundary.md'), 'utf8');

  for (const text of [migrationPrompt, readme, agents, rustReadme, rustBoundary]) {
    assert.ok(
      text.includes('platform-adapter-field-mapping.md'),
      'missing platform adapter mapping doc link');
  }
  assert.ok(migrationPrompt.includes('docs/platform-adapter-field-mapping.v1.json'));
  assert.ok(migrationPrompt.includes('windowAscentMeters'));
  assert.ok(migrationPrompt.includes('windowDescentMeters'));
  assert.ok(migrationPrompt.includes('callbackDelayNanos'));
  assert.ok(migrationPrompt.includes(
    'watchOS / iOS 的持久化轨迹证据输出必须直接是 `outdoor-track-evidence-v1`'));
  assert.ok(migrationPrompt.includes('不能直接变成 route truth'));
});

function byPlatform(mapping, platformName) {
  return mapping.platforms.find((platform) => platform.platform === platformName);
}

function findMapping(platform, neutralEvent, neutralField) {
  return platform?.mappings.find((mapping) =>
    mapping.neutralEvent === neutralEvent && mapping.neutralField === neutralField);
}
