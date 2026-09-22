const path = require('path');
const { syncAgent } = require('../../core/mdAuthoring/sync');
const { loadReviewStatus, warnIfGateContentDrifted } = require('../../core/reviewStatus');

// Markdown -> JSON. All-or-nothing: on any validation error, syncAgent()
// throws before writing anything (see sync.js).
function syncCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit sync <agent-name>');
  const agentDir = path.join(agentsDir, agentName);

  try {
    syncAgent(agentDir);
  } catch (e) {
    console.error('[sync] ' + e.message);
    return false;
  }

  console.log('[sync] wrote ' + path.join(agentDir, 'test-cases.json') + ' and ' + path.join(agentDir, 'rubrics.js'));

  warnIfGateContentDrifted(agentDir, loadReviewStatus(agentDir));

  return true;
}

module.exports = { syncCmd };
