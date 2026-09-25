// Default persistent sink — zero external dependencies. Appends every
// result row (the same canonical shape every sink receives, see
// docs/CONTRACT.md "Result row schema") as one NDJSON line to a local file,
// so `agent-test-kit run` persists results out of the box with no database
// to stand up first.
//
// `filePath` (an exact file) takes priority over `resultsDir` (a directory —
// the file is named run-<timestamp>.ndjson inside it, agent-scoped when the
// caller passes the agent's own results/ folder). With neither, the legacy
// default is one global file at the repo root — kept as-is for backward
// compatibility; it accumulates rows from every agent, which is exactly why
// it's not the default once a `resultsDir` is available (see config.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createJsonFileSink(options) {
  const opts = options || {};
  let filePath = opts.filePath;
  if (!filePath) {
    filePath = opts.resultsDir
      ? path.join(opts.resultsDir, 'run-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex') + '.ndjson')
      : path.join(process.cwd(), '.agent-test-kit-results.ndjson');
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  return {
    filePath,
    describe() { return 'local NDJSON file: ' + filePath; },
    async write(row) {
      fs.appendFileSync(filePath, JSON.stringify(row) + '\n', 'utf8');
    }
  };
}

module.exports = { createJsonFileSink };
