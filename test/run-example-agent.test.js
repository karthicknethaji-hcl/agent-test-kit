// Package's own end-to-end test — no external API needed. Uses a stub
// judgeClient (deterministic canned response) instead of a real Anthropic
// call, so `npm test` works with zero credentials, per docs/GETTING-STARTED.md.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateAgent } = require('../src/core/validate');
const { runSuite } = require('../src/core/runner');
const { loadAgent } = require('../src/core/loadAgent');
const { isFullyApproved, defaultReviewStatus } = require('../src/core/reviewStatus');
const { createConsoleSink } = require('../src/adapters/resultsSinks/consoleSink');
const { createMarkdownSink } = require('../src/adapters/resultsSinks/markdownSink');
const { createMultiSink } = require('../src/adapters/resultsSinks/multiSink');
const { createIdentityTraceResolver } = require('../src/adapters/traceResolvers/identityTraceResolver');

const EXAMPLE_AGENT_DIR = path.join(__dirname, '..', 'examples', 'example-agent');

async function stubJudgeClient(promptText) {
  // Every judgePromptTemplate in the example agent asks for a "violated"
  // boolean — a deterministic, always-passing stub is enough to prove the
  // llm_judge dispatch path works end-to-end without a real model call.
  return JSON.stringify({ violated: false, recommendation: null });
}

async function testValidateAgentAcceptsTheExampleAgent() {
  const { valid, errors } = validateAgent(EXAMPLE_AGENT_DIR);
  assert.strictEqual(valid, true, 'example-agent should validate cleanly: ' + JSON.stringify(errors));
}

async function testValidateAgentRejectsMalformedTestCases() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-'));
  for (const f of ['rubrics.js', 'invoke-config.js', 'scriptChecks.js']) {
    fs.copyFileSync(path.join(EXAMPLE_AGENT_DIR, f), path.join(tmpDir, f));
  }
  // Deliberately malformed: missing required "rubric" field, invalid executionMode.
  fs.writeFileSync(
    path.join(tmpDir, 'test-cases.json'),
    JSON.stringify({ agentName: 'broken', schemaVersion: '1.0', testCases: [{ testId: 'X-1', category: 'x', v1Scope: true, executionMode: 'not-a-real-mode' }] })
  );
  const { valid, errors } = validateAgent(tmpDir);
  assert.strictEqual(valid, false, 'malformed test-cases.json must be rejected');
  assert.ok(errors.length > 0, 'must report at least one schema error');
}

async function testRunSuitePassesBothExampleRubrics() {
  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(EXAMPLE_AGENT_DIR);
  const { runId, results, totalFail } = await runSuite({
    invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel: stubJudgeClient,
    resultsSink: createConsoleSink(),
    traceResolver: createIdentityTraceResolver(),
    all: true
  });
  assert.ok(runId, 'run should produce a runId');
  assert.strictEqual(results.length, 2, 'both example test cases should run');
  assert.strictEqual(totalFail, 0, 'both example rubrics (script_diff + llm_judge) should pass: ' + JSON.stringify(results.map((r) => r.outcome)));
}

async function testMarkdownSinkWritesTableAndSummary() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-'));
  const filePath = path.join(tmpDir, 'results.md');
  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(EXAMPLE_AGENT_DIR);

  const { totalFail } = await runSuite({
    invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel: stubJudgeClient,
    resultsSink: createMarkdownSink({ filePath }),
    traceResolver: createIdentityTraceResolver(),
    all: true
  });
  assert.strictEqual(totalFail, 0);

  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('| Test ID | Category | Metric | Pass | Score | Evaluator | Recommendation |'), 'must contain the results table header');
  assert.ok(content.includes('EX-001'), 'must contain the first test case row');
  assert.ok(content.includes('EX-002'), 'must contain the second test case row');
  assert.ok(/\*\*Summary:\*\* 2\/2 passed/.test(content), 'finalize() must append a summary line: ' + content);
}

async function testMultiSinkFansOutToEverySink() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-multi-'));
  const mdPath = path.join(tmpDir, 'results.md');
  const written = [];
  const spySink = {
    async write(row) { written.push(row.testId); },
    async finalize(summary) { written.push('finalize:' + summary.totalRun); }
  };
  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(EXAMPLE_AGENT_DIR);

  await runSuite({
    invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel: stubJudgeClient,
    resultsSink: createMultiSink([createMarkdownSink({ filePath: mdPath }), spySink]),
    traceResolver: createIdentityTraceResolver(),
    all: true
  });

  assert.ok(fs.existsSync(mdPath), 'the markdown child sink must still have written its file');
  assert.deepStrictEqual(written, ['EX-001', 'EX-002', 'finalize:2'], 'both write() calls and the finalize() call must reach the spy sink: ' + JSON.stringify(written));
}

async function testTraceResolverReceivesAgentNameAlongsideClientTraceId() {
  const calls = [];
  const spyTraceResolver = { async resolve(clientTraceId, agentName) { calls.push({ clientTraceId, agentName }); return 'resolved-' + clientTraceId; } };
  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(EXAMPLE_AGENT_DIR);
  const written = [];

  await runSuite({
    invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel: stubJudgeClient,
    resultsSink: { async write(row) { written.push(row); } },
    traceResolver: spyTraceResolver,
    all: true
  });

  assert.strictEqual(calls.length, 2, 'resolve() must be called once per persisted row');
  for (const c of calls) {
    assert.strictEqual(c.agentName, 'example-agent', 'agentName must be passed alongside clientTraceId, not just the id alone');
  }
  for (const row of written) {
    assert.ok(row.traceId.startsWith('resolved-'), 'the row must use whatever the resolver actually returned');
  }
}

async function testGateEnforcementLogic() {
  assert.strictEqual(isFullyApproved(defaultReviewStatus()), false, 'a fresh agent must not be runnable by default');
  assert.strictEqual(
    isFullyApproved({ gate1: { approved: true }, gate2: { approved: true } }),
    true,
    'both gates approved must be runnable'
  );
  assert.strictEqual(
    isFullyApproved({ gate1: { approved: true }, gate2: { approved: false } }),
    false,
    'one gate missing must not be runnable'
  );
}

async function main() {
  const tests = [
    testValidateAgentAcceptsTheExampleAgent,
    testValidateAgentRejectsMalformedTestCases,
    testRunSuitePassesBothExampleRubrics,
    testMarkdownSinkWritesTableAndSummary,
    testMultiSinkFansOutToEverySink,
    testTraceResolverReceivesAgentNameAlongsideClientTraceId,
    testGateEnforcementLogic
  ];
  for (const t of tests) {
    process.stdout.write(t.name + '... ');
    await t();
    console.log('OK');
  }
  console.log('\nAll ' + tests.length + ' tests passed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
