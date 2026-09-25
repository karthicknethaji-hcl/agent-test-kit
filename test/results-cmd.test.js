// Regression test: an earlier version of resultsCmd never closed the
// resultsSink after querying, so an mcpSink's spawned child process kept the
// whole CLI process alive forever (caught via a manual end-to-end smoke test,
// not by any automated test — this file exists so it can't regress silently).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resultsCmd } = require('../src/cli/commands/resultsCmd');
const { createMcpSink } = require('../src/adapters/resultsSinks/mcpSink');

const SERVER_ENTRY = path.join(__dirname, '..', 'mcp-servers', 'example-json-file-mcp-server', 'index.js');

function sampleRow(overrides) {
  return Object.assign({
    testId: 'T-1', traceId: null, agentName: 'demo', category: 'c', metric: 'm',
    score: null, pass: true, evaluator: 'e', runId: 'r1', notes: null, recommendation: null,
    timestamp: new Date().toISOString()
  }, overrides || {});
}

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

// The real regression check: this test itself must finish and let the
// process exit normally. If resultsCmd() left the child process open, this
// test process would hang past its own completion (visible as `npm test`
// never returning), rather than failing an assertion — so the meaningful
// signal here is that `main()` at the bottom of this file actually reaches
// its console.log and the process exits.
async function testResultsCmdClosesTheSinkAfterQuerying() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-resultscmd-'));
  const jsonFile = path.join(tmpDir, 'results.json');

  const seedSink = createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } });
  await seedSink.write(sampleRow({ testId: 'R-1', pass: true }));
  await seedSink.write(sampleRow({ testId: 'R-2', pass: false }));
  await seedSink.close();

  const config = {
    createResultsSink: () => createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } })
  };

  const { logs } = await captureConsole(() => resultsCmd(config, 'demo', { pass: true }));
  assert.ok(logs.some((l) => l.includes('R-1')), 'the matching row must be printed: ' + JSON.stringify(logs));
  assert.ok(!logs.some((l) => l.includes('R-2')), 'the non-matching row must be filtered out: ' + JSON.stringify(logs));
  assert.strictEqual(process.exitCode, undefined, 'a successful query must not set a non-zero exit code');
}

// Regression test for a real bug found by code review: buildFilter() never
// merged the `<agent>` CLI argument into the query filter at all, so
// `agent-test-kit results <agent>` returned every agent's rows mixed
// together whenever multiple agents shared one server/table.
async function testResultsCmdFiltersOutOtherAgentsRows() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-resultscmd-agentfilter-'));
  const jsonFile = path.join(tmpDir, 'shared.json');

  const seedSink = createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } });
  await seedSink.write(sampleRow({ testId: 'A-1', agentName: 'agent-a' }));
  await seedSink.write(sampleRow({ testId: 'B-1', agentName: 'agent-b' }));
  await seedSink.close();

  const config = {
    createResultsSink: () => createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } })
  };

  const { logs } = await captureConsole(() => resultsCmd(config, 'agent-a', {}));
  assert.ok(logs.some((l) => l.includes('A-1')), 'agent-a\'s own row must be returned: ' + JSON.stringify(logs));
  assert.ok(!logs.some((l) => l.includes('B-1')), 'agent-b\'s row must NOT leak into agent-a\'s query results: ' + JSON.stringify(logs));
}

// Regression test for a real bug found by code review: resolveQuerySinks()
// used Promise.all (not allSettled) with no try/catch, so one unreachable
// sink inside a multiSink crashed the whole `results` command instead of
// letting a healthy sibling sink still be used.
async function testResultsCmdSurvivesOneBrokenSinkInAMultiSink() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-resultscmd-brokensink-'));
  const jsonFile = path.join(tmpDir, 'results.json');
  const { createMultiSink } = require('../src/adapters/resultsSinks/multiSink');

  const seedSink = createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } });
  await seedSink.write(sampleRow({ testId: 'G-1' }));
  await seedSink.close();

  const config = {
    createResultsSink: () => createMultiSink([
      createMcpSink({ command: 'node', args: ['/path/does/not/exist.js'] }), // broken: bad command
      createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFile } }) // healthy
    ])
  };

  const { logs, errors } = await captureConsole(() => resultsCmd(config, 'demo', {}));
  assert.ok(logs.some((l) => l.includes('G-1')), 'the healthy sink must still be usable despite its broken sibling: ' + JSON.stringify({ logs, errors }));
  assert.strictEqual(process.exitCode, undefined, 'a broken sibling sink must not crash the command or set a non-zero exit code');
}

async function testResultsCmdReportsAmbiguityAcrossMultipleQuerySinks() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-resultscmd-multi-'));
  const jsonFileA = path.join(tmpDir, 'a.json');
  const jsonFileB = path.join(tmpDir, 'b.json');
  const { createMultiSink } = require('../src/adapters/resultsSinks/multiSink');

  const config = {
    createResultsSink: () => createMultiSink([
      createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFileA } }),
      createMcpSink({ command: 'node', args: [SERVER_ENTRY], env: { AGENT_TEST_KIT_JSON_FILE: jsonFileB } })
    ])
  };

  const { errors } = await captureConsole(() => resultsCmd(config, 'demo', {}));
  assert.ok(errors.some((e) => e.includes('More than one query-capable sink')), 'two query-capable sinks must be reported as ambiguous, not silently concatenated: ' + JSON.stringify(errors));
  assert.strictEqual(process.exitCode, 1);
  process.exitCode = undefined;
}

async function main() {
  const tests = [
    testResultsCmdClosesTheSinkAfterQuerying,
    testResultsCmdFiltersOutOtherAgentsRows,
    testResultsCmdSurvivesOneBrokenSinkInAMultiSink,
    testResultsCmdReportsAmbiguityAcrossMultipleQuerySinks
  ];
  for (const t of tests) {
    process.stdout.write(t.name + '... ');
    await t();
    console.log('OK');
  }
  console.log('\nAll ' + tests.length + ' resultsCmd tests passed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
