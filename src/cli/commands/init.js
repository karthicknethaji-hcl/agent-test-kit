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

  // createResultsSink(agentName) => { write(row), finalize(runSummary)? }
  // Default: a fresh, timestamped Markdown report per run, under this
  // agent's own test-suite/agents/<name>/results/ folder (e.g.
  // run-2026-09-22T14-05-33-123Z.md) — never overwritten or silently
  // appended to by a later run. Pass an explicit filePath to opt back into
  // one single file every run appends to instead:
  // createResultsSink: () => adapters.createMarkdownSink({ filePath: '...' }),
  //
  // Other sinks ship in the box too — jsonFileSink (machine-readable NDJSON),
  // mcpSink (persists via ANY local MCP server implementing the contract in
  // docs/CONTRACT.md "MCP results-sink server contract" — no specific
  // database is built into this package; see mcp-servers/ in this package's
  // own repo for reference servers, e.g. a Supabase-backed one), and
  // multiSink to combine more than one at once, e.g.:
  //   createResultsSink: () => adapters.createMultiSink([
  //     adapters.createMarkdownSink(),
  //     adapters.createMcpSink({
  //       command: 'npx',
  //       args: ['-y', '@karthicknethaji-hcl/agent-test-kit-supabase-mcp-server@0.1.0'],
  //       env: {
  //         SUPABASE_URL: process.env.SUPABASE_URL,
  //         SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  //       }
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

  // Every agent's own results/ folder (see docs/CONTRACT.md "Per-agent
  // folder layout") holds generated run output, and `migrate-layout` drops a
  // timestamped backup snapshot at the repo root before it moves anything —
  // without ignore rules for both, a consuming repo would git-track every
  // timestamped report and every migration backup by default.
  const gitignorePath = path.join(cwd, '.gitignore');
  const ignoreLines = ['test-suite/agents/*/results/', '.agent-test-kit-migration-backup-*/'];
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const existingLines = existing.split(/\r?\n/);
  const missingLines = ignoreLines.filter((line) => !existingLines.includes(line));
  if (missingLines.length > 0) {
    fs.writeFileSync(gitignorePath, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + missingLines.join('\n') + '\n', 'utf8');
    console.log('Added ' + missingLines.map((l) => '"' + l + '"').join(', ') + ' to ' + gitignorePath + '.');
  }
  console.log('\nNext: npx agent-test-kit add-agent <name>');
}

module.exports = { init };
