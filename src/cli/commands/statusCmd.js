const fs = require('fs');
const path = require('path');
const { loadReviewStatus } = require('../../core/reviewStatus');
const { validateAgent } = require('../../core/validate');

function statusCmd(agentsDir, agentName) {
  const names = agentName ? [agentName] : fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((n) => fs.statSync(path.join(agentsDir, n)).isDirectory())
    : [];

  if (!names.length) {
    console.log('No agents found under ' + agentsDir + '. Run `agent-test-kit add-agent <name>` first.');
    return;
  }

  for (const name of names) {
    const agentDir = path.join(agentsDir, name);
    const status = loadReviewStatus(agentDir);
    const { valid, errors } = validateAgent(agentDir);
    console.log(name + ':');
    console.log('  schema valid : ' + (valid ? 'yes' : 'no (' + errors.length + ' problem(s) — run `validate` for detail)'));
    console.log('  gate 1       : ' + (status.gate1.approved ? 'approved' : 'not approved'));
    console.log('  gate 2       : ' + (status.gate2.approved ? 'approved' : 'not approved'));
    console.log('  runnable     : ' + (valid && status.gate1.approved && status.gate2.approved ? 'yes' : 'no'));
  }
}

module.exports = { statusCmd };
