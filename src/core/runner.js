// Agent Test Kit — generic runner. Dispatches by executionMode so no
// per-agent runner code is ever needed; contains ZERO references to any
// specific agent. Every judge call, credential lookup, trace resolution, and
// result write goes through an injected adapter (see docs/CONTRACT.md) —
// this file owns only the orchestration and the canonical result-row shape.
const crypto = require('crypto');
const { evaluate } = require('./evaluator');

async function runSingleTurn(invoke, testCase) {
  const state = invoke.createConversationState();
  const callResult = await invoke.sendMessage(state, testCase.probe);
  return { callResult, context: {} };
}

async function runMultiTurn(invoke, testCase) {
  const state = invoke.createConversationState();
  for (const step of testCase.setup || []) {
    await invoke.sendMessage(state, step);
  }
  const draftBefore = Object.assign({}, state.draft);
  const callResult = await invoke.sendMessage(state, testCase.probe);
  const draftAfter = Object.assign({}, state.draft);
  return { callResult, context: { draftBefore, draftAfter } };
}

async function runDualConversation(invoke, testCase) {
  const stateA = invoke.createConversationState();
  for (const step of testCase.conversationA.setup || []) await invoke.sendMessage(stateA, step);
  const resultA = await invoke.sendMessage(stateA, testCase.conversationA.probe);

  const stateB = invoke.createConversationState();
  for (const step of testCase.conversationB.setup || []) await invoke.sendMessage(stateB, step);
  const resultB = await invoke.sendMessage(stateB, testCase.conversationB.probe);

  return { callResult: resultA, context: { conversationB: resultB } };
}

/**
 * runSuite(options) -> { runId, results: [{testCase, outcome}], totalFail }
 *
 * options:
 *   agentDir       : path the agent's files were loaded from (for logging only)
 *   invoke         : agent's invoke-config.js module
 *   testCasesModule: agent's test-cases.json contents
 *   rubricsConfig  : agent's rubrics.js module
 *   scriptChecks   : agent's scriptChecks.js module (or {})
 *   callJudgeModel : async (promptText) => rawResponseText
 *   resultsSink    : { write(row), finalize(runSummary)? } — see docs/CONTRACT.md
 *                    "Result row schema" / "resultsSink lifecycle"
 *   traceResolver  : { resolve(clientTraceId) => traceId|null }
 *   only           : string[] test ids to run regardless of v1Scope
 *   all            : boolean — also run v1Scope:false cases
 *   onProgress     : (line: string) => void — defaults to console.log
 */
async function runSuite(options) {
  const {
    invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel, resultsSink, traceResolver,
    only, all
  } = options;
  const log = options.onProgress || ((line) => console.log(line));

  const runId = crypto.randomUUID();
  let cases = testCasesModule.testCases;
  if (only) cases = cases.filter((c) => only.includes(c.testId));
  else if (!all) cases = cases.filter((c) => c.v1Scope);

  log('Agent Test Kit — run ' + runId);
  log('Agent: ' + invoke.agentName + ' — ' + cases.length + ' case(s) selected');

  const results = [];
  const capturedOutputs = [];
  const backgroundScanCases = [];

  async function persist(agentName, testCase, outcome, clientTraceId) {
    if (!resultsSink) return;
    // agentName is passed alongside clientTraceId (not just the id alone) so
    // a real resolver can scope its lookup correctly, e.g. mt_ai_traces'
    // real query shape is .eq('client_trace_id', ...).eq('agent_name', ...)
    // — a client_trace_id alone isn't guaranteed unique across agents.
    const traceId = traceResolver ? await traceResolver.resolve(clientTraceId, agentName) : (clientTraceId || null);
    const rubricMeta = rubricsConfig && rubricsConfig[testCase.rubric];
    // Canonical result row — every sink receives exactly this shape, see
    // docs/CONTRACT.md "Result row schema". Sinks differ only in WHERE this
    // gets written, never in what fields exist.
    await resultsSink.write({
      testId: testCase.testId,
      traceId,
      agentName,
      category: testCase.category,
      metric: (rubricMeta && rubricMeta.metric) || testCase.rubric,
      score: outcome.score,
      pass: outcome.pass,
      evaluator: outcome.evaluator,
      runId,
      notes: outcome.notes || null,
      recommendation: outcome.recommendation || null,
      timestamp: new Date().toISOString()
    });
  }

  for (const testCase of cases) {
    if (testCase.executionMode === 'background-scan') {
      backgroundScanCases.push(testCase);
      continue;
    }
    if (testCase.executionMode === 'repeat-n') {
      log('[' + testCase.testId + '] SKIPPED — repeat-n execution mode is reserved, not implemented.');
      continue;
    }

    log('[' + testCase.testId + '] running...');
    try {
      let run;
      if (testCase.executionMode === 'single-turn') run = await runSingleTurn(invoke, testCase);
      else if (testCase.executionMode === 'multi-turn') run = await runMultiTurn(invoke, testCase);
      else if (testCase.executionMode === 'dual-conversation') run = await runDualConversation(invoke, testCase);
      else throw new Error('Unrecognized executionMode: ' + testCase.executionMode);

      const outcome = await evaluate(testCase, rubricsConfig, run.callResult, run.context, callJudgeModel, scriptChecks);
      results.push({ testCase, outcome });
      capturedOutputs.push({ testId: testCase.testId, text: run.callResult.rawText });
      if (run.context && run.context.conversationB) {
        capturedOutputs.push({ testId: testCase.testId + ':conversationB', text: run.context.conversationB.rawText });
      }
      const traceIdForRow = (run.context && run.context.conversationB && run.context.conversationB.clientTraceId) || run.callResult.clientTraceId;
      await persist(invoke.agentName, testCase, outcome, traceIdForRow);
      log('[' + testCase.testId + '] ' + (outcome.pass ? 'PASS' : 'FAIL'));
    } catch (err) {
      log('[' + testCase.testId + '] ERROR — ' + err.message);
      const outcome = { pass: false, score: null, evaluator: 'error', notes: { error: err.message }, recommendation: null };
      results.push({ testCase, outcome });
      // A thrown invocation (e.g. an auth error) never reached persist()
      // above, so without this an errored case would silently vanish from
      // every resultsSink (Markdown, JSON file, MCP/DB alike) despite still
      // being counted in the printed pass/fail summary — no clientTraceId
      // exists to resolve since invoke never returned one.
      await persist(invoke.agentName, testCase, outcome, null);
    }
  }

  for (const scanCase of backgroundScanCases) {
    log('[' + scanCase.testId + '] running...');
    try {
      const outcome = await evaluate(scanCase, rubricsConfig, { rawText: '' }, { allCapturedOutputs: capturedOutputs }, callJudgeModel, scriptChecks);
      results.push({ testCase: scanCase, outcome });
      await persist(invoke.agentName, scanCase, outcome, null);
      log('[' + scanCase.testId + '] ' + (outcome.pass ? 'PASS' : 'FAIL'));
    } catch (err) {
      log('[' + scanCase.testId + '] ERROR — ' + err.message);
      const outcome = { pass: false, score: null, evaluator: 'error', notes: { error: err.message }, recommendation: null };
      results.push({ testCase: scanCase, outcome });
      await persist(invoke.agentName, scanCase, outcome, null);
    }
  }

  const totalFail = results.filter((r) => !r.outcome.pass).length;

  const byCategory = {};
  for (const { testCase, outcome } of results) {
    const cat = testCase.category;
    byCategory[cat] = byCategory[cat] || { pass: 0, fail: 0 };
    if (outcome.pass) byCategory[cat].pass++; else byCategory[cat].fail++;
  }

  // Optional lifecycle hook — called once, after every row for this run has
  // already gone through resultsSink.write(). A sink that only needs
  // per-row writes (jsonFileSink, mcpSink without a run-summary tool) simply
  // won't define this; one that needs to render a whole-run summary
  // (markdownSink) does.
  //
  // Both finalize() and the optional close() (process/transport teardown —
  // see mcpSink.js) are wrapped in their own try/catch: a persistence-hook
  // failure must never fail an otherwise-complete run, and a close() failure
  // must never escape the finally block and mask that finalize() already
  // completed (or already warned) — each is isolated independently.
  if (resultsSink) {
    try {
      if (typeof resultsSink.finalize === 'function') {
        await resultsSink.finalize({ runId, agentName: invoke.agentName, totalRun: results.length, totalFail, byCategory });
      }
    } catch (err) {
      console.warn('[runner] resultsSink.finalize failed: ' + err.message);
    } finally {
      if (typeof resultsSink.close === 'function') {
        try {
          await resultsSink.close();
        } catch (err) {
          console.warn('[runner] resultsSink.close failed: ' + err.message);
        }
      }
    }
  }

  return { runId, results, totalFail, byCategory };
}

module.exports = { runSuite };
