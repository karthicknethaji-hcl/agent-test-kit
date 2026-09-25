#!/usr/bin/env node
// Entry point — spawned by agent-test-kit's mcpSink over stdio (see
// createMcpSink() in agent-test-kit's src/adapters/resultsSinks/mcpSink.js).
// Config comes entirely from env vars, since that's what a stdio transport's
// `env` option passes through: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (both required), SUPABASE_RESULTS_TABLE (optional, defaults to
// agent_test_kit_quality_scores).
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { buildServer } = require('./src/server');

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('agent-test-kit-supabase-mcp-server — reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional SUPABASE_RESULTS_TABLE, then speaks MCP over stdio.');
    return;
  }

  const server = buildServer({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    table: process.env.SUPABASE_RESULTS_TABLE
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[agent-test-kit-supabase-mcp-server] Fatal:', err.message);
  process.exitCode = 1;
});
