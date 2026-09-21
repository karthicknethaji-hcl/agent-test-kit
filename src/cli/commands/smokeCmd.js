const path = require('path');
const { loadAgent } = require('../../core/loadAgent');
const { smokeTest } = require('../../core/smoke');

async function smokeCmd(config, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit smoke <agent-name>');
  const agentDir = path.join(config.agentsDir, agentName);
  const { invoke } = loadAgent(agentDir);
  const resultsSink = config.createResultsSink();

  console.log('[smoke] calling ' + invoke.agentName + '...');
  const outcome = await smokeTest({ invoke, resultsSink });
  if (outcome.pass) {
    console.log('[smoke] PASS — got a non-empty response' + (outcome.clientTraceId ? ' (clientTraceId: ' + outcome.clientTraceId + ')' : ''));
  } else {
    console.error('[smoke] FAIL — ' + outcome.reason);
    process.exitCode = 1;
  }
}

module.exports = { smokeCmd };
