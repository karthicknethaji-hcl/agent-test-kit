// Default persistent sink — zero external dependencies. Appends one
// human-readable Markdown section per run (a results table + a summary
// line) to a local file, so `agent-test-kit run` produces something anyone
// can skim without a database, a JSON viewer, or this package's own tooling.
//
// Uses the resultsSink.finalize(runSummary) lifecycle hook (see
// docs/CONTRACT.md "resultsSink lifecycle") to render the summary line and
// close out the table once the whole run is done — write(row) alone can't
// do that, since it only ever sees one row at a time.
const fs = require('fs');
const path = require('path');

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function createMarkdownSink(options) {
  const opts = options || {};
  const filePath = opts.filePath || path.join(process.cwd(), '.agent-test-kit-results.md');

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
          '| Test ID | Category | Metric | Pass | Score | Evaluator | Recommendation |\n' +
          '|---|---|---|---|---|---|---|\n';
      }
      chunk +=
        '| ' + escapeCell(row.testId) +
        ' | ' + escapeCell(row.category) +
        ' | ' + escapeCell(row.metric) +
        ' | ' + (row.pass ? '✅' : '❌') +
        ' | ' + escapeCell(row.score) +
        ' | ' + escapeCell(row.evaluator) +
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
