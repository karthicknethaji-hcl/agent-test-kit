#!/usr/bin/env node
const path = require('path');
const { loadConfig } = require('../src/core/config');
const { init } = require('../src/cli/commands/init');
const { addAgent } = require('../src/cli/commands/addAgent');
const { validateCmd } = require('../src/cli/commands/validateCmd');
const { statusCmd } = require('../src/cli/commands/statusCmd');
const { smokeCmd } = require('../src/cli/commands/smokeCmd');
const { runCmd } = require('../src/cli/commands/runCmd');
const { renderCmd } = require('../src/cli/commands/renderCmd');
const { syncCmd } = require('../src/cli/commands/syncCmd');
const { checkMdStalenessCmd } = require('../src/cli/commands/checkMdStalenessCmd');
const { resultsCmd } = require('../src/cli/commands/resultsCmd');
const { migrateLayoutCmd } = require('../src/cli/commands/migrateLayoutCmd');

function parseFlags(argv) {
  const flags = { only: null, all: false, force: false, skipGateCheck: false, notes: false, dryRun: false };
  const positional = [];

  // Consumes and returns the value following a flag, validating it exists
  // and isn't itself another recognized `--flag` — without this, a value
  // accidentally omitted before another flag (e.g. `--from --to 2026-01-01`)
  // would silently swallow that flag's NAME as this one's value instead of
  // failing loudly.
  function takeValue(flagName) {
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('agent-test-kit: ' + flagName + ' requires a value.');
    }
    return value;
  }

  let i;
  for (i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') flags.only = takeValue('--only').split(',').map((s) => s.trim());
    else if (a === '--all') flags.all = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--skip-gate-check') flags.skipGateCheck = true;
    else if (a === '--notes') flags.notes = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--pass') {
      const value = takeValue('--pass');
      if (value !== 'true' && value !== 'false') throw new Error('agent-test-kit: --pass must be "true" or "false", got "' + value + '".');
      flags.pass = value === 'true';
    }
    else if (a === '--from') flags.from = takeValue('--from');
    else if (a === '--to') flags.to = takeValue('--to');
    else if (a === '--test-id') flags.testId = takeValue('--test-id');
    else if (a === '--evaluator') flags.evaluator = takeValue('--evaluator');
    else if (a === '--run-id') flags.runId = takeValue('--run-id');
    else if (a === '--limit') flags.limit = Number(takeValue('--limit'));
    else if (a === '--cursor') flags.cursor = takeValue('--cursor');
    else if (a === '--sink') flags.sink = Number(takeValue('--sink'));
    else positional.push(a);
  }
  return { flags, positional };
}

function printUsage() {
  console.log(`agent-test-kit — agent-agnostic AI agent test execution framework

Usage:
  agent-test-kit init                        Scaffold agent-test-kit.config.js + test-suite/agents/
  agent-test-kit add-agent <name>            Scaffold a new agent folder from templates
  agent-test-kit validate <name>             Schema-validate an agent's files (no execution)
  agent-test-kit status [name]               Show schema/gate-approval status for one or all agents
  agent-test-kit smoke <name>                Call the agent once, confirm a real response comes back
  agent-test-kit run <name> [--only a,b] [--all] [--skip-gate-check] [--notes]
                                              Run the agent's approved test suite
                                              (--notes includes the evaluator Notes column in the report; off by default)
  agent-test-kit render <name>               Write test-cases.review.md + rubrics.review.md from JSON
  agent-test-kit sync <name>                 Parse the .review.md files back into JSON, validate, write
  agent-test-kit check-md-staleness <name>   Warn if .review.md holds edits never synced to JSON (read-only)
  agent-test-kit results <name> [--pass true|false] [--from date] [--to date]
                                              [--test-id id] [--evaluator name] [--run-id id]
                                              [--limit n] [--cursor token] [--sink n]
                                              Query persisted results (requires an mcpSink whose
                                              server implements query_results)
  agent-test-kit migrate-layout [--dry-run]  One-time upgrade of every agent folder from the old flat
                                              layout to config/review/results (see docs/ARCHITECTURE.md)

See docs/GETTING-STARTED.md.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  const cwd = process.cwd();

  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  if (command === 'init') {
    init(cwd, flags);
    return;
  }

  if (command === 'add-agent') {
    const config = loadConfig(cwd);
    addAgent(config.agentsDir, positional[0]);
    return;
  }

  if (command === 'validate') {
    const config = loadConfig(cwd);
    const ok = validateCmd(config.agentsDir, positional[0]);
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (command === 'status') {
    const config = loadConfig(cwd);
    statusCmd(config.agentsDir, positional[0]);
    return;
  }

  if (command === 'smoke') {
    const config = loadConfig(cwd);
    await smokeCmd(config, positional[0]);
    return;
  }

  if (command === 'run') {
    const config = loadConfig(cwd);
    await runCmd(config, positional[0], flags);
    return;
  }

  if (command === 'render') {
    const config = loadConfig(cwd);
    renderCmd(config.agentsDir, positional[0]);
    return;
  }

  if (command === 'sync') {
    const config = loadConfig(cwd);
    const ok = syncCmd(config.agentsDir, positional[0]);
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (command === 'check-md-staleness') {
    const config = loadConfig(cwd);
    checkMdStalenessCmd(config.agentsDir, positional[0]);
    return;
  }

  if (command === 'results') {
    const config = loadConfig(cwd);
    await resultsCmd(config, positional[0], flags);
    return;
  }

  if (command === 'migrate-layout') {
    const config = loadConfig(cwd);
    await migrateLayoutCmd(config, flags);
    return;
  }

  console.error('Unknown command: ' + command);
  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('[agent-test-kit] Fatal:', err.message);
  process.exitCode = 1;
});
