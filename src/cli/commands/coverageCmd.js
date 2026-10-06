const path = require('path');
const { writeCoverageReport } = require('../../core/coverage');

// Writes a timestamped <agent>/results/coverage-report-<ts>.md (skipped if the
// suite is unchanged since the latest report) and prints the open warnings.
function coverageCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit coverage <agent-name>');
  const { file, data, unchanged } = writeCoverageReport(path.join(agentsDir, agentName));
  console.log('[coverage] ' + (unchanged ? 'suite unchanged since latest report: ' : 'wrote ') + file);
  console.log('[coverage] ' + data.totalTests + ' test(s), ' + data.warnings.length + ' open warning(s)');
  for (const w of data.warnings) console.log('  - ' + w);
}

module.exports = { coverageCmd };
