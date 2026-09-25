// Loads one agent's folder: config/test-cases.json, config/rubrics.js,
// config/invoke-config.js (required), config/scriptChecks.js (optional —
// only needed if any rubric is script_diff-typed).
const { requireFresh } = require('./validate');
const { getAgentPaths } = require('./agentPaths');

function loadAgent(agentDir) {
  const paths = getAgentPaths(agentDir);
  let testCasesModule, rubricsConfig, invoke;
  try {
    // requireFresh (not a plain require()) — config/test-cases.json/rubrics.js
    // can be rewritten on disk by `agent-test-kit sync` within the same
    // process (this CLI's own process, or a long-lived programmatic API
    // consumer); a plain require() would keep returning whatever was first
    // cached.
    testCasesModule = requireFresh(paths.config.testCases);
    rubricsConfig = requireFresh(paths.config.rubrics);
    invoke = requireFresh(paths.config.invokeConfig);
  } catch (e) {
    throw new Error('Could not load agent from ' + agentDir + ': ' + e.message);
  }

  let scriptChecks = {};
  try {
    scriptChecks = requireFresh(paths.config.scriptChecks);
  } catch (e) {
    // ENOENT (no file) is expected and fine for agents with no script_diff
    // rubrics; anything else (a real syntax/load error in an existing file)
    // should be visible, not swallowed.
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }

  return { testCasesModule, rubricsConfig, invoke, scriptChecks };
}

module.exports = { loadAgent };
