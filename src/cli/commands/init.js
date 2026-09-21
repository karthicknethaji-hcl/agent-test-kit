const fs = require('fs');
const path = require('path');

const CONFIG_TEMPLATE = `// agent-test-kit config — every field is optional; omit a field to use the
// zero-config default (see docs/ARCHITECTURE.md "Pluggable seams").
module.exports = {
  agentsDir: 'test-suite/agents',

  // createJudgeClient() => async (promptText) => rawResponseText
  // Default: direct Anthropic API call using process.env.ANTHROPIC_API_KEY.
  // createJudgeClient: () => require('agent-test-kit/adapters/judgeClients/anthropicJudgeClient').createAnthropicJudgeClient(),

  // createResultsSink() => { write(row) }
  // Default: append NDJSON rows to .agent-test-kit-results.ndjson.
  // createResultsSink: () => require('agent-test-kit/adapters/resultsSinks/jsonFileSink').createJsonFileSink(),

  // createCredentialResolver() => { resolve(agentName, varNames) }
  // Default: plain env vars, <AGENT_NAME>_<VAR> naming.
  // createCredentialResolver: () => require('agent-test-kit/adapters/credentialResolvers/envCredentialResolver').createEnvCredentialResolver(),

  // createTraceResolver() => { resolve(clientTraceId) => traceId }
  // Default: identity (clientTraceId IS the trace id).
  // createTraceResolver: () => require('agent-test-kit/adapters/traceResolvers/identityTraceResolver').createIdentityTraceResolver(),
};
`;

function init(cwd, options) {
  const configPath = path.join(cwd, 'agent-test-kit.config.js');
  if (fs.existsSync(configPath) && !options.force) {
    console.log('agent-test-kit.config.js already exists — skipping (pass --force to overwrite).');
  } else {
    fs.writeFileSync(configPath, CONFIG_TEMPLATE, 'utf8');
    console.log('Created ' + configPath);
  }

  const agentsDir = path.join(cwd, 'test-suite', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  console.log('Ensured ' + agentsDir + ' exists.');
  console.log('\nNext: npx agent-test-kit add-agent <name>');
}

module.exports = { init };
