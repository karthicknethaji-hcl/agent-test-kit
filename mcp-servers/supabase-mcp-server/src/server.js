// Reference implementation of agent-test-kit's MCP results-sink server
// contract (see agent-test-kit's docs/CONTRACT.md "MCP results-sink server
// contract"), backed by Supabase. This is deliberately opinionated, not a
// bring-your-own-table adapter: every repo that uses it writes to the same
// fixed table (`agent_test_kit_quality_scores`, schema in
// ../sql/agent-test-kit-quality-scores-migration.sql — run it yourself once;
// this server never executes SQL) with the same columns. That's the point:
// a fixed, universal schema is what makes it possible to build one
// dashboard/reporting tool against ANY repo using agent-test-kit, instead of
// every repo inventing its own table shape. Only the connection (which
// Supabase project) is ever repo-specific.
//
// query_results advertises an outputSchema and always returns
// structuredContent (never falls back to a text-JSON envelope) — per the
// contract, a tool that advertises an outputSchema is required by the MCP
// client SDK itself to return structured content, so this server picks that
// side of the fork deliberately.
const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');

const TABLE = 'agent_test_kit_quality_scores';
const MAX_QUERY_LIMIT = 1000;
const DEFAULT_QUERY_LIMIT = 100;

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

// `.nullable().optional()` (not just `.nullable()`) on every column that can
// legitimately be absent: a `null` DB value round-trips fine either way, but
// a column that's genuinely MISSING from a query result (schema drift, a
// custom view) comes back as `undefined`, which `.nullable()` alone rejects
// — failing the SDK's output-schema validation for the entire result set
// over one row's one field.
const rowOutputShape = z.object({
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
});

function toDbRow(row) {
  return {
    test_id: row.testId,
    trace_id: row.traceId ?? null,
    agent_name: row.agentName,
    category: row.category,
    metric: row.metric,
    score: row.score ?? null,
    pass: row.pass,
    evaluator: row.evaluator,
    run_id: row.runId,
    notes: row.notes ?? null,
    recommendation: row.recommendation ?? null,
    // The canonical row's `timestamp` (client-supplied, at persist time) is
    // preserved exactly as-is into this table's existing `created_at`
    // column, rather than letting the column's own `default now()` silently
    // substitute a different value — see docs/CONTRACT.md's "timestamp"
    // semantics.
    created_at: row.timestamp
  };
}

function fromDbRow(dbRow) {
  return {
    testId: dbRow.test_id,
    traceId: dbRow.trace_id,
    agentName: dbRow.agent_name,
    category: dbRow.category,
    metric: dbRow.metric,
    score: dbRow.score,
    pass: dbRow.pass,
    evaluator: dbRow.evaluator,
    runId: dbRow.run_id,
    notes: dbRow.notes,
    recommendation: dbRow.recommendation,
    timestamp: dbRow.created_at
  };
}

function ok(text) {
  return { content: [{ type: 'text', text: text || 'ok' }] };
}

function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function buildServer(options) {
  const opts = options || {};
  if (!opts.supabaseUrl || !opts.supabaseServiceRoleKey) {
    throw new Error('agent-test-kit-supabase-mcp-server: both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
  const table = opts.table || TABLE;
  const client = createClient(opts.supabaseUrl, opts.supabaseServiceRoleKey);

  const server = new McpServer({ name: 'agent-test-kit-supabase-mcp-server', version: '0.1.0' });

  server.registerTool(
    'store_result',
    { description: 'Persist one agent-test-kit result row.', inputSchema: rowInputShape },
    async (row) => {
      const { error } = await client.from(table).insert(toDbRow(row));
      if (error) return errorResult(error.message);
      return ok();
    }
  );

  server.registerTool(
    'preflight',
    { description: 'Cheap reachability probe for the configured Supabase table.', inputSchema: {} },
    async () => {
      const { error } = await client.from(table).select('id').limit(1);
      if (error) return errorResult(error.message);
      return ok();
    }
  );

  server.registerTool(
    'finalize',
    {
      description: 'Optional whole-run summary hook — a no-op here, since this table has no run-level row.',
      inputSchema: { runId: z.string(), agentName: z.string(), totalRun: z.number(), totalFail: z.number(), byCategory: z.any().optional() }
    },
    async () => ok()
  );

  server.registerTool(
    'query_results',
    {
      description: 'Query persisted result rows by testId/agentName/pass/evaluator/runId/date range, paginated.',
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
      outputSchema: { rows: z.array(rowOutputShape), nextCursor: z.string().optional() }
    },
    async (filter) => {
      const limit = Math.min(filter.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
      // Opaque per the contract, but must still be a non-negative integer to
      // be usable as a range offset — `parseInt(...) || 0` would silently
      // swallow a malformed/corrupted cursor (NaN) and reset to page 1
      // instead of telling the caller their cursor was bad.
      let offset = 0;
      if (filter.cursor !== undefined) {
        offset = Number(filter.cursor);
        if (!Number.isInteger(offset) || offset < 0) {
          return errorResult('invalid cursor: "' + filter.cursor + '" is not a non-negative integer');
        }
      }

      // Fetch one extra row beyond `limit` so "is there a next page" is
      // known from the real result set, not inferred from "did this page
      // come back full" — that heuristic reports a phantom extra page
      // whenever the true total is an exact multiple of `limit`.
      let q = client.from(table).select('*').order('created_at', { ascending: true }).range(offset, offset + limit);
      if (filter.testId) q = q.eq('test_id', filter.testId);
      if (filter.agentName) q = q.eq('agent_name', filter.agentName);
      if (typeof filter.pass === 'boolean') q = q.eq('pass', filter.pass);
      if (filter.evaluator) q = q.eq('evaluator', filter.evaluator);
      if (filter.runId) q = q.eq('run_id', filter.runId);
      if (filter.dateFrom) q = q.gte('created_at', filter.dateFrom);
      if (filter.dateTo) q = q.lte('created_at', filter.dateTo);

      const { data, error } = await q;
      if (error) return errorResult(error.message);

      const hasMore = data.length > limit;
      const rows = data.slice(0, limit).map(fromDbRow);
      const nextCursor = hasMore ? String(offset + limit) : undefined;
      const structuredContent = nextCursor ? { rows, nextCursor } : { rows };
      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    }
  );

  return server;
}

module.exports = { buildServer, TABLE, toDbRow, fromDbRow };
