// Default persistent sink — zero external dependencies. Writes one
// human-readable Markdown report (a results table + a summary line) per
// run, so `agent-test-kit run` produces something anyone can skim without a
// database, a JSON viewer, or this package's own tooling.
//
// Zero-config default: a fresh, timestamped file per run
// (.agent-test-kit-results/run-<agentName>-<timestamp>.md, or just
// run-<timestamp>.md if no agentName is given) — a run's results are never
// silently appended to (and visually buried inside) a previous run's file,
// and nothing gets overwritten by a later run either. Pass an explicit
// `filePath` to opt back into a single fixed file that every run appends to
// (the old default behavior).
//
// Uses the resultsSink.finalize(runSummary) lifecycle hook (see
// docs/CONTRACT.md "resultsSink lifecycle") to render the summary line and
// close out the table once the whole run is done — write(row) alone can't
// do that, since it only ever sees one row at a time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

// notes is a free-form object whose shape varies by evaluator (unsupportedClaims,
// rawOutput, reasoning, restatedItems, etc.) — render it as compact JSON so none
// of that detail is silently dropped from the report.
function formatNotes(notes) {
  if (notes === null || notes === undefined) return '';
  if (typeof notes === 'string') return notes;
  try {
    return JSON.stringify(notes);
  } catch (err) {
    return String(notes);
  }
}

// Filesystem-safe (no ':') and still lexicographically sortable in
// chronological order, e.g. 2026-09-22T14-05-33-123Z. The trailing random
// suffix keeps two sinks constructed within the same millisecond (e.g. two
// `run` processes kicked off back to back, or two sinks in one process)
// from colliding on the same filename.
function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
}

function defaultFilePath(dir, agentName) {
  const name = 'run-' + (agentName ? agentName + '-' : '') + timestampForFilename() + '.md';
  return path.join(dir, '.agent-test-kit-results', name);
}

function createMarkdownSink(options) {
  const opts = options || {};
  const filePath = opts.filePath || defaultFilePath(opts.dir || process.cwd(), opts.agentName);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let headerWrittenForThisProcess = false;

  return {
    filePath,
    describe() { return 'Markdown report: ' + filePath; },

    async write(row) {
      let chunk = '';
      if (!headerWrittenForThisProcess) {
        headerWrittenForThisProcess = true;
        chunk +=
          '\n## Run ' + row.runId + ' — ' + row.agentName + ' — ' + row.timestamp + '\n\n' +
          '| Test ID | Category | Metric | Score | Pass | Evaluator | Notes | Recommendation |\n' +
          '|---|---|---|---|---|---|---------------------------------------|---------------------------------------|\n';
      }
      chunk +=
        '| ' + escapeCell(row.testId) +
        ' | ' + escapeCell(row.category) +
        ' | ' + escapeCell(row.metric) +
        ' | ' + escapeCell(row.score) +
        ' | ' + (row.pass ? '✅' : '❌') +
        ' | ' + escapeCell(row.evaluator) +
        ' | ' + escapeCell(formatNotes(row.notes)) +
        ' | ' + escapeCell(row.recommendation) +
        ' |\n';
      fs.appendFileSync(filePath, chunk, 'utf8');
    },

    async finalize(runSummary) {
      const lines = Object.keys(runSummary.byCategory).sort().map((cat) => {
        const c = runSummary.byCategory[cat];
        return cat + ' ' + c.pass + '/' + (c.pass + c.fail);
      });
      const summary =
        '\n**Summary:** ' + (runSummary.totalRun - runSummary.totalFail) + '/' + runSummary.totalRun +
        ' passed — ' + lines.join(', ') + '\n';
      fs.appendFileSync(filePath, summary, 'utf8');
    }
  };
}

module.exports = { createMarkdownSink };
