// The generic, vendor-neutral results sink. Persists to ANY local MCP server
// (spawned over stdio) that implements the tool contract in docs/CONTRACT.md
// "MCP results-sink server contract" — this file has zero knowledge of
// Supabase, Postgres, or any other specific backend. Two reference servers
// (Supabase-backed, a minimal JSON-file example) live under mcp-servers/.
//
// Contract recap: only `store_result` is mandatory. `preflight`, `finalize`,
// and `query_results` are optional — a server advertises which of them it
// implements via listTools(), and this sink feature-detects accordingly
// (mirrors the package's existing philosophy that most resultsSink hooks
// beyond write() are optional).
//
// Transport is a seam, not baked in: v1 supports stdio only (a locally
// spawned child process), but options are normalized into an explicit
// `{ transport: { type, ... } }` shape internally so a future
// `{ type: 'streamable-http', url }` can be added without redesigning this
// sink. Remote/shared MCP servers are deliberately out of scope for v1.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const { version: PACKAGE_VERSION } = require('../../../package.json');

function normalizeTransport(opts) {
  if (opts.transport) return opts.transport;
  if (!opts.command) throw new Error('mcpSink: options.command (or options.transport) is required.');
  return { type: 'stdio', command: opts.command, args: opts.args, env: opts.env };
}

function extractErrorText(result) {
  const block = (result.content || []).find((b) => b.type === 'text');
  return block ? block.text : 'unknown MCP tool error';
}

// Parsing order per docs/CONTRACT.md: isError -> structuredContent.rows ->
// text-JSON {rows} envelope -> explicit malformed-response error. Never a
// bare `JSON.parse(content[0].text)` assumed to be an array — that couldn't
// tell an envelope from a raw array, and threw a cryptic error on failure.
function parseQueryResultsResponse(result) {
  if (result.isError) throw new Error('mcpSink: query_results failed: ' + extractErrorText(result));
  if (result.structuredContent && Array.isArray(result.structuredContent.rows)) {
    return { rows: result.structuredContent.rows, nextCursor: result.structuredContent.nextCursor };
  }
  const block = (result.content || []).find((b) => b.type === 'text');
  if (block) {
    try {
      const parsed = JSON.parse(block.text);
      if (parsed && Array.isArray(parsed.rows)) return { rows: parsed.rows, nextCursor: parsed.nextCursor };
    } catch (e) {
      // falls through to the malformed-response error below
    }
  }
  throw new Error('mcpSink: malformed query_results response — expected structuredContent.rows or a text-JSON {rows:[...]} envelope.');
}

function createMcpSink(options) {
  const opts = options || {};
  const transport = normalizeTransport(opts);
  if (transport.type !== 'stdio') {
    throw new Error('mcpSink: only transport.type "stdio" is supported in this release (got "' + transport.type + '").');
  }

  let client = null;
  let connecting = null;
  let capabilities = null; // { preflight, finalize, query_results } — filled in on first connect
  let attempted = 0;
  let failed = 0;

  async function listAllTools(c) {
    const tools = [];
    let cursor;
    do {
      const page = await c.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async function ensureConnected() {
    if (client) return client;
    if (!connecting) {
      connecting = (async () => {
        const t = new StdioClientTransport({
          command: transport.command,
          args: transport.args || [],
          env: Object.assign({}, process.env, transport.env || {})
        });
        const c = new Client({ name: 'agent-test-kit', version: PACKAGE_VERSION }, { capabilities: {} });
        try {
          await c.connect(t);

          const tools = await listAllTools(c);
          const names = new Set(tools.map((tool) => tool.name));
          if (!names.has('store_result')) {
            throw new Error('mcpSink: connected MCP server does not implement the required "store_result" tool.');
          }
          capabilities = {
            preflight: names.has('preflight'),
            finalize: names.has('finalize'),
            query_results: names.has('query_results')
          };
        } catch (e) {
          // Never leave the spawned child process orphaned just because a
          // post-connect step (capability discovery) failed after connect()
          // itself succeeded — close() below never runs for this attempt
          // since `client` is never assigned on the throwing path.
          await c.close().catch(() => {});
          throw e;
        }
        client = c;
        return c;
      })().catch((e) => {
        // A rejected `connecting` is still truthy, so without this reset the
        // sink would replay the same stale rejection forever — clear it so
        // the NEXT call gets a fresh connection attempt instead of being
        // permanently poisoned by one transient failure.
        connecting = null;
        throw e;
      });
    }
    return connecting;
  }

  const sink = {
    describe() {
      return "MCP server '" + transport.command + ' ' + (transport.args || []).join(' ') + "'";
    },

    async preflight() {
      try {
        const c = await ensureConnected();
        if (!capabilities.preflight) return { ok: true, skipped: true };
        const result = await c.callTool({ name: 'preflight', arguments: {} });
        if (result.isError) return { ok: false, reason: extractErrorText(result) };
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },

    async write(row) {
      attempted++;
      try {
        const c = await ensureConnected();
        const result = await c.callTool({ name: 'store_result', arguments: row });
        if (result.isError) {
          failed++;
          console.warn('[mcpSink] store_result failed for ' + row.testId + ': ' + extractErrorText(result));
        }
      } catch (e) {
        failed++;
        console.warn('[mcpSink] store_result threw for ' + row.testId + ': ' + e.message);
      }
    },

    // Warn-only, never throws — persistence-hook failures must never fail an
    // otherwise-complete test run. Process teardown is a SEPARATE method
    // (close(), below), not folded into finalize(), so a finalize failure can
    // never skip cleanup and a cleanup failure can never masquerade as a
    // finalize failure.
    async finalize(runSummary) {
      try {
        const c = await ensureConnected();
        if (!capabilities.finalize) return;
        const result = await c.callTool({ name: 'finalize', arguments: runSummary });
        if (result.isError) console.warn('[mcpSink] finalize failed: ' + extractErrorText(result));
      } catch (e) {
        console.warn('[mcpSink] finalize threw: ' + e.message);
      }
    },

    // Idempotent, best-effort, never throws — tears down the spawned child
    // process. Safe to call more than once (a second call is a no-op, since
    // `client` is nulled out below). Nulling `client`/`connecting` (rather
    // than a separate sticky `closed` flag) also means a sink reused after
    // close() reconnects fresh instead of silently talking to a dead
    // transport, AND still closes correctly the next time around.
    async close() {
      if (!client) return;
      const c = client;
      client = null;
      connecting = null;
      try {
        await c.close();
      } catch (e) {
        console.warn('[mcpSink] close() failed: ' + e.message);
      }
    },

    getStats() {
      return { attempted, failed };
    }
  };

  // Whether the connected server actually advertises query_results can only
  // be known after connecting (capability discovery happens on connect), so
  // it can't be answered by a synchronous `typeof sink.queryResults ===
  // 'function'` check the way other optional sink hooks are. `resultsCmd.js`
  // (see resolveQuerySinks()) calls this async predicate instead, before
  // deciding whether this sink is a query candidate — `queryResults` itself
  // is always present as a method, but throws a clear error if called
  // without checking support first.
  //
  // Never throws — matches every other optional-hook method on this sink
  // (preflight/finalize). A connection failure here means "can't confirm
  // this sink is a usable query candidate," which is functionally the same
  // as "not supported" for a discovery predicate — the caller can still
  // learn about the underlying connection problem via preflight()/write().
  sink.supportsQueryResults = async function supportsQueryResults() {
    try {
      await ensureConnected();
      return capabilities.query_results;
    } catch (e) {
      return false;
    }
  };

  sink.queryResults = async function queryResults(filter) {
    const c = await ensureConnected();
    if (!capabilities.query_results) {
      throw new Error('mcpSink: connected MCP server does not implement the optional "query_results" tool.');
    }
    const result = await c.callTool({ name: 'query_results', arguments: filter || {} });
    return parseQueryResultsResponse(result);
  };

  return sink;
}

module.exports = { createMcpSink };
