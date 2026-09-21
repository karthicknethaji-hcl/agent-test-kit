const fs = require('fs');
const path = require('path');

// NOTE: these examples require the package by its real, scoped npm name
// (matching package.json's own "name" field) via its public `adapters`
// export (src/index.js) — NOT by the unscoped bin name "agent-test-kit"
// (that only works for the CLI executable, not for require()) and NOT by a
// deep adapters/... path (that skips src/index.js's stable public surface).
const CONFIG_TEMPLATE = `// agent-test-kit config — every field is optional; omit a field to use the
// zero-config default (see docs/ARCHITECTURE.md "Pluggable seams").
const { adapters } = require('@karthicknethaji-hcl/agent-test-kit');

module.exports = {
  agentsDir: 'test-suite/agents',

  // createJudgeClient() => async (promptText) => rawResponseText
  // Default: direct Anthropic API call using process.env.ANTHROPIC_API_KEY.
  // createJudgeClient: () => adapters.createAnthropicJudgeClient(),

  // createResultsSink() => { write(row), finalize(runSummary)? }
  // Default: append a human-readable Markdown report to .agent-test-kit-results.md.
  // createResultsSink: () => adapters.createMarkdownSink(),
  //
  // Other sinks ship in the box too — jsonFileSink (machine-readable NDJSON),
  // supabaseSink (writes to this package's OWN fixed table,
  // agent_test_kit_quality_scores — run sql/agent-test-kit-quality-scores-
  // migration.sql yourself once first; see docs/ARCHITECTURE.md for why the
  // schema is fixed rather than configurable), and multiSink to combine
  // more than one at once, e.g.:
  //   createResultsSink: () => adapters.createMultiSink([
  //     adapters.createMarkdownSink(),
  //     adapters.createSupabaseSink({
  //       supabaseUrl: process.env.SUPABASE_URL,
  //       supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  //     })
  //   ]),

  // createCredentialResolver() => { resolve(agentName, varNames) }
  // Default: plain env vars, <AGENT_NAME>_<VAR> naming.
  // createCredentialResolver: () => adapters.createEnvCredentialResolver(),

  // createTraceResolver() => { resolve(clientTraceId) => traceId }
  // Default: identity (clientTraceId IS the trace id).
  // createTraceResolver: () => adapters.createIdentityTraceResolver(),
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
