const path = require('path');
const { loadAgent } = require('../../core/loadAgent');
const { smokeTest } = require('../../core/smoke');

async function smokeCmd(config, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit smoke <agent-name>');
  const agentDir = path.join(config.agentsDir, agentName);
  const { invoke } = loadAgent(agentDir);
  const resultsSink = config.createResultsSink(agentName, {});

  console.log('[smoke] calling ' + invoke.agentName + '...');
  const outcome = await smokeTest({ invoke, resultsSink });
  if (outcome.pass) {
    console.log('[smoke] PASS' + (outcome.clientTraceId ? ' (clientTraceId: ' + outcome.clientTraceId + ')' : ''));
    console.log('[smoke] response: ' + outcome.rawText);
  } else {
    console.error('[smoke] FAIL — ' + outcome.reason);
    process.exitCode = 1;
  }
}

module.exports = { smokeCmd };
