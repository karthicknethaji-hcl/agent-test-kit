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

1. `npx agent-test-kit init` — scaffolds `agent-test-kit.config.js` + `test-suite/agents/`.
2. `npx agent-test-kit add-agent <name>` — scaffolds a new agent folder with
   template files.
3. **Generate** (Claude Code, via the bundled plugin — see root `README.md`
   "Installing the Claude Code plugin"): ask it to draft `test-cases.json`,
   `rubrics.js`, `invoke-config.js` (+ `scriptChecks.js` if needed) from your
   agent's real source code.
4. Fill in `invoke-config.js`'s `sendMessage()` with your agent's real call —
   see `docs/CONTRACT.md`. This is the one part no tool can write for you.
5. `npx agent-test-kit validate <name>` until it's clean.
6. `npx agent-test-kit smoke <name>` to confirm a real call round-trips.
7. **Gate 1 review** (product) and **Gate 2 review** (technical fidelity) —
   via the plugin's review skills, or by hand-editing `review-status.json`.
8. `npx agent-test-kit run <name>` — refuses until both gates are approved.
9. `npx agent-test-kit status` any time to see every agent's schema/gate state.

## Configuring your own adapters

Edit `agent-test-kit.config.js` (scaffolded by `init`) — every field is
optional; see `docs/ARCHITECTURE.md` "Pluggable seams" for what each one is
for and when the default won't fit.
