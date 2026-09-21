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
