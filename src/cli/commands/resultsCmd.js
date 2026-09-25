// `agent-test-kit results <agent>` — retrieval, the counterpart to `run`'s
// write path. Only works when the configured resultsSink is (or contains) an
// mcpSink whose connected server advertises the optional query_results tool
// — see docs/CONTRACT.md "MCP results-sink server contract".
const { formatRowsAsTable } = require('../../core/formatRows');

// Recursively discovers query-capable sinks: a multiSink's own children are
// walked (one level at a time, however deep the nesting goes), so a
// multiSink containing another multiSink is still handled correctly — a
// shallow, one-level-only check would miss it. Capability (not just method
// presence) is checked via the async supportsQueryResults() predicate when a
// sink defines one (mcpSink does, since real support can only be known after
// connecting); a sink with `queryResults` but no such predicate is assumed
// always-supported.
//
// Uses Promise.allSettled, not Promise.all: one broken/unreachable sink
// inside a multiSink must never prevent a healthy sibling from being
// discovered as a candidate — mcpSink's own supportsQueryResults() already
// never throws, but this is defense-in-depth for any third-party sink that
// doesn't honor that.
async function resolveQuerySinks(sink) {
  if (typeof sink.getChildren === 'function') {
    const outcomes = await Promise.allSettled(sink.getChildren().map(resolveQuerySinks));
    const nested = [];
    outcomes.forEach((outcome) => {
      if (outcome.status === 'fulfilled') nested.push(...outcome.value);
      else console.warn('[results] a child sink failed capability discovery, skipping it: ' + outcome.reason.message);
    });
    return nested;
  }
  if (typeof sink.queryResults !== 'function') return [];
  if (typeof sink.supportsQueryResults === 'function') {
    const supported = await sink.supportsQueryResults();
    return supported ? [sink] : [];
  }
  return [sink];
}

function describeSink(sink) {
  return typeof sink.describe === 'function' ? sink.describe() : 'results sink';
}

function buildFilter(agentName, opts) {
  const filter = { agentName };
  if (opts.testId) filter.testId = opts.testId;
  if (opts.pass !== undefined) filter.pass = opts.pass;
  if (opts.evaluator) filter.evaluator = opts.evaluator;
  if (opts.runId) filter.runId = opts.runId;
  if (opts.from) filter.dateFrom = opts.from;
  if (opts.to) filter.dateTo = opts.to;
  if (opts.limit !== undefined) filter.limit = opts.limit;
  if (opts.cursor !== undefined) filter.cursor = opts.cursor;
  return filter;
}

async function resultsCmd(config, agentName, opts) {
  if (!agentName) throw new Error('Usage: agent-test-kit results <agent-name> [--pass true|false] [--from <date>] [--to <date>] [--test-id <id>] [--evaluator <name>] [--run-id <id>] [--limit <n>] [--cursor <token>] [--sink <n>]');

  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
    console.error('[results] --limit must be a positive integer.');
    process.exitCode = 1;
    return;
  }

  const sink = config.createResultsSink(agentName, {});
  // An mcpSink (or a multiSink wrapping one) holds a spawned child process
  // open until close() is called — without this try/finally the CLI process
  // would never exit after printing results. close() is best-effort and
  // never throws (see multiSink.js/mcpSink.js), so it's safe unconditionally.
  try {
    const candidates = await resolveQuerySinks(sink);

    if (candidates.length === 0) {
      console.error('[results] The configured resultsSink has no query-capable server — it must be (or contain) an mcpSink whose server implements query_results.');
      process.exitCode = 1;
      return;
    }

    let chosen;
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else if (opts.sink !== undefined) {
      if (!Number.isInteger(opts.sink) || opts.sink < 1 || opts.sink > candidates.length) {
        console.error('[results] --sink must be an integer between 1 and ' + candidates.length + '.');
        process.exitCode = 1;
        return;
      }
      chosen = candidates[opts.sink - 1];
    } else {
      console.error('[results] More than one query-capable sink is configured — pass --sink <n> to choose one:');
      candidates.forEach((c, i) => console.error('  [' + (i + 1) + '] ' + describeSink(c)));
      process.exitCode = 1;
      return;
    }

    const filter = buildFilter(agentName, opts);
    let response;
    try {
      response = await chosen.queryResults(filter);
    } catch (e) {
      console.error('[results] ' + e.message);
      process.exitCode = 1;
      return;
    }

    console.log(formatRowsAsTable(response.rows));
    console.log('\n' + response.rows.length + ' row(s).');
    if (response.nextCursor) {
      console.log('Next cursor: ' + response.nextCursor + ' — pass --cursor "' + response.nextCursor + '" to fetch the next page.');
    }
  } finally {
    if (typeof sink.close === 'function') await sink.close();
  }
}

module.exports = { resultsCmd, resolveQuerySinks };
