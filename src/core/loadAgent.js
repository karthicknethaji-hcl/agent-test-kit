// Loads one agent's folder: test-cases.json, rubrics.js, invoke-config.js
// (required), scriptChecks.js (optional — only needed if any rubric is
// script_diff-typed).
const path = require('path');

function loadAgent(agentDir) {
  let testCasesModule, rubricsConfig, invoke;
  try {
    testCasesModule = require(path.join(agentDir, 'test-cases.json'));
    rubricsConfig = require(path.join(agentDir, 'rubrics.js'));
    invoke = require(path.join(agentDir, 'invoke-config.js'));
  } catch (e) {
    throw new Error('Could not load agent from ' + agentDir + ': ' + e.message);
  }

  let scriptChecks = {};
  try {
    scriptChecks = require(path.join(agentDir, 'scriptChecks.js'));
  } catch (e) {
    // ENOENT (no file) is expected and fine for agents with no script_diff
    // rubrics; anything else (a real syntax/load error in an existing file)
    // should be visible, not swallowed.
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }

  return { testCasesModule, rubricsConfig, invoke, scriptChecks };
}

module.exports = { loadAgent };
