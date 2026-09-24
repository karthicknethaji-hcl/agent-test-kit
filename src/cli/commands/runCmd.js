const path = require('path');
const { loadAgent } = require('../../core/loadAgent');
const { validateAgent } = require('../../core/validate');
const { loadReviewStatus, isFullyApproved, warnIfGateContentDrifted } = require('../../core/reviewStatus');
const { runSuite } = require('../../core/runner');

function describeSink(sink) {
  return typeof sink.describe === 'function' ? sink.describe() : 'results sink';
}

// preflight()/getStats() are optional resultsSink methods (see
// docs/CONTRACT.md). A single sink returns its result directly; multiSink
// fans out and returns one entry per child. Normalize both shapes into an
// array so the caller never needs to know which kind of sink it has.
//
// Both methods are documented as never throwing, but this is the last line
// of defense for a third-party sink that doesn't honor that — a failing
// preflight()/getStats() must never crash `run` (the whole point of this
// feature is making persistence problems visible without risking the run).
async function runPreflight(resultsSink) {
  if (typeof resultsSink.preflight !== 'function') return;
  let result;
  try {
    result = await resultsSink.preflight();
  } catch (e) {
    console.warn('[preflight] ' + describeSink(resultsSink) + ' threw instead of reporting a result: ' + e.message);
    return;
  }
  const entries = Array.isArray(result)
    ? result
    : [Object.assign({ describe: describeSink(resultsSink) }, result)];
  for (const entry of entries) {
    if (!entry.ok) {
      console.warn('[preflight] ' + entry.describe + ' is not reachable: ' + entry.reason);
    }
  }
}

// Only prints anything for a sink that actually has something to report
// (describe() and/or getStats()) — a sink with neither (e.g. consoleSink,
// which discards every row) must stay silent here, exactly as it was before
// this feature existed, rather than fabricating a placeholder line.
function printPersistenceSummary(resultsSink) {
  const hasDescribe = typeof resultsSink.describe === 'function';
  const hasStats = typeof resultsSink.getStats === 'function';
  if (!hasDescribe && !hasStats) return;

  let result = null;
  if (hasStats) {
    try {
      result = resultsSink.getStats();
    } catch (e) {
      console.warn('[persistence] ' + describeSink(resultsSink) + ' threw instead of reporting stats: ' + e.message);
      return;
    }
  }
  const entries = Array.isArray(result)
    ? result
    : [{ describe: describeSink(resultsSink), stats: result }];
  for (const entry of entries) {
    if (entry.stats) {
      const persisted = entry.stats.attempted - entry.stats.failed;
      console.log(
        entry.describe + ': ' + persisted + '/' + entry.stats.attempted + ' rows persisted' +
        (entry.stats.failed > 0 ? ' — ' + entry.stats.failed + ' failed (see warnings above)' : '')
      );
    } else {
      console.log(entry.describe);
    }
  }
}

async function runCmd(config, agentName, opts) {
  if (!agentName) throw new Error('Usage: agent-test-kit run <agent-name> [--only id1,id2] [--all] [--skip-gate-check] [--notes]');
  const agentDir = path.join(config.agentsDir, agentName);

  const { valid, errors } = validateAgent(agentDir);
  if (!valid) {
    console.error('[run] Refusing to run "' + agentName + '" — schema validation failed:');
    for (const e of errors) console.error('  - ' + e);
    console.error('Run `agent-test-kit validate ' + agentName + '` for detail.');
    process.exitCode = 1;
    return;
  }

  const status = loadReviewStatus(agentDir);
  if (!opts.skipGateCheck && !isFullyApproved(status)) {
    console.error('[run] Refusing to run "' + agentName + '" — both review gates must be approved first.');
    console.error('  gate 1 (product review)  : ' + (status.gate1.approved ? 'approved' : 'NOT approved'));
    console.error('  gate 2 (technical review) : ' + (status.gate2.approved ? 'approved' : 'NOT approved'));
    console.error('Approve both in ' + path.join(agentDir, 'review-status.json') + ' (normally done via the review skills), or pass --skip-gate-check for local iteration.');
    process.exitCode = 1;
    return;
  }

  warnIfGateContentDrifted(agentDir, status);

  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(agentDir);
  const callJudgeModel = config.createJudgeClient();
  const resultsSink = config.createResultsSink(agentName, { includeNotes: !!opts.notes });
  const traceResolver = config.createTraceResolver();

  await runPreflight(resultsSink);

  const { runId, results, totalFail, byCategory } = await runSuite({
    agentDir, invoke, testCasesModule, rubricsConfig, scriptChecks,
    callJudgeModel, resultsSink, traceResolver,
    only: opts.only, all: opts.all
  });

  console.log('\n─── Summary (run ' + runId + ') ───');
  for (const cat of Object.keys(byCategory).sort()) {
    console.log(cat + ': ' + byCategory[cat].pass + ' pass, ' + byCategory[cat].fail + ' fail');
  }
  console.log('\nTotal: ' + results.length + ' run, ' + (results.length - totalFail) + ' passed, ' + totalFail + ' failed.');
  printPersistenceSummary(resultsSink);

  process.exitCode = totalFail > 0 ? 1 : 0;
}

module.exports = { runCmd };
