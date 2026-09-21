// The canonical, package-owned Supabase sink. Unlike a truly generic
// adapter, this one is deliberately opinionated: EVERY repo that uses it
// writes to the same table (`agent_test_kit_quality_scores`) with the same
// columns — see sql/agent-test-kit-quality-scores-migration.sql for the
// schema (a file to run yourself; this package never executes SQL). That's
// the point: a fixed, universal schema is what makes it possible to build
// one dashboard/reporting tool against ANY repo using agent-test-kit,
// instead of every repo inventing its own table shape. Only the connection
// (which Supabase project) is ever repo-specific — the schema itself isn't.
//
// @supabase/supabase-js is require()'d lazily, only when this sink is
// actually constructed. It's an optionalDependency of this package (not a
// hard one) — required in package.json so this sink resolves it correctly
// even when agent-test-kit itself is installed via a symlinked local `file:`
// reference (Node resolves such requires against the package's own real
// path, not the consuming repo's node_modules), but still opt-in: a repo
// that never uses this sink pays no functional cost if the install is
// skipped.
//
// Insert failures warn and move on rather than failing the run, same
// posture as every other non-critical persistence path in this package.
const TABLE = 'agent_test_kit_quality_scores';

function createSupabaseSink(options) {
  const opts = options || {};
  if (!opts.supabaseUrl || !opts.supabaseServiceRoleKey) {
    throw new Error('supabaseSink: both supabaseUrl and supabaseServiceRoleKey are required.');
  }

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(opts.supabaseUrl, opts.supabaseServiceRoleKey);

  function toRow(row) {
    return {
      test_id: row.testId,
      trace_id: row.traceId,
      agent_name: row.agentName,
      category: row.category,
      metric: row.metric,
      score: row.score,
      pass: row.pass,
      evaluator: row.evaluator,
      run_id: row.runId,
      notes: row.notes,
      recommendation: row.recommendation
    };
  }

  return {
    describe() { return "Supabase table '" + TABLE + "'"; },
    async write(row) {
      const { error } = await client.from(TABLE).insert(toRow(row));
      if (error) {
        console.warn('[supabaseSink] Failed to write ' + row.testId + ' to ' + TABLE + ': ' + error.message);
      }
    }
  };
}

module.exports = { createSupabaseSink, TABLE };
