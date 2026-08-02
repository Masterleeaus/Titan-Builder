import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillManifestValidationError,
  TITAN_SKILL_MANIFEST_JSON_SCHEMA,
  parseSkillManifest,
} from './manifest.ts';

const root = path.resolve(import.meta.dirname, '../..');

async function readFixture(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8')) as unknown;
}

test('accepts a guidance skill with a legacy alias', async () => {
  const manifest = parseSkillManifest(await readFixture(
    'browser-extension/skill-library/examples/systematic-debugging/manifest.json',
  ));

  assert.equal(manifest.kind, 'guidance');
  assert.deepEqual(manifest.aliases, ['debugging']);
  assert.equal(manifest.risk, 'READ');
  assert.equal(manifest.approval, 'none');
});

test('accepts an executable skill with explicit schemas and runtime entrypoint', async () => {
  const manifest = parseSkillManifest(await readFixture(
    'browser-extension/skill-library/examples/project-path-containment/manifest.json',
  ));

  assert.equal(manifest.kind, 'executable');
  assert.equal(manifest.entrypoint, 'src/security/project-path.ts#resolveProjectPath');
  assert.deepEqual(manifest.runtimeTargets, ['root']);
});

test('rejects executable skills without an entrypoint', async () => {
  const fixture = await readFixture(
    'browser-extension/skill-library/fixtures/invalid/executable-without-entrypoint.json',
  );

  assert.throws(
    () => parseSkillManifest(fixture),
    (error: unknown) => error instanceof SkillManifestValidationError
      && error.issues.some((issue) => issue.path === 'entrypoint'),
  );
});

test('requires approval for high-side-effect risks', async () => {
  const fixture = await readFixture(
    'browser-extension/skill-library/fixtures/invalid/high-risk-without-approval.json',
  );

  assert.throws(
    () => parseSkillManifest(fixture),
    (error: unknown) => error instanceof SkillManifestValidationError
      && error.issues.some((issue) => issue.path === 'approval'),
  );
});

test('rejects self dependencies and duplicate aliases', async () => {
  const fixture = await readFixture(
    'browser-extension/skill-library/examples/project-path-containment/manifest.json',
  ) as Record<string, unknown>;
  fixture.dependencies = [fixture.id];
  fixture.aliases = ['path-containment', 'path-containment'];

  assert.throws(
    () => parseSkillManifest(fixture),
    (error: unknown) => error instanceof SkillManifestValidationError
      && error.issues.some((issue) => issue.path === 'dependencies')
      && error.issues.some((issue) => issue.path === 'aliases'),
  );
});

test('rejects undeclared top-level fields', async () => {
  const fixture = await readFixture(
    'browser-extension/skill-library/examples/project-path-containment/manifest.json',
  ) as Record<string, unknown>;
  fixture.unreviewedPolicy = true;

  assert.throws(
    () => parseSkillManifest(fixture),
    (error: unknown) => error instanceof SkillManifestValidationError
      && error.issues.some((issue) => issue.path === 'unreviewedPolicy'),
  );
});

test('exports the checked-in JSON Schema as the runtime contract', async () => {
  const schema = await readFixture('src/skills/titan-skill-manifest.schema.json');
  assert.deepEqual(TITAN_SKILL_MANIFEST_JSON_SCHEMA, schema);
});
