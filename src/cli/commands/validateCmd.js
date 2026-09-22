const path = require('path');
const { validateAgent } = require('../../core/validate');
const { loadReviewStatus, warnIfGateContentDrifted } = require('../../core/reviewStatus');

function validateCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit validate <agent-name>');
  const agentDir = path.join(agentsDir, agentName);
  const { valid, errors } = validateAgent(agentDir);

  warnIfGateContentDrifted(agentDir, loadReviewStatus(agentDir));

  if (valid) {
    console.log('[validate] ' + agentName + ': OK');
    return true;
  }
  console.error('[validate] ' + agentName + ': ' + errors.length + ' problem(s):');
  for (const e of errors) console.error('  - ' + e);
  return false;
}

module.exports = { validateCmd };
