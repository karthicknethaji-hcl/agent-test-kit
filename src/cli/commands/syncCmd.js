const path = require('path');
const { syncAgent } = require('../../core/mdAuthoring/sync');
const { loadReviewStatus, warnIfGateContentDrifted } = require('../../core/reviewStatus');
const { getAgentPaths } = require('../../core/agentPaths');

// Markdown -> JSON. All-or-nothing: on any validation error, syncAgent()
// throws before writing anything (see sync.js).
function syncCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit sync <agent-name>');
  const agentDir = path.join(agentsDir, agentName);
  const paths = getAgentPaths(agentDir);

  try {
    syncAgent(agentDir);
  } catch (e) {
    console.error('[sync] ' + e.message);
    return false;
  }

  console.log('[sync] wrote ' + paths.config.testCases + ' and ' + paths.config.rubrics);

  warnIfGateContentDrifted(agentDir, loadReviewStatus(agentDir));

  return true;
}

module.exports = { syncCmd };
