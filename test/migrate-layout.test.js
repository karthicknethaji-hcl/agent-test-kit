// Tests for `agent-test-kit migrate-layout` — the one-time upgrade from the
// old flat per-agent layout to config/review/results (see
// docs/ARCHITECTURE.md). Covers the safety properties called out in the
// plan's "Review disposition": dry-run makes no changes, conflicts block
// before any write, unrecognized/global result files are left untouched, a
// backup snapshot is created, and the command is safely resumable.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { migrateLayoutCmd } = require('../src/cli/commands/migrateLayoutCmd');
const { getAgentPaths } = require('../src/core/agentPaths');

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return { logs, errors };
}

function scaffoldFlatAgent(agentsDir, name) {
  const agentDir = path.join(agentsDir, name);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'test-cases.json'), JSON.stringify({ agentName: name, schemaVersion: '1.0', testCases: [] }), 'utf8');
  fs.writeFileSync(path.join(agentDir, 'rubrics.js'), 'module.exports = {};\n', 'utf8');
  fs.writeFileSync(path.join(agentDir, 'invoke-config.js'), 'module.exports = {};\n', 'utf8');
  fs.writeFileSync(path.join(agentDir, 'review-status.json'), JSON.stringify({ gate1: { approved: true }, gate2: { approved: true } }), 'utf8');
  fs.writeFileSync(path.join(agentDir, 'README.md'), '# ' + name + '\n', 'utf8');
  return agentDir;
}

function scaffoldRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-migrate-'));
  const agentsDir = path.join(repoRoot, 'test-suite', 'agents');
  scaffoldFlatAgent(agentsDir, 'demo');

  const oldResultsDir = path.join(repoRoot, '.agent-test-kit-results');
  fs.mkdirSync(oldResultsDir, { recursive: true });
  fs.writeFileSync(path.join(oldResultsDir, 'run-demo-2026-01-01T00-00-00-000Z.md'), '# demo run\n', 'utf8');
  fs.writeFileSync(path.join(oldResultsDir, 'some-stray-file.txt'), 'not a recognized run file\n', 'utf8');
  fs.writeFileSync(path.join(repoRoot, '.agent-test-kit-results.ndjson'), '{"testId":"OLD-1"}\n', 'utf8');

  return { repoRoot, agentsDir };
}

function config(repoRoot, agentsDir) {
  return { root: repoRoot, agentsDir };
}

async function testDryRunMakesNoChanges() {
  const { repoRoot, agentsDir } = scaffoldRepo();
  const agentDir = path.join(agentsDir, 'demo');
  const before = fs.readdirSync(agentDir).sort();

  const { logs } = await captureConsole(() => migrateLayoutCmd(config(repoRoot, agentsDir), { dryRun: true }));

  assert.deepStrictEqual(fs.readdirSync(agentDir).sort(), before, 'dry-run must not move any file');
  assert.ok(!fs.existsSync(getAgentPaths(agentDir).config.dir), 'dry-run must not create the new config/ folder');
  assert.ok(logs.some((l) => l.includes('Dry run')), 'dry-run must say so explicitly: ' + JSON.stringify(logs));
  const backups = fs.readdirSync(repoRoot).filter((n) => n.startsWith('.agent-test-kit-migration-backup-'));
  assert.strictEqual(backups.length, 0, 'dry-run must not create a backup snapshot');
}

async function testFullMigrationMovesFilesAndLeavesUnknownFilesAlone() {
  const { repoRoot, agentsDir } = scaffoldRepo();
  const agentDir = path.join(agentsDir, 'demo');
  const paths = getAgentPaths(agentDir);

  await captureConsole(() => migrateLayoutCmd(config(repoRoot, agentsDir), {}));

  assert.ok(fs.existsSync(paths.config.testCases), 'test-cases.json must have moved into config/');
  assert.ok(fs.existsSync(paths.config.rubrics), 'rubrics.js must have moved into config/');
  assert.ok(fs.existsSync(paths.config.invokeConfig), 'invoke-config.js must have moved into config/');
  assert.ok(fs.existsSync(paths.review.reviewStatus), 'review-status.json must have moved into review/');
  assert.ok(fs.existsSync(paths.readme), 'README.md must stay at the agent folder root');
  assert.ok(!fs.existsSync(path.join(agentDir, 'test-cases.json')), 'the old flat test-cases.json must be gone after a successful move');

  assert.ok(fs.existsSync(path.join(paths.results.dir, 'run-demo-2026-01-01T00-00-00-000Z.md')), 'the matching results file must have moved into results/');
  assert.ok(!fs.existsSync(path.join(repoRoot, '.agent-test-kit-results', 'run-demo-2026-01-01T00-00-00-000Z.md')), 'the moved results file must be gone from the old location');
  assert.ok(fs.existsSync(path.join(repoRoot, '.agent-test-kit-results', 'some-stray-file.txt')), 'an unrecognized file in the old results dir must be left in place, never deleted');
  assert.ok(fs.existsSync(path.join(repoRoot, '.agent-test-kit-results.ndjson')), 'the legacy global NDJSON file must be left in place, never split or moved');

  const backups = fs.readdirSync(repoRoot).filter((n) => n.startsWith('.agent-test-kit-migration-backup-') && !n.endsWith('.tmp'));
  assert.strictEqual(backups.length, 1, 'exactly one finalized backup snapshot must be created');
  const backupTestCases = path.join(repoRoot, backups[0], path.relative(repoRoot, path.join(agentDir, 'test-cases.json')));
  assert.ok(fs.existsSync(backupTestCases), 'the backup must contain a copy of the moved test-cases.json: ' + backupTestCases);
}

// Regression test for a real bug found by code review: filesEqual() did a
// byte-exact string comparison, so a destination JSON file holding the same
// LOGICAL data but different whitespace/formatting was misclassified as a
// hard conflict, blocking the entire migration for a non-issue.
async function testSemanticallyIdenticalJsonIsNotTreatedAsAConflict() {
  const { repoRoot, agentsDir } = scaffoldRepo();
  const agentDir = path.join(agentsDir, 'demo');
  const paths = getAgentPaths(agentDir);
  fs.mkdirSync(paths.config.dir, { recursive: true });
  // Same data as the flat source file, but minified (no whitespace) instead
  // of the source's pretty-printed form — byte-different, semantically equal.
  fs.writeFileSync(paths.config.testCases, JSON.stringify({ agentName: 'demo', schemaVersion: '1.0', testCases: [] }), 'utf8');

  const { errors } = await captureConsole(() => migrateLayoutCmd(config(repoRoot, agentsDir), {}));

  assert.deepStrictEqual(errors, [], 'differently-formatted but semantically identical JSON must not be reported as a conflict: ' + JSON.stringify(errors));
  assert.notStrictEqual(process.exitCode, 1, 'must not abort with a conflict exit code');
  assert.ok(!fs.existsSync(path.join(agentDir, 'test-cases.json')), 'the redundant flat source must still be cleaned up (treated as pending-duplicate, not skipped)');
}

async function testConflictBlocksMigrationBeforeAnyWrite() {
  const { repoRoot, agentsDir } = scaffoldRepo();
  const agentDir = path.join(agentsDir, 'demo');
  const paths = getAgentPaths(agentDir);
  fs.mkdirSync(paths.config.dir, { recursive: true });
  fs.writeFileSync(paths.config.testCases, JSON.stringify({ different: 'content' }), 'utf8');

  const { errors } = await captureConsole(() => migrateLayoutCmd(config(repoRoot, agentsDir), {}));

  assert.ok(errors.some((e) => e.includes('conflict')), 'a real content conflict must be reported: ' + JSON.stringify(errors));
  assert.strictEqual(process.exitCode, 1, 'a conflict must set a non-zero exit code');
  process.exitCode = undefined;

  assert.ok(fs.existsSync(path.join(agentDir, 'rubrics.js')), 'no file may be moved once ANY conflict is detected — rubrics.js must still be in the old flat location');
  const backups = fs.readdirSync(repoRoot).filter((n) => n.startsWith('.agent-test-kit-migration-backup-'));
  assert.strictEqual(backups.length, 0, 'no backup should be created when the run aborts on a conflict');
}

// Regression test for a real bug found by code review: planResultsMoves
// matched result files to an agent via a plain array .find() over
// discovery-order names, so a shorter agent name that's a hyphen-prefix of a
// longer one (e.g. "demo" vs "demo-v2") would match first and silently
// misattribute the longer-named agent's files.
async function testResultsFilesAreNotMisattributedWhenOneAgentNameIsAPrefixOfAnother() {
  const { repoRoot, agentsDir } = scaffoldRepo();
  scaffoldFlatAgent(agentsDir, 'demo-v2');

  const oldResultsDir = path.join(repoRoot, '.agent-test-kit-results');
  fs.writeFileSync(path.join(oldResultsDir, 'run-demo-v2-2026-01-02T00-00-00-000Z.md'), '# demo-v2 run\n', 'utf8');

  await captureConsole(() => migrateLayoutCmd(config(repoRoot, agentsDir), {}));

  const demoResults = getAgentPaths(path.join(agentsDir, 'demo')).results.dir;
  const demoV2Results = getAgentPaths(path.join(agentsDir, 'demo-v2')).results.dir;
  assert.ok(
    fs.existsSync(path.join(demoV2Results, 'run-demo-v2-2026-01-02T00-00-00-000Z.md')),
    'the demo-v2 results file must land in demo-v2\'s own results/ folder'
  );
  assert.ok(
    !fs.existsSync(demoResults) || !fs.readdirSync(demoResults).includes('run-demo-v2-2026-01-02T00-00-00-000Z.md'),
    'the demo-v2 results file must NOT be misattributed to "demo" just because "demo" is a prefix of "demo-v2"'
  );
}

async function testMigrationIsIdempotentAndResumable() {
  const { repoRoot, agentsDir } = scaffoldRepo();
  const agentDir = path.join(agentsDir, 'demo');
  const paths = getAgentPaths(agentDir);

  // Simulate a prior run that finished moving test-cases.json but crashed
  // before the rest: destination exists, source is already gone.
  fs.mkdirSync(paths.config.dir, { recursive: true });
  const original = fs.readFileSync(path.join(agentDir, 'test-cases.json'), 'utf8');
  fs.renameSync(path.join(agentDir, 'test-cases.json'), paths.config.testCases);

  const { logs, errors } = await captureConsole(() => migrateLayoutCmd(config(repoRoot, agentsDir), {}));

  assert.deepStrictEqual(errors, [], 'resuming a partially-migrated agent must not be treated as an error: ' + JSON.stringify(errors));
  assert.strictEqual(fs.readFileSync(paths.config.testCases, 'utf8'), original, 'the already-migrated file must be left exactly as it was, not re-copied or corrupted');
  assert.ok(fs.existsSync(paths.config.rubrics), 'the remaining files must still complete their move on the resuming run');
  assert.ok(logs.some((l) => l.includes('migrated')), 'the resuming run must report completion: ' + JSON.stringify(logs));
}

async function main() {
  const tests = [
    testDryRunMakesNoChanges,
    testFullMigrationMovesFilesAndLeavesUnknownFilesAlone,
    testConflictBlocksMigrationBeforeAnyWrite,
    testSemanticallyIdenticalJsonIsNotTreatedAsAConflict,
    testResultsFilesAreNotMisattributedWhenOneAgentNameIsAPrefixOfAnother,
    testMigrationIsIdempotentAndResumable
  ];
  for (const t of tests) {
    process.stdout.write(t.name + '... ');
    await t();
    console.log('OK');
  }
  console.log('\nAll ' + tests.length + ' migrate-layout tests passed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
