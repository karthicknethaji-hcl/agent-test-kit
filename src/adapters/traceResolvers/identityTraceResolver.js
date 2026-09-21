// Default traceResolver — most repos have no separate server-assigned trace
// layer, so the client-generated clientTraceId (already threaded through
// invoke-config.js's sendMessage() return value) IS the trace id.
//
// A repo with its own trace/observability layer (e.g. a table that maps a
// client-generated correlation id to a server-assigned trace record, the way
// AIPM-ToolKit's mt_ai_traces/mt_ai_usage_events do) supplies its own
// resolver instead — see docs/CONTRACT.md "traceResolver".
function createIdentityTraceResolver() {
  return {
    async resolve(clientTraceId) {
      return clientTraceId || null;
    }
  };
}

module.exports = { createIdentityTraceResolver };
