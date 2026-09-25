# @karthicknethaji-hcl/agent-test-kit-example-json-file-mcp-server

The simplest possible reference implementation of agent-test-kit's MCP
results-sink server contract (`docs/CONTRACT.md` in the main
[agent-test-kit](https://github.com/karthicknethaji-hcl/agent-test-kit)
repo) — a single local JSON file, no database. Read `src/server.js`
top to bottom to see the whole contract in ~80 lines; copy it as a starting
point for any backend not covered by a dedicated reference server (Mongo, a
REST API, a spreadsheet, anything).

It's also the one reference server exercised by agent-test-kit's own
automated tests, since it needs no credentials or network access.

## Usage

```js
const { adapters } = require('@karthicknethaji-hcl/agent-test-kit');

module.exports = {
  createResultsSink: () => adapters.createMcpSink({
    command: 'npx',
    args: ['-y', '@karthicknethaji-hcl/agent-test-kit-example-json-file-mcp-server@0.1.0'],
    env: { AGENT_TEST_KIT_JSON_FILE: './agent-test-kit-results.json' }
  })
};
```

## Environment variables

| Variable | Required | Default |
|---|---|---|
| `AGENT_TEST_KIT_JSON_FILE` | No | `./agent-test-kit-results.json` (relative to the process's cwd) |
