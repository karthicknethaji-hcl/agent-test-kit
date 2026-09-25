// Shared plain-text table rendering for the canonical result row shape (see
// docs/CONTRACT.md "Result row schema") — used by `agent-test-kit results`
// so query output stays consistent with itself regardless of which
// query-capable sink produced the rows.
const COLUMNS = ['testId', 'agentName', 'category', 'metric', 'score', 'pass', 'evaluator', 'runId', 'timestamp'];

function cell(row, col) {
  const value = row[col];
  if (value === null || value === undefined) return '';
  if (col === 'pass') return value ? 'PASS' : 'FAIL';
  return String(value);
}

function formatRowsAsTable(rows) {
  if (!rows || rows.length === 0) return '(no rows)';

  const widths = COLUMNS.map((col) => Math.max(col.length, ...rows.map((row) => cell(row, col).length)));
  const line = (values) => values.map((v, i) => v.padEnd(widths[i])).join('  ');

  const lines = [line(COLUMNS), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (const row of rows) lines.push(line(COLUMNS.map((col) => cell(row, col))));
  return lines.join('\n');
}

module.exports = { formatRowsAsTable };
