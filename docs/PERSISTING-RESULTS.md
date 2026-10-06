# Persisting results to a database (MCP)

By default `agent-test-kit run` writes a local Markdown report under the
agent's `results/` folder. To persist results somewhere shared and queryable,
the app team edits one file, `agent-test-kit.config.js`. The kit spawns an MCP
server as a child process and calls its `store_result` tool once per test case.
The kit has no built-in database.

The server-side tool contract is in `CONTRACT.md` ("MCP results-sink server
contract"); this page is the app team's how-to.

## Steps

1. **Pick a persistence server.**
   - Supabase: `mcp-servers/supabase-mcp-server`
     (`@karthicknethaji-hcl/agent-test-kit-supabase-mcp-server`).
   - JSON file: `mcp-servers/example-json-file-mcp-server`, for local or demo
     use. Needs no credentials.
   - Another backend (Postgres, Mongo, a REST API, a spreadsheet): write a
     small MCP server that implements the contract. Copy the JSON-file
     server's `src/server.js` (about 80 lines).
2. **Do one-time backend setup.** For Supabase, someone runs
   `mcp-servers/supabase-mcp-server/sql/agent-test-kit-quality-scores-migration.sql`
   against their own project. The server never runs SQL itself. The table is
   `agent_test_kit_quality_scores` by default, or the value of
   `SUPABASE_RESULTS_TABLE` if set.
3. **Wire it in `agent-test-kit.config.js`** (scaffolded at the repo root by
   `npx agent-test-kit init`):

   ```js
   const { adapters } = require('@karthicknethaji-hcl/agent-test-kit');

   module.exports = {
     createResultsSink: () => adapters.createMcpSink({
       command: 'npx',
       args: ['-y', '@karthicknethaji-hcl/agent-test-kit-supabase-mcp-server@0.1.0'],
       env: {
         SUPABASE_URL: process.env.SUPABASE_URL,
         SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
       }
     })
   };
   ```
4. **Provide credentials through the environment** (`SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` here). Don't hardcode them.
5. **Run as normal:** `npx agent-test-kit run <agent>` after both review gates
   are approved. Once you override `createResultsSink`, rows go to your server
   instead of the Markdown report. To keep both, combine them:

   ```js
   createResultsSink: () => adapters.createMultiSink([
     adapters.createMarkdownSink(),
     adapters.createMcpSink({ /* as above */ })
   ])
   ```

## What happens at run time

- Before any test case runs, `preflight()` checks reachability, if your server
  implements the optional `preflight` tool.
- Each case calls `store_result` with `{testId, traceId, agentName, category,
  metric, score, pass, evaluator, runId, notes, recommendation, timestamp}`.
- At the end, the optional `finalize` tool gets `{runId, agentName, totalRun,
  totalFail, byCategory}`, and the child process is closed.
- Write failures only warn and are counted. They never fail the run; the CLI
  prints persisted and failed counts at the end.
- Delivery is at-least-once, with no retries. For dedupe, use
  `(runId, testId)` as the key.

## Reading results back

If the server also implements the optional `query_results` tool:

```
npx agent-test-kit results my-agent --pass false --from 2026-01-01 --limit 20
```

## Limits

- Only stdio transport works today. The server must be a local process the kit
  can spawn; remote or shared MCP servers aren't supported yet.
- The row schema is fixed. Your server maps it to storage, but you can't add
  fields.
