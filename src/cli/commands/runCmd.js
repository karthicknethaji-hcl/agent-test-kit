const path = require('path');
const { loadAgent } = require('../../core/loadAgent');
const { validateAgent } = require('../../core/validate');
const { loadReviewStatus, isFullyApproved } = require('../../core/reviewStatus');
const { runSuite } = require('../../core/runner');

async function runCmd(config, agentName, opts) {
  if (!agentName) throw new Error('Usage: agent-test-kit run <agent-name> [--only id1,id2] [--all] [--skip-gate-check]');
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

  const { testCasesModule, rubricsConfig, invoke, scriptChecks } = loadAgent(agentDir);
  const callJudgeModel = config.createJudgeClient();
  const resultsSink = config.createResultsSink();
  const traceResolver = config.createTraceResolver();

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
  if (typeof resultsSink.describe === 'function') console.log('Results written to: ' + resultsSink.describe());

  process.exitCode = totalFail > 0 ? 1 : 0;
}

module.exports = { runCmd };
