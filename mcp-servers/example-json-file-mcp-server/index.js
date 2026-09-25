#!/usr/bin/env node
// Entry point — spawned by agent-test-kit's mcpSink over stdio. Config is one
// env var: AGENT_TEST_KIT_JSON_FILE (path to the JSON file to read/write;
// created on first write if it doesn't exist).
const path = require('path');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { buildServer } = require('./src/server');

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('agent-test-kit-example-json-file-mcp-server — reads AGENT_TEST_KIT_JSON_FILE, then speaks MCP over stdio.');
    return;
  }

  const filePath = process.env.AGENT_TEST_KIT_JSON_FILE || path.join(process.cwd(), 'agent-test-kit-results.json');
  const server = buildServer({ filePath });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[agent-test-kit-example-json-file-mcp-server] Fatal:', err.message);
  process.exitCode = 1;
});
