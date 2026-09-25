// Regression test for `agent-test-kit --version` / `-v` / `version` — added
// after manual testing (npm link into a consumer repo) revealed the CLI had
// no way to confirm which installed/linked version was actually running.
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const BIN_ENTRY = path.join(__dirname, '..', 'bin', 'agent-test-kit.js');
const EXPECTED_VERSION = require('../package.json').version;

function runCli(args) {
  return execFileSync(process.execPath, [BIN_ENTRY, ...args], { encoding: 'utf8', timeout: 10000 });
}

async function testVersionFlagPrintsThePackageVersion() {
  assert.strictEqual(runCli(['--version']).trim(), EXPECTED_VERSION);
}

async function testShortVersionFlagPrintsTheSameVersion() {
  assert.strictEqual(runCli(['-v']).trim(), EXPECTED_VERSION);
}

async function testVersionCommandPrintsTheSameVersion() {
  assert.strictEqual(runCli(['version']).trim(), EXPECTED_VERSION);
}

async function main() {
  const tests = [
    testVersionFlagPrintsThePackageVersion,
    testShortVersionFlagPrintsTheSameVersion,
    testVersionCommandPrintsTheSameVersion
  ];
  for (const t of tests) {
    process.stdout.write(t.name + '... ');
    await t();
    console.log('OK');
  }
  console.log('\nAll ' + tests.length + ' cli-version tests passed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
