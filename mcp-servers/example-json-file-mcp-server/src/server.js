// The simplest possible reference implementation of agent-test-kit's MCP
// results-sink server contract (see agent-test-kit's docs/CONTRACT.md) — no
// database, just a single local JSON file holding an array of rows and a
// linear scan for query_results. Read this file top to bottom to understand
// the whole contract; it's the copy-paste starting point for any backend
// this repo doesn't ship a reference server for (Mongo, a REST API, a
// spreadsheet, anything).
const fs = require('fs');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');

const rowInputShape = {
  testId: z.string(),
  traceId: z.string().nullable().optional(),
  agentName: z.string(),
  category: z.string(),
  metric: z.string(),
  score: z.number().nullable().optional(),
  pass: z.boolean(),
  evaluator: z.string(),
  runId: z.string(),
  notes: z.any().nullable().optional(),
  recommendation: z.string().nullable().optional(),
  timestamp: z.string()
};

function ok() {
  return { content: [{ type: 'text', text: 'ok' }] };
}

function loadRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveRows(filePath, rows) {
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
}

function matchesFilter(row, filter) {
  if (filter.testId && row.testId !== filter.testId) return false;
  if (filter.agentName && row.agentName !== filter.agentName) return false;
  if (typeof filter.pass === 'boolean' && row.pass !== filter.pass) return false;
  if (filter.evaluator && row.evaluator !== filter.evaluator) return false;
  if (filter.runId && row.runId !== filter.runId) return false;
  if (filter.dateFrom && row.timestamp < filter.dateFrom) return false;
  if (filter.dateTo && row.timestamp > filter.dateTo) return false;
  return true;
}

function buildServer(options) {
  const opts = options || {};
  if (!opts.filePath) throw new Error('agent-test-kit-example-json-file-mcp-server: filePath is required.');
  const filePath = opts.filePath;

  const server = new McpServer({ name: 'agent-test-kit-example-json-file-mcp-server', version: '0.1.0' });

  server.registerTool(
    'store_result',
    { description: 'Append one agent-test-kit result row to the local JSON file.', inputSchema: rowInputShape },
    async (row) => {
      const rows = loadRows(filePath);
      rows.push(row);
      saveRows(filePath, rows);
      return ok();
    }
  );

  server.registerTool(
    'preflight',
    { description: 'Confirm the JSON file\'s directory is writable.', inputSchema: {} },
    async () => {
      saveRows(filePath, loadRows(filePath)); // round-trips the file — a cheap enough reachability probe here
      return ok();
    }
  );

  server.registerTool(
    'finalize',
    { description: 'No-op — this example has no run-level summary to render.', inputSchema: { runId: z.string(), agentName: z.string(), totalRun: z.number(), totalFail: z.number(), byCategory: z.any().optional() } },
    async () => ok()
  );

  server.registerTool(
    'query_results',
    {
      description: 'Linear-scan filter over the local JSON file, paginated by array offset.',
      inputSchema: {
        testId: z.string().optional(),
        agentName: z.string().optional(),
        pass: z.boolean().optional(),
        evaluator: z.string().optional(),
        runId: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional()
      },
      outputSchema: { rows: z.array(z.any()), nextCursor: z.string().optional() }
    },
    async (filter) => {
      const limit = Math.min(filter.limit || 100, 1000);
      // Opaque per the contract, but must still be a non-negative integer —
      // `parseInt(...) || 0` would silently swallow a malformed cursor (NaN)
      // and reset to page 1, and a raw negative value would make
      // Array.prototype.slice count from the end of the array instead of
      // erroring.
      let offset = 0;
      if (filter.cursor !== undefined) {
        offset = Number(filter.cursor);
        if (!Number.isInteger(offset) || offset < 0) {
          return { isError: true, content: [{ type: 'text', text: 'invalid cursor: "' + filter.cursor + '" is not a non-negative integer' }] };
        }
      }
      const matched = loadRows(filePath).filter((row) => matchesFilter(row, filter));
      const page = matched.slice(offset, offset + limit);
      const nextCursor = offset + limit < matched.length ? String(offset + limit) : undefined;
      const structuredContent = nextCursor ? { rows: page, nextCursor } : { rows: page };
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    }
  );

  return server;
}

module.exports = { buildServer };
