// Loads one agent's folder: test-cases.json, rubrics.js, invoke-config.js
// (required), scriptChecks.js (optional — only needed if any rubric is
// script_diff-typed).
const path = require('path');
const { requireFresh } = require('./validate');

function loadAgent(agentDir) {
  let testCasesModule, rubricsConfig, invoke;
  try {
    // requireFresh (not a plain require()) — test-cases.json/rubrics.js can
    // be rewritten on disk by `agent-test-kit sync` within the same process
    // (this CLI's own process, or a long-lived programmatic API consumer);
    // a plain require() would keep returning whatever was first cached.
    testCasesModule = requireFresh(path.join(agentDir, 'test-cases.json'));
    rubricsConfig = requireFresh(path.join(agentDir, 'rubrics.js'));
    invoke = requireFresh(path.join(agentDir, 'invoke-config.js'));
  } catch (e) {
    throw new Error('Could not load agent from ' + agentDir + ': ' + e.message);
  }

  let scriptChecks = {};
  try {
    scriptChecks = requireFresh(path.join(agentDir, 'scriptChecks.js'));
  } catch (e) {
    // ENOENT (no file) is expected and fine for agents with no script_diff
    // rubrics; anything else (a real syntax/load error in an existing file)
    // should be visible, not swallowed.
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }

  return { testCasesModule, rubricsConfig, invoke, scriptChecks };
}

module.exports = { loadAgent };
