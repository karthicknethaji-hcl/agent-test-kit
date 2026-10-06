const path = require('path');
const { validateAgent } = require('../../core/validate');
const { writeCoverageReport } = require('../../core/coverage');
const { loadReviewStatus, warnIfGateContentDrifted } = require('../../core/reviewStatus');

function validateCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit validate <agent-name>');
  const agentDir = path.join(agentsDir, agentName);
  const { valid, errors, warnings } = validateAgent(agentDir);

  warnIfGateContentDrifted(agentDir, loadReviewStatus(agentDir));

  if (valid && warnings && warnings.length) {
    console.warn('[validate] ' + agentName + ': ' + warnings.length + ' certification/coverage warning(s):');
    for (const w of warnings) console.warn('  - ' + w);
  }
  if (valid) {
    try {
      const { file, unchanged } = writeCoverageReport(agentDir);
      console.log('[validate] coverage report' + (unchanged ? ' (unchanged): ' : ': ') + file);
    } catch (e) {
      console.warn('[validate] could not write coverage report: ' + e.message);
    }
    console.log('[validate] ' + agentName + ': OK');
    return true;
  }
  console.error('[validate] ' + agentName + ': ' + errors.length + ' problem(s):');
  for (const e of errors) console.error('  - ' + e);
  return false;
}

module.exports = { validateCmd };
