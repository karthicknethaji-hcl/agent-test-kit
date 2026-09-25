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
const { getAgentPaths } = require('../src/core/agentPaths');
const { isFullyApproved, defaultReviewStatus, computeContentHash, checkGateContentDrift } = require('../src/core/reviewStatus');
const { createConsoleSink } = require('../src/adapters/resultsSinks/consoleSink');
const { createMarkdownSink } = require('../src/adapters/resultsSinks/markdownSink');
const { createMultiSink } = require('../src/adapters/resultsSinks/multiSink');
const { createIdentityTraceResolver } = require('../src/adapters/traceResolvers/identityTraceResolver');
const { runCmd } = require('../src/cli/commands/runCmd');
const { renderAgent } = require('../src/core/mdAuthoring/render');
const { syncAgent, checkMdStaleness } = require('../src/core/mdAuthoring/sync');

const EXAMPLE_AGENT_DIR = path.join(__dirname, '..', 'examples', 'example-agent');
const EXAMPLES_DIR = path.join(__dirname, '..', 'examples');

async function captureConsole(fn) {
  const logs = [];
  const warns = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return { logs, warns };
}

// Recursive — the fixture is now the nested config/review/README.md layout
// (see docs/ARCHITECTURE.md "Per-agent folder layout"), not a flat file list.
function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function copyExampleAgentInto(tmpDir) {
  copyDirRecursive(EXAMPLE_AGENT_DIR, tmpDir);
}

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
  const paths = getAgentPaths(tmpDir);
  fs.mkdirSync(paths.config.dir, { recursive: true });
  for (const f of ['rubrics.js', 'invoke-config.js', 'scriptChecks.js']) {
    fs.copyFileSync(path.join(EXAMPLE_AGENT_DIR, 'config', f), path.join(paths.config.dir, f));
  }
  // Deliberately malformed: missing required "rubric" field, invalid executionMode.
  fs.writeFileSync(
    paths.config.testCases,
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
  // Notes column is off by default (pass includeNotes: true to opt in).
  assert.ok(content.includes('| Test ID | Category | Metric | Score | Pass | Evaluator | Recommendation |'), 'must contain the results table header without Notes');
  assert.ok(content.includes('EX-001'), 'must contain the first test case row');
  assert.ok(content.includes('EX-002'), 'must contain the second test case row');
  assert.ok(/\*\*Summary:\*\* 2\/2 passed/.test(content), 'finalize() must append a summary line: ' + content);
}

async function testMarkdownSinkIncludesNotesColumnWhenOptedIn() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-notes-'));
  const filePath = path.join(tmpDir, 'results.md');
  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(EXAMPLE_AGENT_DIR);

  const { totalFail } = await runSuite({
    invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel: stubJudgeClient,
    resultsSink: createMarkdownSink({ filePath, includeNotes: true }),
    traceResolver: createIdentityTraceResolver(),
    all: true
  });
  assert.strictEqual(totalFail, 0);

  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('| Test ID | Category | Metric | Score | Pass | Evaluator | Notes | Recommendation |'), 'must contain the results table header with Notes');
}

async function testMarkdownSinkDefaultsToAFreshTimestampedFilePerRun() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-default-'));

  // No filePath given (the zero-config case, matching what config.js's
  // default createResultsSink() does for a legacy `dir`): each sink instance
  // must land in its own file under a results directory, not a single fixed
  // path.
  const sinkA = createMarkdownSink({ dir: tmpDir });
  const sinkB = createMarkdownSink({ dir: tmpDir });
  assert.notStrictEqual(sinkA.filePath, sinkB.filePath, 'two separate runs must never write to the same default file path');

  const resultsDir = path.join(tmpDir, '.agent-test-kit-results');
  assert.strictEqual(path.dirname(sinkA.filePath), resultsDir, 'the default file must live under .agent-test-kit-results/');
  assert.ok(/^run-.+\.md$/.test(path.basename(sinkA.filePath)), 'the default filename must be timestamped: ' + sinkA.filePath);

  // An agentName, when given (as run/smoke now always pass), must appear in
  // the default filename so a report is identifiable without opening it.
  const sinkNamed = createMarkdownSink({ dir: tmpDir, agentName: 'my-agent' });
  assert.ok(/^run-my-agent-.+\.md$/.test(path.basename(sinkNamed.filePath)), 'the default filename must include agentName: ' + sinkNamed.filePath);

  await sinkA.write({ testId: 'A-1', category: 'c', metric: 'm', pass: true, score: 1, evaluator: 'e', recommendation: null, runId: 'r1', agentName: 'agent', timestamp: new Date().toISOString() });
  await sinkB.write({ testId: 'B-1', category: 'c', metric: 'm', pass: true, score: 1, evaluator: 'e', recommendation: null, runId: 'r2', agentName: 'agent', timestamp: new Date().toISOString() });

  assert.ok(fs.readFileSync(sinkA.filePath, 'utf8').includes('A-1'), 'sinkA must only contain its own run\'s row');
  assert.ok(!fs.readFileSync(sinkA.filePath, 'utf8').includes('B-1'), 'sinkA must not contain sinkB\'s row — no cross-run overwrite/append');

  // An explicit filePath must still opt back into the old single-file,
  // append-forever behavior, for anyone who wants it.
  const fixedPath = path.join(tmpDir, 'fixed-results.md');
  const sinkC = createMarkdownSink({ filePath: fixedPath });
  const sinkD = createMarkdownSink({ filePath: fixedPath });
  assert.strictEqual(sinkC.filePath, sinkD.filePath, 'an explicit filePath must be honored exactly, not timestamped');
}

async function testMarkdownSinkResultsDirIsUsedAsIsWithNoSubfolderAppend() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-resultsdir-'));
  const resultsDir = path.join(tmpDir, 'test-suite', 'agents', 'my-agent', 'results');

  const sink = createMarkdownSink({ resultsDir });
  assert.strictEqual(path.dirname(sink.filePath), resultsDir, 'resultsDir must be used as-is, with no .agent-test-kit-results/ appended');

  assert.throws(
    () => createMarkdownSink({ dir: tmpDir, resultsDir }),
    /pass only one of "dir" or "resultsDir"/,
    'passing both dir and resultsDir together must be a configuration error, not a silent precedence choice'
  );
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

async function testMultiSinkCloseIsBestEffortAcrossChildren() {
  const closed = [];
  const goodSinkA = { async write() {}, async close() { closed.push('A'); } };
  const throwingSink = { async write() {}, async close() { closed.push('throwing'); throw new Error('boom'); } };
  const goodSinkB = { async write() {}, async close() { closed.push('B'); } };

  const { warns } = await captureConsole(async () => {
    await createMultiSink([goodSinkA, throwingSink, goodSinkB]).close();
  });

  assert.deepStrictEqual(closed.sort(), ['A', 'B', 'throwing'], 'every child\'s close() must be attempted even though one throws: ' + JSON.stringify(closed));
  assert.ok(warns.some((w) => w.includes('boom')), 'the failing child\'s error must be warned about, not swallowed silently');
}

// Regression test for a real bug found by code review: write()/finalize()
// were bare sequential loops with no per-child isolation, unlike this same
// file's preflight()/close() — one throwing child aborted the loop and
// silently skipped every sink listed after it.
async function testMultiSinkWriteAndFinalizeIsolateAThrowingChild() {
  const written = [];
  const finalized = [];
  const goodSinkA = { async write(row) { written.push('A:' + row.testId); }, async finalize() { finalized.push('A'); } };
  const throwingSink = {
    async write() { throw new Error('write boom'); },
    async finalize() { throw new Error('finalize boom'); }
  };
  const goodSinkB = { async write(row) { written.push('B:' + row.testId); }, async finalize() { finalized.push('B'); } };
  const multi = createMultiSink([goodSinkA, throwingSink, goodSinkB]);

  const { warns } = await captureConsole(async () => {
    await multi.write({ testId: 'X-1' });
    await multi.finalize({ totalRun: 1 });
  });

  assert.deepStrictEqual(written.sort(), ['A:X-1', 'B:X-1'], 'sinks after the throwing one must still receive write(): ' + JSON.stringify(written));
  assert.deepStrictEqual(finalized.sort(), ['A', 'B'], 'sinks after the throwing one must still receive finalize(): ' + JSON.stringify(finalized));
  assert.ok(warns.some((w) => w.includes('write boom')), 'the write() failure must be warned about: ' + JSON.stringify(warns));
  assert.ok(warns.some((w) => w.includes('finalize boom')), 'the finalize() failure must be warned about: ' + JSON.stringify(warns));
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

async function testRunnerClosesResultsSinkEvenWhenFinalizeThrows() {
  let closed = false;
  const fakeSink = {
    async write() {},
    async finalize() { throw new Error('finalize exploded'); },
    async close() { closed = true; }
  };
  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(EXAMPLE_AGENT_DIR);

  const { warns } = await captureConsole(() => runSuite({
    invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel: stubJudgeClient,
    resultsSink: fakeSink,
    traceResolver: createIdentityTraceResolver(),
    all: true
  }));

  assert.ok(closed, 'close() must still run even though finalize() threw — a finalize failure must never skip cleanup');
  assert.ok(warns.some((w) => w.includes('finalize exploded')), 'the finalize failure must be warned about, not silently swallowed');
}

async function testRunnerSurvivesACloseThatAlsoThrows() {
  const fakeSink = {
    async write() {},
    async finalize() { throw new Error('finalize exploded'); },
    async close() { throw new Error('close exploded too'); }
  };
  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(EXAMPLE_AGENT_DIR);

  let threw = false;
  const { warns } = await captureConsole(async () => {
    try {
      await runSuite({
        invoke, testCasesModule, rubricsConfig, scriptChecks,
        callJudgeModel: stubJudgeClient,
        resultsSink: fakeSink,
        traceResolver: createIdentityTraceResolver(),
        all: true
      });
    } catch (e) {
      threw = true;
    }
  });

  assert.strictEqual(threw, false, 'a close() that ALSO throws must not escape runSuite() and mask that finalize already completed/warned');
  assert.ok(warns.some((w) => w.includes('close exploded too')), 'the close() failure must be warned about independently');
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

// --- Feature 1: sink-failure visibility (preflight + getStats) ---

async function testPreflightFailureIsReportedButRunContinues() {
  const fakeSink = {
    describe() { return 'Fake Sink'; },
    async preflight() { return { ok: false, reason: 'relation does not exist' }; },
    async write() {}
  };
  const config = {
    agentsDir: EXAMPLES_DIR,
    createJudgeClient: () => stubJudgeClient,
    createResultsSink: () => fakeSink,
    createTraceResolver: () => createIdentityTraceResolver()
  };

  const { warns } = await captureConsole(() => runCmd(config, 'example-agent', { all: true }));
  assert.ok(
    warns.some((w) => w.includes('Fake Sink') && w.includes('relation does not exist')),
    'a failing preflight() must be warned about: ' + JSON.stringify(warns)
  );
  assert.strictEqual(process.exitCode, 0, 'a failing preflight must never stop the run or fail it');
  process.exitCode = undefined;
}

async function testGetStatsReflectedInPersistenceSummary() {
  let attempted = 0;
  let failed = 0;
  const fakeSink = {
    describe() { return 'Fake DB'; },
    async write(row) {
      attempted++;
      if (row.testId === 'EX-002') failed++;
    },
    getStats() { return { attempted, failed }; }
  };
  const config = {
    agentsDir: EXAMPLES_DIR,
    createJudgeClient: () => stubJudgeClient,
    createResultsSink: () => fakeSink,
    createTraceResolver: () => createIdentityTraceResolver()
  };

  const { logs } = await captureConsole(() => runCmd(config, 'example-agent', { all: true }));
  assert.ok(
    logs.some((l) => /Fake DB: 1\/2 rows persisted — 1 failed \(see warnings above\)/.test(l)),
    'the persistence summary must reflect getStats() counts: ' + JSON.stringify(logs)
  );
  process.exitCode = undefined;
}

// --- Feature 2: Markdown authoring round-trip ---

async function testMdRoundTripForExampleAgent() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-'));
  copyExampleAgentInto(tmpDir);
  const paths = getAgentPaths(tmpDir);
  const originalTestCases = JSON.parse(fs.readFileSync(paths.config.testCases, 'utf8'));
  const originalRubrics = require(paths.config.rubrics);

  const { testCasesMd, rubricsMd } = renderAgent(tmpDir);
  const { testCasesModule, rubricsConfig } = syncAgent(tmpDir, { testCasesMd, rubricsMd });

  assert.deepStrictEqual(testCasesModule, originalTestCases, 'test-cases.json must round-trip exactly through render() -> sync()');
  assert.deepStrictEqual(rubricsConfig, originalRubrics, 'rubrics.js must round-trip exactly through render() -> sync()');
}

async function testMdRoundTripForComplexFixture() {
  // example-agent only exercises single-turn + script_diff/llm_judge without
  // setup/judgeContext/thresholds. This fixture covers the rest of the
  // shape space the schema allows (dual-conversation, multi-turn with
  // setup, judgeContext, scale+threshold, toxicity_scan) — standing in for
  // test-suite/agents/capability-canvas, which doesn't exist in this repo.
  const testCasesModule = {
    agentName: 'complex-agent',
    schemaVersion: '1.0',
    sourceDoc: 'docs/complex-agent-spec.md',
    note: 'Synthetic fixture exercising every executionMode/field combo.',
    testCases: [
      {
        testId: 'CX-001',
        category: 'dd-format',
        rubric: 'DD-FMT',
        v1Scope: true,
        executionMode: 'single-turn',
        probe: { mode: 'dd', nested: { a: [1, 2, 3], b: null } },
        setup: [],
        judgeContext: { extra: 'info', count: 2 },
        expectedBehaviorNote: 'Model should preserve the literal "—" placeholder in the DD template\'s L4 field.\nSecond line of the note.',
        failureModeNote: 'Model substitutes an em dash or removes the placeholder entirely.'
      },
      {
        testId: 'CX-002',
        category: 'multi-step',
        rubric: 'MT1',
        v1Scope: false,
        executionMode: 'multi-turn',
        setup: [{ content: 'first message' }, { content: 'second message' }],
        probe: { content: 'final probe' }
      },
      {
        testId: 'CX-003',
        category: 'consistency',
        rubric: 'DUAL1',
        v1Scope: true,
        executionMode: 'dual-conversation',
        conversationA: { setup: [{ content: 'seedA' }], probe: { content: 'probeA' } },
        conversationB: { setup: [], probe: { content: 'probeB' } },
        judgeContext: { compare: true },
        expectedBehaviorNote: 'Both conversations should agree.',
        failureModeNote: 'Conversations diverge.'
      }
    ]
  };
  const rubricsConfig = {
    'DD-FMT': { metric: 'dd-format-fidelity', evaluatorType: 'script_diff' },
    MT1: { metric: 'multi-turn-consistency', evaluatorType: 'llm_judge', scale: '0-1', threshold: 0.85, judgePromptTemplate: 'Line1\nLine2 with "quotes" and `backticks`\n{{output}}' },
    DUAL1: { metric: 'dual-conversation-agreement', evaluatorType: 'toxicity_scan', scale: 'binary', judgePromptTemplate: 'Check toxicity.\n{{output}}' }
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-complex-'));
  const paths = getAgentPaths(tmpDir);
  fs.mkdirSync(paths.config.dir, { recursive: true });
  fs.writeFileSync(paths.config.testCases, JSON.stringify(testCasesModule, null, 2) + '\n', 'utf8');
  fs.writeFileSync(paths.config.rubrics, 'module.exports = ' + JSON.stringify(rubricsConfig, null, 2) + ';\n', 'utf8');
  // syncAgent() now runs the same scriptChecks.js completeness check as
  // validateAgent() (a script_diff rubric needs a matching handler), so this
  // fixture needs one for 'DD-FMT'.
  fs.writeFileSync(paths.config.scriptChecks, 'module.exports = { \'DD-FMT\': () => ({ pass: true, score: 1, notes: {}, recommendation: null }) };\n', 'utf8');

  const { testCasesMd, rubricsMd } = renderAgent(tmpDir);
  const { testCasesModule: parsedTC, rubricsConfig: parsedRubrics } = syncAgent(tmpDir, { testCasesMd, rubricsMd });

  assert.deepStrictEqual(parsedTC, testCasesModule, 'dual-conversation/setup/judgeContext fixture must round-trip exactly');
  assert.deepStrictEqual(parsedRubrics, rubricsConfig, 'threshold/toxicity_scan rubrics must round-trip exactly');
}

async function testSyncRejectsMangledMarkdownAndWritesNothing() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-err-'));
  copyExampleAgentInto(tmpDir);
  const paths = getAgentPaths(tmpDir);
  const before = fs.readFileSync(paths.config.testCases, 'utf8');

  const { testCasesMd, rubricsMd } = renderAgent(tmpDir);
  const probeFence = '```json\n{\n  "content": "Buy milk, eggs, and bread on the way home."\n}\n```';
  assert.ok(testCasesMd.includes(probeFence), 'fixture assumption changed — update the mangled fence to match');
  const mangled = testCasesMd.replace(probeFence, probeFence.slice(0, -4)); // drop the closing ```

  let threw = false;
  try {
    syncAgent(tmpDir, { testCasesMd: mangled, rubricsMd });
  } catch (e) {
    threw = true;
    assert.ok(/EX-001/.test(e.message) && /Probe/.test(e.message), 'the error must localize to the offending test case/section: ' + e.message);
  }
  assert.ok(threw, 'sync must throw on a malformed fenced block');
  assert.strictEqual(fs.readFileSync(paths.config.testCases, 'utf8'), before, 'test-cases.json must be untouched after a failed sync');
}

async function testCheckMdStalenessDetectsDriftAndClearsAfterSync() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-stale-'));
  copyExampleAgentInto(tmpDir);
  const paths = getAgentPaths(tmpDir);

  assert.deepStrictEqual(checkMdStaleness(tmpDir), [], 'no .review.md files yet -> nothing to report');

  const { testCasesMd, rubricsMd } = renderAgent(tmpDir);
  fs.mkdirSync(paths.review.dir, { recursive: true });
  fs.writeFileSync(paths.review.testCasesReview, testCasesMd, 'utf8');
  fs.writeFileSync(paths.review.rubricsReview, rubricsMd, 'utf8');
  assert.deepStrictEqual(checkMdStaleness(tmpDir), [], 'freshly rendered MD must not be stale');

  const original = fs.readFileSync(paths.config.testCases, 'utf8');
  fs.writeFileSync(paths.config.testCases, original.replace('EX-001', 'EX-001-HAND-EDITED'), 'utf8');
  assert.deepStrictEqual(checkMdStaleness(tmpDir), ['test-cases.review.md'], 'a hand-edited test-cases.json (bypassing the MD) must be flagged stale');

  fs.writeFileSync(paths.config.testCases, original, 'utf8');
  syncAgent(tmpDir);
  assert.deepStrictEqual(checkMdStaleness(tmpDir), [], 'a successful sync must re-stamp the marker so staleness clears');
}

async function testCheckGateContentDriftFiresAndStaysSilent() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-drift-'));
  copyExampleAgentInto(tmpDir);
  const paths = getAgentPaths(tmpDir);

  const hash = computeContentHash(tmpDir);
  const status = {
    gate1: { approved: true, approvedContentHash: hash },
    gate2: { approved: true, approvedContentHash: hash }
  };
  assert.deepStrictEqual(checkGateContentDrift(tmpDir, status), [], 'no drift immediately after stamping the approval hash');

  const original = fs.readFileSync(paths.config.testCases, 'utf8');
  fs.writeFileSync(paths.config.testCases, original.replace('EX-001', 'EX-001-CHANGED'), 'utf8');
  assert.deepStrictEqual(checkGateContentDrift(tmpDir, status), ['gate1', 'gate2'], 'both approved gates must be flagged once content changes post-approval');

  assert.deepStrictEqual(
    checkGateContentDrift(tmpDir, { gate1: { approved: true }, gate2: { approved: true } }),
    [],
    'a gate approved with no recorded approvedContentHash must never be flagged (informational only)'
  );

  assert.deepStrictEqual(
    checkGateContentDrift(path.join(tmpDir, 'does-not-exist'), { gate1: { approved: true, approvedContentHash: hash } }),
    [],
    'missing test-cases.json/rubrics.js (ENOENT) must be swallowed silently, never thrown'
  );
}

// Regression test for the bug this review found: checkMdStaleness used to
// compare the .review.md's embedded source-hash marker against the on-disk
// JSON, which never changes when a reviewer edits the .review.md body
// directly (the actual Gate 1 workflow) — so real unsynced edits went
// undetected. It's since been rewritten to fully parse the current
// .review.md and structurally compare it against the on-disk JSON/JS.
async function testCheckMdStalenessDetectsHandEditedReviewMdBody() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-stale-body-'));
  copyExampleAgentInto(tmpDir);
  const paths = getAgentPaths(tmpDir);

  const { testCasesMd, rubricsMd } = renderAgent(tmpDir);
  fs.mkdirSync(paths.review.dir, { recursive: true });
  fs.writeFileSync(paths.review.testCasesReview, testCasesMd, 'utf8');
  fs.writeFileSync(paths.review.rubricsReview, rubricsMd, 'utf8');
  assert.deepStrictEqual(checkMdStaleness(tmpDir), [], 'freshly rendered MD must not be stale');

  // Edit the .review.md BODY only — test-cases.json is untouched, so the old
  // marker-hash-vs-JSON-hash check would (incorrectly) still report clean.
  const editedMd = testCasesMd.replace(
    'wordCount in the parsed response equals the actual word count of the note.',
    'wordCount in the parsed response equals the actual word count of the note. EDITED BY REVIEWER, NOT YET SYNCED.'
  );
  assert.notStrictEqual(editedMd, testCasesMd, 'the edit must actually change the MD body');
  fs.writeFileSync(paths.review.testCasesReview, editedMd, 'utf8');

  assert.deepStrictEqual(
    checkMdStaleness(tmpDir),
    ['test-cases.review.md'],
    'an unsynced edit to the .review.md BODY (JSON left untouched) must now be detected as stale'
  );
}

async function testPreflightThrowingDoesNotCrashRun() {
  const fakeSink = {
    describe() { return 'Throwing Sink'; },
    async preflight() { throw new Error('ECONNREFUSED'); },
    async write() {}
  };
  const config = {
    agentsDir: EXAMPLES_DIR,
    createJudgeClient: () => stubJudgeClient,
    createResultsSink: () => fakeSink,
    createTraceResolver: () => createIdentityTraceResolver()
  };

  const { warns } = await captureConsole(() => runCmd(config, 'example-agent', { all: true }));
  assert.ok(
    warns.some((w) => w.includes('Throwing Sink') && w.includes('ECONNREFUSED')),
    'a preflight() that throws (instead of resolving to {ok:false}) must still be reported, not crash the run: ' + JSON.stringify(warns)
  );
  assert.strictEqual(process.exitCode, 0, 'a throwing preflight() must never stop or fail the run');
  process.exitCode = undefined;
}

async function testPersistenceSummarySilentForPlainSink() {
  const plainSink = { async write() {} }; // no describe(), no getStats() — like consoleSink
  const config = {
    agentsDir: EXAMPLES_DIR,
    createJudgeClient: () => stubJudgeClient,
    createResultsSink: () => plainSink,
    createTraceResolver: () => createIdentityTraceResolver()
  };

  const { logs } = await captureConsole(() => runCmd(config, 'example-agent', { all: true }));
  assert.ok(
    !logs.some((l) => l.includes('results sink')),
    'a sink with neither describe() nor getStats() must not get a fabricated persistence-summary line: ' + JSON.stringify(logs)
  );
  process.exitCode = undefined;
}

async function testSyncRejectsScriptDiffRubricMissingHandler() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-noscriptcheck-'));
  copyExampleAgentInto(tmpDir);
  const paths = getAgentPaths(tmpDir);
  // example-agent's rubrics.js already declares WC1 as script_diff with a
  // matching scriptChecks.js handler — delete the handler file entirely so
  // sync must now catch the same gap validateAgent() already catches.
  fs.unlinkSync(paths.config.scriptChecks);

  const { testCasesMd, rubricsMd } = renderAgent(tmpDir);
  let threw = false;
  try {
    syncAgent(tmpDir, { testCasesMd, rubricsMd });
  } catch (e) {
    threw = true;
    assert.ok(/scriptChecks\.js/.test(e.message) && /missing/.test(e.message), 'error must name the missing scriptChecks.js file: ' + e.message);
  }
  assert.ok(threw, 'sync must refuse to write when a script_diff rubric has no matching scriptChecks.js handler');
}

async function testSyncRejectsUnrecognizedExecutionMode() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-kit-md-badmode-'));
  copyExampleAgentInto(tmpDir);
  const { testCasesMd } = renderAgent(tmpDir);
  const rubricsMd = renderAgent(tmpDir).rubricsMd;
  const mangled = testCasesMd.replace('- **Execution Mode:** single-turn', '- **Execution Mode:** Single-Turn');
  assert.notStrictEqual(mangled, testCasesMd, 'the mangling replace must actually match something');

  let threw = false;
  try {
    syncAgent(tmpDir, { testCasesMd: mangled, rubricsMd });
  } catch (e) {
    threw = true;
    assert.ok(/unrecognized "Execution Mode"/.test(e.message), 'error must clearly name the bad executionMode value: ' + e.message);
  }
  assert.ok(threw, 'sync must reject an unrecognized Execution Mode value rather than silently misparsing the section');
}

async function main() {
  const tests = [
    testValidateAgentAcceptsTheExampleAgent,
    testValidateAgentRejectsMalformedTestCases,
    testRunSuitePassesBothExampleRubrics,
    testMarkdownSinkWritesTableAndSummary,
    testMarkdownSinkIncludesNotesColumnWhenOptedIn,
    testMarkdownSinkDefaultsToAFreshTimestampedFilePerRun,
    testMarkdownSinkResultsDirIsUsedAsIsWithNoSubfolderAppend,
    testMultiSinkFansOutToEverySink,
    testMultiSinkCloseIsBestEffortAcrossChildren,
    testMultiSinkWriteAndFinalizeIsolateAThrowingChild,
    testTraceResolverReceivesAgentNameAlongsideClientTraceId,
    testRunnerClosesResultsSinkEvenWhenFinalizeThrows,
    testRunnerSurvivesACloseThatAlsoThrows,
    testGateEnforcementLogic,
    testPreflightFailureIsReportedButRunContinues,
    testGetStatsReflectedInPersistenceSummary,
    testMdRoundTripForExampleAgent,
    testMdRoundTripForComplexFixture,
    testSyncRejectsMangledMarkdownAndWritesNothing,
    testCheckMdStalenessDetectsDriftAndClearsAfterSync,
    testCheckGateContentDriftFiresAndStaysSilent,
    testCheckMdStalenessDetectsHandEditedReviewMdBody,
    testPreflightThrowingDoesNotCrashRun,
    testPersistenceSummarySilentForPlainSink,
    testSyncRejectsScriptDiffRubricMissingHandler,
    testSyncRejectsUnrecognizedExecutionMode
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
