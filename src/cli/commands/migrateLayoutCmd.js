// `agent-test-kit migrate-layout [--dry-run]` — one-time upgrade from the old
// flat per-agent layout to the new config/review/results split (see
// docs/ARCHITECTURE.md "Per-agent folder layout"). Safety properties (all
// deliberate, not incidental — see the plan's "Review disposition"):
//
//   1. `--dry-run` prints the full plan (moves + conflicts) with no disk
//      writes at all. It is a recommended first step, not a CLI-enforced
//      prerequisite for the real run.
//   2. Conflict detection (does the destination already exist with DIFFERENT
//      content?) runs fully before anything is touched.
//   3. A full backup snapshot of every file about to move is built into a
//      TEMPORARY directory, verified file-by-file, and only THEN atomically
//      renamed into its final name — never "backed up after the fact". If
//      backup preparation fails partway (disk full, permissions), the
//      migration aborts before touching any source or destination file, and
//      the incomplete temp backup is removed.
//   4. The actual migration is copy -> verify -> remove-source, per file.
//      This is NOT atomic across an agent's whole file set: a crash between
//      two files can leave a mix of already-moved and not-yet-moved files.
//      What IS guaranteed: nothing is ever lost (the backup has a copy of
//      everything), and the command is idempotent/resumable — a file whose
//      destination already exists and whose source is already gone is
//      recognized as already migrated and skipped on the next run.
//   5. The old top-level `.agent-test-kit-results/` directory is never
//      deleted wholesale. Only files that match a known agent's
//      `run-<agentName>-<timestamp>.md`/`.ndjson` naming convention are
//      moved into that agent's new `results/` folder; everything else
//      (unrecognized names, orphaned runs, the legacy global
//      `.agent-test-kit-results.ndjson` from jsonFileSink) is left in place
//      and reported.
const fs = require('fs');
const path = require('path');
const { getAgentPaths } = require('../../core/agentPaths');

const FLAT_FILE_MAP = [
  { name: 'test-cases.json', to: (p) => p.config.testCases },
  { name: 'rubrics.js', to: (p) => p.config.rubrics },
  { name: 'invoke-config.js', to: (p) => p.config.invokeConfig },
  { name: 'scriptChecks.js', to: (p) => p.config.scriptChecks },
  { name: 'test-cases.review.md', to: (p) => p.review.testCasesReview },
  { name: 'rubrics.review.md', to: (p) => p.review.rubricsReview },
  { name: 'review-status.json', to: (p) => p.review.reviewStatus }
];

function discoverAgentNames(agentsDir) {
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir).filter((n) => fs.statSync(path.join(agentsDir, n)).isDirectory());
}

function planAgentFileMoves(agentDir) {
  const paths = getAgentPaths(agentDir);
  const moves = [];
  for (const entry of FLAT_FILE_MAP) {
    const from = path.join(agentDir, entry.name);
    if (fs.existsSync(from)) moves.push({ from, to: entry.to(paths) });
  }
  return moves;
}

// Old markdownSink default: <root>/.agent-test-kit-results/run-<agentName>-<timestamp>.md
// (or .ndjson, if a repo pointed jsonFileSink at that directory explicitly).
// Matched against KNOWN agent names rather than a name-shaped regex, since an
// agent name can itself contain hyphens and timestamps embed no delimiter
// that would let a regex disambiguate the boundary unambiguously.
//
// Candidates are tried LONGEST NAME FIRST — a plain array .find() in
// discovery order would let a shorter agent name that happens to be a
// hyphen-prefix of a longer one (e.g. "demo" vs "demo-v2") match first and
// silently misattribute "demo-v2"'s files to "demo".
function planResultsMoves(agentsDir, repoRoot, agentNames) {
  const oldResultsDir = path.join(repoRoot, '.agent-test-kit-results');
  const moves = [];
  const untouched = [];
  const namesLongestFirst = agentNames.slice().sort((a, b) => b.length - a.length);
  if (fs.existsSync(oldResultsDir)) {
    for (const file of fs.readdirSync(oldResultsDir)) {
      const full = path.join(oldResultsDir, file);
      if (!fs.statSync(full).isFile()) continue;
      const matchedAgent = namesLongestFirst.find((name) =>
        file.startsWith('run-' + name + '-') && (file.endsWith('.md') || file.endsWith('.ndjson'))
      );
      if (matchedAgent) {
        const dest = path.join(getAgentPaths(path.join(agentsDir, matchedAgent)).results.dir, file);
        moves.push({ agent: matchedAgent, from: full, to: dest });
      } else {
        untouched.push(full);
      }
    }
  }
  return { moves, untouched };
}

// Byte-exact for most files. For .json files specifically, falls back to a
// structural comparison when the raw text differs — every writer in this
// package (addAgent.js, mdAuthoring/sync.js) formats JSON consistently, but
// a file restored by a different tool, or hand-formatted, could hold
// identical data with different whitespace/key order/trailing newline. A
// byte-exact-only comparison would misclassify that as a hard conflict and
// block the whole migration for a non-issue.
function filesEqual(a, b) {
  let rawA, rawB;
  try {
    rawA = fs.readFileSync(a, 'utf8');
    rawB = fs.readFileSync(b, 'utf8');
  } catch (e) {
    return false;
  }
  if (rawA === rawB) return true;
  if (a.endsWith('.json') && b.endsWith('.json')) {
    try {
      return deepEqual(JSON.parse(rawA), JSON.parse(rawB));
    } catch (e) {
      return false;
    }
  }
  return false;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

// pending          — source exists, destination doesn't: needs a move
// pending-duplicate— both exist with IDENTICAL content: safe to finish (copy
//                    is a no-op, then the stale source is removed)
// already-migrated — source gone, destination exists: prior run finished
//                    this file already — resumability relies on this case
// nothing-to-do    — neither exists (e.g. optional scriptChecks.js never
//                    existed for this agent)
// conflict         — both exist with DIFFERENT content: needs a human
function classifyMove(move) {
  const sourceExists = fs.existsSync(move.from);
  const destExists = fs.existsSync(move.to);
  let status;
  if (!sourceExists && destExists) status = 'already-migrated';
  else if (!sourceExists && !destExists) status = 'nothing-to-do';
  else if (sourceExists && !destExists) status = 'pending';
  else status = filesEqual(move.from, move.to) ? 'pending-duplicate' : 'conflict';
  return Object.assign({}, move, { status });
}

function planMigration(agentsDir, repoRoot) {
  const agentNames = discoverAgentNames(agentsDir);
  const agentPlans = agentNames.map((name) => {
    const agentDir = path.join(agentsDir, name);
    return { name, agentDir, moves: planAgentFileMoves(agentDir) };
  });
  const { moves: resultMoves, untouched } = planResultsMoves(agentsDir, repoRoot, agentNames);
  for (const rm of resultMoves) {
    const plan = agentPlans.find((p) => p.name === rm.agent);
    if (plan) plan.moves.push({ from: rm.from, to: rm.to });
  }
  return { agentPlans, untouchedResultFiles: untouched };
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function migrateLayoutCmd(config, opts) {
  const options = opts || {};
  const agentsDir = config.agentsDir;
  const repoRoot = config.root;

  const { agentPlans, untouchedResultFiles } = planMigration(agentsDir, repoRoot);
  const classifiedPlans = agentPlans.map((p) => ({ name: p.name, moves: p.moves.map(classifyMove) }));

  const allMoves = classifiedPlans.flatMap((p) => p.moves.map((m) => Object.assign({ agent: p.name }, m)));
  const conflicts = allMoves.filter((m) => m.status === 'conflict');
  const pending = allMoves.filter((m) => m.status === 'pending' || m.status === 'pending-duplicate');

  console.log('[migrate-layout] Plan:');
  for (const p of classifiedPlans) {
    const agentPending = p.moves.filter((m) => m.status === 'pending' || m.status === 'pending-duplicate');
    const agentConflicts = p.moves.filter((m) => m.status === 'conflict');
    if (agentPending.length === 0 && agentConflicts.length === 0) continue;
    console.log('  ' + p.name + ':');
    for (const m of agentPending) console.log('    move ' + path.relative(repoRoot, m.from) + ' -> ' + path.relative(repoRoot, m.to));
    for (const m of agentConflicts) console.log('    CONFLICT: ' + path.relative(repoRoot, m.from) + ' vs ' + path.relative(repoRoot, m.to) + ' (different content — resolve by hand, then re-run)');
  }
  if (pending.length === 0 && conflicts.length === 0) {
    console.log('  (nothing to migrate — already up to date)');
  }
  if (untouchedResultFiles.length > 0) {
    console.log('  Left untouched in .agent-test-kit-results/ (unrecognized name, or no matching agent):');
    for (const f of untouchedResultFiles) console.log('    ' + path.relative(repoRoot, f));
  }
  const globalNdjson = path.join(repoRoot, '.agent-test-kit-results.ndjson');
  if (fs.existsSync(globalNdjson)) {
    console.log('  Note: ' + path.relative(repoRoot, globalNdjson) + ' (jsonFileSink\'s legacy global file, mixing every agent\'s rows) is left in place — it is not split automatically.');
  }

  if (conflicts.length > 0) {
    console.error('\n[migrate-layout] ' + conflicts.length + ' conflict(s) found — resolve manually (make the two sides match, or delete/rename one) and re-run.');
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log('\n[migrate-layout] Dry run — no files were changed.');
    return;
  }

  if (pending.length === 0) {
    console.log('\n[migrate-layout] Nothing to migrate.');
    return;
  }

  // Phase: build the backup into a temp dir, verify every file, THEN
  // atomically rename into its final name. Nothing outside this temp
  // directory is touched until the rename below succeeds.
  const backupDir = path.join(repoRoot, '.agent-test-kit-migration-backup-' + backupTimestamp());
  const tmpBackupDir = backupDir + '.tmp';
  fs.mkdirSync(tmpBackupDir, { recursive: true });
  try {
    for (const move of pending) {
      const rel = path.relative(repoRoot, move.from);
      const backupDest = path.join(tmpBackupDir, rel);
      fs.mkdirSync(path.dirname(backupDest), { recursive: true });
      fs.copyFileSync(move.from, backupDest);
      if (!filesEqual(move.from, backupDest)) throw new Error('backup verification failed for ' + rel);
    }
  } catch (e) {
    fs.rmSync(tmpBackupDir, { recursive: true, force: true });
    console.error('[migrate-layout] Backup preparation failed — aborting before touching any source or destination file: ' + e.message);
    process.exitCode = 1;
    return;
  }
  fs.renameSync(tmpBackupDir, backupDir);
  console.log('\n[migrate-layout] Backup created at ' + path.relative(repoRoot, backupDir));

  // Phase: the actual migration. Copy -> verify -> remove source, per file.
  // Not atomic across an agent's file set (see header comment) — a partial
  // failure here is recoverable (backup exists) and the command is safe to
  // re-run to resume.
  const incompleteAgents = [];
  for (const p of classifiedPlans) {
    const agentPending = p.moves.filter((m) => m.status === 'pending' || m.status === 'pending-duplicate');
    if (agentPending.length === 0) continue;
    let ok = true;
    for (const move of agentPending) {
      try {
        fs.mkdirSync(path.dirname(move.to), { recursive: true });
        // Re-check immediately before the destructive copy: classification
        // happened earlier (after the whole backup phase completed), so a
        // 'pending' move whose destination has appeared since then (a
        // concurrent migrate-layout run, or an external edit) must never be
        // silently overwritten — that would contradict this command's own
        // "conflict detection before anything is touched" guarantee.
        if (move.status === 'pending' && fs.existsSync(move.to)) {
          throw new Error('destination now exists but did not when this run started (concurrent modification?) — skipped; re-run migrate-layout to re-classify');
        }
        fs.copyFileSync(move.from, move.to);
        if (!filesEqual(move.from, move.to)) throw new Error('destination verification failed');
        fs.unlinkSync(move.from);
      } catch (e) {
        console.error('[migrate-layout] ' + p.name + ': failed to migrate ' + path.relative(repoRoot, move.from) + ': ' + e.message);
        ok = false;
      }
    }
    console.log('[migrate-layout] ' + p.name + ': ' + (ok ? 'migrated' : 'INCOMPLETE') + ' (' + agentPending.length + ' file(s)).');
    if (!ok) incompleteAgents.push(p.name);
  }

  if (incompleteAgents.length > 0) {
    console.error(
      '\n[migrate-layout] Incomplete for: ' + incompleteAgents.join(', ') + '. Nothing was lost — a backup exists at ' +
      path.relative(repoRoot, backupDir) + '. Re-run `agent-test-kit migrate-layout` to resume; already-moved files are safely skipped.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('\n[migrate-layout] Done.');
}

module.exports = { migrateLayoutCmd, planMigration, classifyMove };
