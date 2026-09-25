# @karthicknethaji-hcl/agent-test-kit-supabase-mcp-server

A reference MCP server that persists [agent-test-kit](https://github.com/karthicknethaji-hcl/agent-test-kit)
results to Supabase. It implements the MCP results-sink server contract
documented in agent-test-kit's `docs/CONTRACT.md` — `store_result` (required)
plus `preflight`, `finalize`, and `query_results` (all optional, all
implemented here).

This package is **not** a dependency of `agent-test-kit` itself and carries
no special status over any other MCP persistence server — it's one reference
implementation of the contract, published separately so existing Supabase
users have a drop-in path.

## Setup

1. Run the migration once, yourself, against your own Supabase/Postgres
   project: `sql/agent-test-kit-quality-scores-migration.sql`. This server
   never executes SQL on your behalf.
2. In your `agent-test-kit.config.js`:

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

## Environment variables

| Variable | Required | Default |
|---|---|---|
| `SUPABASE_URL` | Yes | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — |
| `SUPABASE_RESULTS_TABLE` | No | `agent_test_kit_quality_scores` |

## Schema

Fixed on purpose — see `sql/agent-test-kit-quality-scores-migration.sql` and
`src/server.js`'s header comment for why every adopting repo shares the same
table shape.

## Manual verification checklist

No credentials are available in CI for this package, so verify by hand
before publishing a new version:

1. Run the migration against a scratch Supabase project.
2. `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node index.js` and confirm
   it starts without error (it will sit waiting on stdin — that's expected
   for a stdio MCP server).
3. Point a real `agent-test-kit.config.js` at it via `createMcpSink`, run
   `agent-test-kit run <agent>`, and confirm rows land in the table.
4. Run `agent-test-kit results <agent>` against it and confirm filtering and
   pagination (`--limit`, `--cursor`) work as expected.
