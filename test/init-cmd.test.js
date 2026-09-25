// Regression test for `agent-test-kit init`'s .gitignore scaffolding — found
// missing a rule for `migrate-layout`'s own backup-snapshot folder while
// testing the migration against a real consumer repo: the backup landed as
// an untracked, un-ignored directory at the repo root.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { init } = require('../src/cli/commands/init');

function readGitignoreLines(cwd) {
  return fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8').split(/\r?\n/);
}

async function testInitAddsBothResultsAndMigrationBackupIgnoreRules() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-init-'));

  init(cwd, {});

  const lines = readGitignoreLines(cwd);
  assert.ok(lines.includes('test-suite/agents/*/results/'), 'must ignore per-agent results/ folders: ' + JSON.stringify(lines));
  assert.ok(lines.includes('.agent-test-kit-migration-backup-*/'), 'must ignore migrate-layout backup snapshots: ' + JSON.stringify(lines));
}

async function testInitOnlyAppendsWhateverIsMissingFromAnExistingGitignore() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-init-existing-'));
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\ntest-suite/agents/*/results/\n', 'utf8');

  init(cwd, {});

  const lines = readGitignoreLines(cwd);
  assert.strictEqual(lines.filter((l) => l === 'test-suite/agents/*/results/').length, 1, 'must not duplicate a rule that is already present: ' + JSON.stringify(lines));
  assert.ok(lines.includes('.agent-test-kit-migration-backup-*/'), 'must still add the rule that was actually missing: ' + JSON.stringify(lines));
}

async function main() {
  const tests = [
    testInitAddsBothResultsAndMigrationBackupIgnoreRules,
    testInitOnlyAppendsWhateverIsMissingFromAnExistingGitignore
  ];
  for (const t of tests) {
    process.stdout.write(t.name + '... ');
    await t();
    console.log('OK');
  }
  console.log('\nAll ' + tests.length + ' init-cmd tests passed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
