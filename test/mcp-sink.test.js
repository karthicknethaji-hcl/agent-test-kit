// End-to-end test for mcpSink, exercised against the credential-free
// example-json-file-mcp-server reference server (mcp-servers/) — this is the
// one reference server safe to run in CI, since it needs no network access
// or database credentials.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMcpSink } = require('../src/adapters/resultsSinks/mcpSink');

const SERVER_ENTRY = path.join(__dirname, '..', 'mcp-servers', 'example-json-file-mcp-server', 'index.js');

function sampleRow(overrides) {
  return Object.assign({
    testId: 'T-1', traceId: null, agentName: 'demo', category: 'c', metric: 'm',
    score: null, pass: true, evaluator: 'e', runId: 'r1', notes: null, recommendation: null,
    timestamp: new Date().toISOString()
  }, overrides || {});
}

function makeSink(jsonFile) {
  return createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } });
}

async function testWritePreflightFinalizeCloseRoundTrip() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-mcp-'));
  const jsonFile = path.join(tmpDir, 'results.json');
  const sink = makeSink(jsonFile);

  const preflightResult = await sink.preflight();
  assert.strictEqual(preflightResult.ok, true, 'preflight against a working server must report ok');

  await sink.write(sampleRow({ testId: 'T-1' }));
  await sink.write(sampleRow({ testId: 'T-2', pass: false }));
  assert.deepStrictEqual(sink.getStats(), { attempted: 2, failed: 0 }, 'both writes must be counted as attempted with no failures');

  await sink.finalize({ runId: 'r1', agentName: 'demo', totalRun: 2, totalFail: 1, byCategory: {} });
  await sink.close();
  await sink.close(); // must be idempotent — a second close() must not throw

  const onDisk = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  assert.strictEqual(onDisk.length, 2, 'both rows must have landed in the JSON file');
  assert.deepStrictEqual(onDisk.map((r) => r.testId).sort(), ['T-1', 'T-2']);
}

async function testQueryResultsFiltersAndPaginates() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-mcp-query-'));
  const jsonFile = path.join(tmpDir, 'results.json');
  const sink = makeSink(jsonFile);

  for (let i = 1; i <= 5; i++) {
    await sink.write(sampleRow({ testId: 'Q-' + i, pass: i % 2 === 0 }));
  }

  assert.strictEqual(await sink.supportsQueryResults(), true, 'the example server advertises query_results');

  const passOnly = await sink.queryResults({ pass: true });
  assert.strictEqual(passOnly.rows.length, 2, 'pass:true filter must return only the passing rows: ' + JSON.stringify(passOnly.rows));

  const page1 = await sink.queryResults({ limit: 2 });
  assert.strictEqual(page1.rows.length, 2, 'limit:2 must cap the page size');
  assert.ok(page1.nextCursor, 'a full page must report a nextCursor when more rows remain');

  const page2 = await sink.queryResults({ limit: 2, cursor: page1.nextCursor });
  assert.strictEqual(page2.rows.length, 2, 'the second page must also return 2 rows');
  assert.notStrictEqual(page1.rows[0].testId, page2.rows[0].testId, 'consecutive pages must not repeat rows');

  await sink.close();
}

// Regression test for a real bug found by code review: ensureConnected()'s
// `connecting` promise was never reset on rejection, so a rejected promise
// (still truthy) was cached forever — every later call re-awaited the same
// stale rejection instead of retrying, even once the underlying problem
// (here, a marker file gating success) had cleared.
async function testSinkRecoversAfterAFailedFirstConnectionAttempt() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-mcp-flaky-'));
  const jsonFile = path.join(tmpDir, 'results.json');
  const markerFile = path.join(tmpDir, 'allow-connect.marker');

  // A tiny wrapper: exits immediately (simulating a failed spawn/connect) on
  // its first invocation, then delegates to the real reference server on
  // every subsequent invocation once the marker file exists.
  const flakyServerPath = path.join(tmpDir, 'flaky-server.js');
  fs.writeFileSync(flakyServerPath, `
    const fs = require('fs');
    if (!fs.existsSync(${JSON.stringify(markerFile)})) {
      fs.writeFileSync(${JSON.stringify(markerFile)}, 'seen');
      process.exit(1);
    }
    require(${JSON.stringify(SERVER_ENTRY)});
  `, 'utf8');

  const sink = createMcpSink({ command: 'node', args: [flakyServerPath], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } });

  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  let firstAttemptFailed = false;
  try {
    await sink.write(sampleRow({ testId: 'FLAKY-1' }));
    firstAttemptFailed = sink.getStats().failed === 1;
    // Without the fix, this second call would re-await the same cached,
    // already-rejected promise forever and never actually retry the spawn.
    await sink.write(sampleRow({ testId: 'FLAKY-2' }));
  } finally {
    console.warn = origWarn;
    await sink.close();
  }

  assert.ok(firstAttemptFailed, 'the first write (against the deliberately-failing server) must be counted as failed');
  assert.deepStrictEqual(sink.getStats(), { attempted: 2, failed: 1 }, 'the second write must succeed once the underlying issue clears, not replay the first failure forever: ' + JSON.stringify(sink.getStats()));
  const onDisk = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  assert.deepStrictEqual(onDisk.map((r) => r.testId), ['FLAKY-2'], 'only the successfully-retried write must have landed');
}

// Regression test for a real bug found by code review: the reference
// servers' cursor parsing (`parseInt(cursor,10) || 0`) silently swallowed a
// malformed cursor and reset pagination to page 1 instead of erroring.
async function testMalformedCursorIsRejectedNotSilentlyReset() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-mcp-badcursor-'));
  const jsonFile = path.join(tmpDir, 'results.json');
  const sink = makeSink(jsonFile);

  await sink.write(sampleRow({ testId: 'C-1' }));

  let threw = false;
  try {
    await sink.queryResults({ cursor: 'not-a-number' });
  } catch (e) {
    threw = true;
    assert.ok(/invalid cursor/.test(e.message), 'the error must clearly name the bad cursor, not silently reset to page 1: ' + e.message);
  }
  assert.ok(threw, 'a malformed cursor must be rejected, not silently treated as offset 0');

  await sink.close();
}

async function testWriteWarnsAndCountsFailureWhenServerProcessIsGone() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-mcp-dead-'));
  const jsonFile = path.join(tmpDir, 'results.json');
  // A command that will fail to spawn/connect at all is enough to exercise
  // the "never throw, warn and count as failed" path without needing to kill
  // a live child process mid-run.
  const sink = createMcpSink({ command: 'node', args: ['/path/does/not/exist.js'], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } });

  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    await sink.write(sampleRow({ testId: 'DEAD-1' }));
  } finally {
    console.warn = origWarn;
  }

  assert.deepStrictEqual(sink.getStats(), { attempted: 1, failed: 1 }, 'a write against an unreachable server must be counted as attempted+failed, not thrown');
  assert.ok(warns.length > 0, 'the failure must be warned about');
}

async function main() {
  const tests = [
    testWritePreflightFinalizeCloseRoundTrip,
    testQueryResultsFiltersAndPaginates,
    testSinkRecoversAfterAFailedFirstConnectionAttempt,
    testMalformedCursorIsRejectedNotSilentlyReset,
    testWriteWarnsAndCountsFailureWhenServerProcessIsGone
  ];
  for (const t of tests) {
    process.stdout.write(t.name + '... ');
    await t();
    console.log('OK');
  }
  console.log('\nAll ' + tests.length + ' mcpSink tests passed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
