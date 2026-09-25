#!/usr/bin/env node
// CI check for every package under mcp-servers/ — run via `npm run
// verify:mcp-servers`. For each package: (1) `npm pack --dry-run` and assert
// package.json, README.md, the bin entry, and (Supabase package only) the
// SQL migration are all included and no repo-only files leak in; (2)
// actually execute the packed bin entry with --help and assert it exits 0
// quickly — a real process execution, not just a check that the file exists
// on disk (see the plan's "Review disposition" for why the CI check needed
// to be this concrete).
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MCP_SERVERS_DIR = path.join(__dirname, '..', 'mcp-servers');
const REQUIRED_FILES = ['package.json', 'README.md'];

function packFileList(pkgDir) {
  // execSync always runs through a shell (cmd.exe on Windows, resolving
  // npm.cmd via PATHEXT itself; /bin/sh elsewhere), so this needs no
  // platform-specific command name or execFileSync's shell:true — which
  // Node deprecates (DEP0190) when combined with an args array, since the
  // array's arguments aren't escaped by the shell. Safe here regardless:
  // the whole command is a static literal, never external/user input.
  const output = execSync('npm pack --dry-run --json', { cwd: pkgDir, encoding: 'utf8' });
  const [result] = JSON.parse(output);
  return result.files.map((f) => f.path);
}

function verifyPackage(name) {
  const pkgDir = path.join(MCP_SERVERS_DIR, name);
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  console.log('[verify-mcp-servers] ' + name + ':');

  const files = packFileList(pkgDir);
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) throw new Error(name + ': npm pack is missing required file "' + required + '"');
  }
  const binEntry = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
  if (!files.includes(binEntry)) throw new Error(name + ': npm pack is missing its own bin entry "' + binEntry + '"');
  if (name === 'supabase-mcp-server') {
    if (!files.some((f) => f.startsWith('sql/'))) throw new Error(name + ': npm pack is missing the SQL migration file');
  }
  for (const leak of ['node_modules', '.git']) {
    if (files.some((f) => f.startsWith(leak + '/'))) throw new Error(name + ': npm pack leaked "' + leak + '" into the package');
  }
  console.log('  pack contents OK (' + files.length + ' file(s))');

  // Actually execute the packed bin entry, not just check it exists on disk.
  const binPath = path.join(pkgDir, binEntry);
  const output = execFileSync(process.execPath, [binPath, '--help'], { encoding: 'utf8', timeout: 10000 });
  if (!output.trim()) throw new Error(name + ': "' + binEntry + ' --help" produced no output');
  console.log('  bin entry runs OK: ' + output.trim());
}

function main() {
  const names = fs.readdirSync(MCP_SERVERS_DIR).filter((n) => fs.statSync(path.join(MCP_SERVERS_DIR, n)).isDirectory());
  for (const name of names) verifyPackage(name);
  console.log('\n[verify-mcp-servers] All ' + names.length + ' package(s) verified.');
}

main();
