-- agent-test-kit's canonical results table.
--
-- NOT run automatically by agent-test-kit or by Claude Code. Run this once,
-- yourself, against your own Supabase/Postgres project before pointing
-- agent-test-kit.config.js's createResultsSink at supabaseSink.
--
-- This exact name and shape is deliberately fixed and shared across every
-- repo that adopts agent-test-kit (see src/adapters/resultsSinks/
-- supabaseSink.js's own header comment for why) -- do not rename this table
-- or its columns; a repo-specific need should be met with a VIEW on top of
-- this table, not a schema fork.

create table if not exists agent_test_kit_quality_scores (
  id uuid primary key default gen_random_uuid(),
  test_id text not null,
  trace_id text,
  agent_name text not null,
  category text not null,
  metric text not null,
  score numeric,
  pass boolean not null,
  evaluator text not null,
  run_id text not null,
  notes jsonb,
  recommendation text,
  created_at timestamptz not null default now()
);

comment on table agent_test_kit_quality_scores is
  'Canonical, package-owned results table for agent-test-kit. Shape is fixed across every adopting repo on purpose -- see supabaseSink.js.';

create index if not exists agent_test_kit_quality_scores_agent_run_idx
  on agent_test_kit_quality_scores (agent_name, run_id);

create index if not exists agent_test_kit_quality_scores_test_id_idx
  on agent_test_kit_quality_scores (test_id);
