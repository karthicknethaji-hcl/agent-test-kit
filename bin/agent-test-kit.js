#!/usr/bin/env node
const path = require('path');
const { loadConfig } = require('../src/core/config');
const { init } = require('../src/cli/commands/init');
const { addAgent } = require('../src/cli/commands/addAgent');
const { validateCmd } = require('../src/cli/commands/validateCmd');
const { statusCmd } = require('../src/cli/commands/statusCmd');
const { smokeCmd } = require('../src/cli/commands/smokeCmd');
const { runCmd } = require('../src/cli/commands/runCmd');

function parseFlags(argv) {
  const flags = { only: null, all: false, force: false, skipGateCheck: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') flags.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--all') flags.all = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--skip-gate-check') flags.skipGateCheck = true;
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
  agent-test-kit run <name> [--only a,b] [--all] [--skip-gate-check]
                                              Run the agent's approved test suite

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

  console.error('Unknown command: ' + command);
  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('[agent-test-kit] Fatal:', err.message);
  process.exitCode = 1;
});
