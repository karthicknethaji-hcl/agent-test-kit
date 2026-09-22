# Getting started

## Install

Private registry for now — see the root `README.md` "Installing from the
private registry" for the `.npmrc` scope config, then:

```
npm install --save-dev @karthicknethaji-hcl/agent-test-kit
```

Or without installing, via `npx` once the registry is configured:

```
npx @karthicknethaji-hcl/agent-test-kit init
```

## Try it with the bundled example agent (no setup required)

```
npx agent-test-kit validate example-agent   # (run from examples/, or copy that folder into your own test-suite/agents/)
npx agent-test-kit smoke example-agent
ANTHROPIC_API_KEY=sk-... npx agent-test-kit run example-agent
```

## Onboard your own agent

Seven things you do, in two places — chat with Claude Code, or a terminal.
`render`, `sync`, and `validate`/`smoke` re-checks aren't separate steps you
run yourself: each fires automatically as the closing action of the step
right before it, so a mechanical check always catches problems before the
next human judgment call starts. See `docs/ARCHITECTURE.md` "The 4-stage
pipeline" for the full stage-by-stage breakdown.

1. `npx agent-test-kit init` — scaffolds `agent-test-kit.config.js` + `test-suite/agents/`.
2. `npx agent-test-kit add-agent <name>` — scaffolds a new agent folder with
   template files.
3. **Generate** (Claude Code, via the bundled plugin — see root `README.md`
   "Installing the Claude Code plugin"): ask it to draft `test-cases.json`,
   `rubrics.js`, `invoke-config.js` (+ `scriptChecks.js` if needed) from your
   agent's real source code — e.g. *"Onboard `<name>` to agent-test-kit —
   its source is at `<file path>`."* It wires `invoke-config.js`'s
   `sendMessage()` to your agent's real code path wherever that's callable
   headlessly, then automatically runs `validate` + `smoke` + `render`
   itself (fixing anything it finds) before handing off — you don't run
   these commands yourself here.
4. **Gate 1 review** (product): *"Do a Gate 1 review of `<name>`'s test
   cases."* Any correction happens directly in the generated
   `test-cases.review.md`/`rubrics.review.md` — never the raw JSON/JS. Once
   you're done editing, the skill automatically runs `sync` (parses the
   `.review.md` files back into JSON/JS, validates, all-or-nothing) and then
   `smoke` again, *before* it asks you to approve.
5. **Gate 2 review** (technical fidelity): *"Do a Gate 2 review of
   `<name>`'s invoke-config."* Runs against the already-synced,
   already-smoke-tested `test-cases.json` from step 4. If step 3 genuinely
   couldn't call your agent's real code directly (rare — only for
   DOM/session-coupled agents) and drafted a hand-approximation instead,
   this is where that gets caught: a normal finding, not approved until
   fixed, same as any other Gate 2 issue — not a separate step you need to
   plan for up front.
6. **Approve both gates** — say "I approve" in chat once satisfied, or
   hand-edit `review-status.json` yourself.
7. `npx agent-test-kit run <name>` — refuses until both gates are approved.

Anytime: `npx agent-test-kit status` to see every agent's schema/gate
state, and `npx agent-test-kit check-md-staleness <name>` (read-only,
always safe) to check whether a `.review.md` file holds edits that were
never synced.

## Configuring your own adapters

Edit `agent-test-kit.config.js` (scaffolded by `init`) — every field is
optional; see `docs/ARCHITECTURE.md` "Pluggable seams" for what each one is
for and when the default won't fit.
