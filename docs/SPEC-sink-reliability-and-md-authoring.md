# Spec — sink-failure visibility + Markdown authoring for test-cases/rubrics

Status: **approved plan, not yet built**. This is the handover document for the
session that implements it. Two independent features; can be built and landed
separately.

---

## Feature 1 — DB sink failures must be loud, never silent

### Problem

`supabaseSink.write()` (`src/adapters/resultsSinks/supabaseSink.js`) currently
swallows every insert error into a single `console.warn` per row. A run can
report "9/9 passed" while zero rows actually reached
`agent_test_kit_quality_scores` — bad credentials, a never-run migration, or a
network blip all look identical to success unless someone reads warnings
buried mid-scrollback. Missing env vars (`SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY`) are a *separate*, expected case today and must
stay low-key — the bug is only in the "configured but failing" case.

Decision: **never fail the run** over this (Markdown succeeding is enough to
call a run successful) — just make failures impossible to miss.

### Design

**1. Preflight check** (`runCmd.js`, before `runSuite()` is called)

If `config.createResultsSink()` returns something identifying itself as
Supabase-backed (see "sink capability" below), do one cheap probe —
`client.from('agent_test_kit_quality_scores').select('id').limit(1)` — before
running any test case. On failure, print the specific reason (auth error /
relation does not exist / network) immediately and continue into the run
anyway (per "never fail the run"), so at least the Markdown output still
happens.

To make this possible without runCmd.js knowing about Supabase specifics, add
an optional `preflight()` method to the `resultsSink` interface:

```js
// src/adapters/resultsSinks/supabaseSink.js
return {
  describe() { ... },
  async preflight() {
    const { error } = await client.from(TABLE).select('id').limit(1);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  },
  async write(row) { ... }
};
```

`multiSink.preflight()` fans out to every child sink that has one and
aggregates results. `runCmd.js` calls `resultsSink.preflight?.()` once up
front and prints a warning per failing sink — never throws, never sets
`process.exitCode`.

**2. Per-write failures still warn (unchanged behavior)**, but the run must
also **track** them: `supabaseSink` gets an internal counter
(`attempted`/`failed`) exposed via a new `describe()`-adjacent method, e.g.
`getStats()`, so the end-of-run summary (below) can report real numbers
instead of nothing.

**3. End-of-run persistence summary** (`runCmd.js`, after the existing
pass/fail summary block)

Every sink that implements `describe()` already prints one line
("Results written to: ..."). Extend this into a small block, one line per
sink, e.g.:

```
Markdown: written to .agent-test-kit-results.md
Supabase: 7/9 rows persisted — 2 failed (see warnings above)
```

Sinks that never fail (markdownSink, jsonFileSink) just report "written to
X". Sinks that can fail (supabaseSink) report attempted/failed counts via the
new `getStats()` method if present.

**4. "Not configured" stays a single calm line**, not a warn-level log — this
is `agent-test-kit.config.js`'s own `createResultsSink()` (a per-repo file,
e.g. AIPM-ToolKit's), so no core code change needed there; it already prints
one `console.warn`. Leave as-is (already appropriately quiet — this spec only
tightens the "configured but failing" path, which is silent today).

### Files touched

- `src/adapters/resultsSinks/supabaseSink.js` — add `preflight()`, add
  attempt/fail counters + `getStats()`.
- `src/adapters/resultsSinks/multiSink.js` — fan out `preflight()` and
  `getStats()` across child sinks (skip children that don't implement them).
- `src/adapters/resultsSinks/markdownSink.js`,
  `src/adapters/resultsSinks/jsonFileSink.js` — no functional change; confirm
  they still don't implement `preflight()`/`getStats()` (fine — optional).
- `src/cli/commands/runCmd.js` — call `resultsSink.preflight?.()` before
  `runSuite()`; replace the single `describe()` print with the small
  multi-line persistence summary described above.
- `docs/CONTRACT.md` — document `preflight?()` and `getStats?()` as two more
  optional `resultsSink` methods (alongside the existing `finalize`/`verify`),
  same pattern: optional, sink-specific, never required.
- `test/run-example-agent.test.js` — new test(s): a fake sink whose
  `preflight()` fails is reported but doesn't stop the run; a sink whose
  `write()` fails some rows produces correct `getStats()` numbers reflected in
  the end-of-run summary.

Exit code is unaffected by any of this — `process.exitCode` still derives
only from `totalFail` (test failures), never from sink health.

---

## Feature 2 — Markdown as the human-edit layer for test-cases + rubrics

### Problem

`test-cases.json`/`rubrics.js` are the schema-validated source of truth (good
— keeps `ajv` as a real gate) but that means every correction, including pure
wording/content fixes a non-engineer reviewer would want to make, requires
editing JSON/JS directly. Decision: keep JSON/JS as what `validate`/`run`
actually execute against, but let a reviewer do all their editing in
generated Markdown instead, via a render/sync round trip. Applies to **both**
`test-cases.json` and `rubrics.js`.

### Pipeline change

Stage 1 (Generate skill) is unchanged — it still drafts `test-cases.json`/
`rubrics.js` directly, since LLM output is most reliable as schema-conformant
JSON from the start. What changes is what Gate 1 review actually happens
against:

| Step | Today | New |
|---|---|---|
| 1. Generate | skill drafts `test-cases.json`/`rubrics.js` | unchanged |
| 1.5 Render (**new**) | — | `agent-test-kit render <agent>` writes `test-cases.review.md` + `rubrics.review.md` from the JSON |
| 2. Gate 1 review | reviewer edits JSON/JS directly | reviewer edits the two `.review.md` files |
| 2.5 Sync (**new**) | — | `agent-test-kit sync <agent>` parses the edited MD back into `test-cases.json`/`rubrics.js`, runs `ajv` validation, refuses to write on any error |
| 3. Gate 2 review | unchanged, against JSON | unchanged, against JSON (now the freshly-synced JSON) |
| 4. Run | unchanged | unchanged |

`validate`/`run`/`smoke` never read the `.review.md` files — only `render` and
`sync` touch them. This keeps the actual enforced contract exactly as strict
as it is today.

### Markdown format

One `.review.md` per file, each starting with hidden marker comments (never
touched by a human editor, used only for the staleness check in the next
section):

```markdown
<!-- agent-test-kit:kind:test-cases -->
<!-- agent-test-kit:agent:capability-canvas -->
<!-- agent-test-kit:source-hash:sha256:<hash of test-cases.json at render time> -->

# Test Cases — capability-canvas

Schema version: 1.0

## CC-007

- **Category:** dd-format
- **Rubric:** DD-FMT
- **V1 Scope:** true
- **Execution Mode:** single-turn

**Probe:**
```json
{ "mode": "dd" }
```

**Setup:**
```json
[]
```

**Expected behavior:**
Model should preserve the literal "—" placeholder in the DD template's L4 field.

**Failure mode:**
Model substitutes an em dash or removes the placeholder entirely.

---
```

Field → prose mapping (`test-cases.review.md`):

| JSON field | MD representation |
|---|---|
| `testId` | `## <testId>` heading |
| `category`, `rubric`, `v1Scope`, `executionMode` | bullet list right under the heading |
| `probe` | fenced ` ```json ` block under `**Probe:**` |
| `setup` | fenced ` ```json ` block under `**Setup:**` (omit section if empty/absent) |
| `judgeContext` | fenced ` ```json ` block under `**Judge Context:**` (omit if absent) |
| `expectedBehaviorNote` | prose paragraph under `**Expected behavior:**` (omit if absent) |
| `failureModeNote` | prose paragraph under `**Failure mode:**` (omit if absent) |
| `conversationA` / `conversationB` (dual-conversation mode) | `### Conversation A` / `### Conversation B` subsections, each with their own Setup/Probe blocks |

`rubrics.review.md` follows the same shape, one `## <rubricCode>` section per
rubric:

| JSON field | MD representation |
|---|---|
| rubric key | `## <rubricCode>` heading |
| `metric`, `evaluatorType`, `scale`, `threshold` | bullet list |
| `judgePromptTemplate` | fenced code block under `**Judge Prompt Template:**` (omit if absent — required by schema only for `llm_judge`/`toxicity_scan`) |

### Parser

Hand-rolled, line-based parser (no new dependency — same posture as
`markdownSink.js`'s hand-rolled writer). The format is fully controlled by
`render` (round-trip, not arbitrary free-form user Markdown), so a strict
line/section parser is appropriate — no need for a general Markdown AST
library.

**Round-trip requirement** (add as a test): `sync(render(json)) === json`
(deep-equal) for every fixture in `examples/example-agent/` and
`test-suite/agents/capability-canvas/` — this is the core correctness
guarantee for the whole feature.

**Error handling**: `sync` builds the JSON object per rubric/test-case while
parsing; any missing required section (e.g. no `**Probe:**` block for a
`single-turn` test case) is reported immediately as
`"<testId>: missing required 'Probe' section for executionMode=single-turn"`,
matching the existing `validate` error style. After the whole MD file parses
structurally, run the existing `ajv` schemas (`testCase.schema.json`/
`rubric.schema.json`) against the assembled JSON as the final gate — this
catches anything the line parser doesn't itself enforce (enum values,
threshold range, etc.). **On any error, `sync` writes nothing** — never a
partially-synced JSON file, same all-or-nothing posture as `validate` today.

### New CLI commands

- **`agent-test-kit render <agent>`** — JSON → MD. Writes
  `test-suite/agents/<agent>/test-cases.review.md` and
  `.../rubrics.review.md`. Before overwriting an existing `.review.md`, runs
  the staleness check (below) and warns if it would discard unsynced edits —
  then overwrites anyway (warn, never block, matching the sink-failure
  posture from Feature 1).
- **`agent-test-kit sync <agent>`** — MD → JSON. Parses both `.review.md`
  files, validates, writes `test-cases.json`/`rubrics.js` on success. Also
  runs the gate-integrity check (below) after a successful write.
- **`agent-test-kit check-md-staleness <agent>`** — read-only, always exits 0.
  Prints a warning if the current `.review.md` files' embedded source-hash no
  longer matches the on-disk JSON (meaning the MD holds edits that were never
  synced). Exists so the **Generate skill** can call it before drafting fresh
  JSON — see below.

### Staleness protection (regeneration warning)

Mechanism: the hidden `source-hash` marker embedded in each `.review.md` at
render/sync time is a hash of the JSON it corresponds to. Any time the JSON
is about to be regenerated from scratch — which today happens inside the
`generate-agent-test-suite` Claude Code skill, not a CLI command — that skill
must first call `agent-test-kit check-md-staleness <agent>`. If it reports a
mismatch, the skill surfaces exactly the warning you described to the user
before writing: *"test-cases.review.md / rubrics.review.md have edits that
haven't been synced to JSON — regenerating now will overwrite
test-cases.json/rubrics.js, and those MD edits will be lost unless you run
`sync` first."* Then proceeds with generation regardless (informational only,
never blocking) — consistent with "warn, don't block" everywhere else in this
spec.

File touched for this: `plugin/skills/generate-agent-test-suite/SKILL.md` —
add an instruction to run `check-md-staleness` first and relay its output
before drafting.

### Gate-approval integrity (same hash mechanism, applied to `review-status.json`)

`src/core/reviewStatus.js`'s shape gains one optional field per gate:

```json
{
  "gate1": { "approved": true, "reviewer": "...", "date": "...", "notes": "...", "approvedContentHash": "sha256:..." },
  "gate2": { "approved": true, "reviewer": "...", "date": "...", "notes": "...", "approvedContentHash": "sha256:..." }
}
```

`approvedContentHash` is recorded (by whichever skill/step flips `approved`
to `true`) as the hash of the combined `test-cases.json` + `rubrics.js`
content at approval time. Add one helper,
`checkGateContentDrift(agentDir, status)`, reused in three places:

- `sync` (after a successful write) — since sync is precisely the moment
  content changes underneath an existing approval.
- `runCmd.js` and `validateCmd.js` — since a hand-edit to the JSON files
  (bypassing MD entirely) is equally possible and should be caught too.

On drift, print (not block, not reset the booleans):
`"Note: test-cases.json/rubrics.js changed since gate1/gate2 were approved — you may want to re-review before trusting this run."`

### Files touched

- `src/core/mdAuthoring/render.js` (**new**) — JSON → MD rendering for both
  file kinds.
- `src/core/mdAuthoring/sync.js` (**new**) — MD → JSON parsing + validation.
- `src/core/mdAuthoring/hash.js` (**new**) — shared `sha256` hashing helper
  used by both the MD staleness marker and the gate-integrity check.
- `src/cli/commands/renderCmd.js`, `syncCmd.js`, `checkMdStalenessCmd.js`
  (**new**) — thin CLI wrappers, registered in `bin/agent-test-kit.js`.
- `src/core/reviewStatus.js` — add `approvedContentHash` field +
  `checkGateContentDrift()`.
- `src/cli/commands/runCmd.js`, `validateCmd.js` — call
  `checkGateContentDrift()` and print the notice if it fires.
- `plugin/skills/generate-agent-test-suite/SKILL.md` — call
  `check-md-staleness` before drafting; relay any warning.
- `plugin/skills/review-agent-test-cases/SKILL.md` — update instructions to
  review the `.review.md` files, not the JSON, and to run `sync` once done.
- `docs/CONTRACT.md`, `docs/ARCHITECTURE.md` — document the new
  render/sync/check-md-staleness commands, the MD format tables above, and
  the `approvedContentHash` field.
- `test/run-example-agent.test.js` — new tests: round-trip idempotency
  (`sync(render(json)) === json`) for the example agent; a mangled
  `.review.md` produces a specific, localized `sync` error and writes
  nothing; `check-md-staleness` correctly detects a hand-edited `.review.md`;
  `checkGateContentDrift` fires after a content change post-approval and
  stays silent when nothing changed.

---

## Suggested build order

1. Feature 1 (sink reliability) — small, self-contained, no format design
   risk.
2. Feature 2's `hash.js` + `reviewStatus.js` gate-integrity piece — reusable,
   low risk, no parser needed yet.
3. Feature 2's `render.js` (JSON → MD) — the easier direction.
4. Feature 2's `sync.js` (MD → JSON) + round-trip test — the risky direction;
   validate against both `examples/example-agent` and
   `test-suite/agents/capability-canvas` (the more complex real fixture,
   including its `dd`/`dual-conversation`-shaped cases if any) before calling
   it done.
5. Wire the two skills (`generate-agent-test-suite`,
   `review-agent-test-cases`) last, once the CLI commands are proven.
