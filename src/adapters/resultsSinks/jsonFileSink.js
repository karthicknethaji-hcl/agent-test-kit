// Default persistent sink — zero external dependencies. Appends every
// result row (the same canonical shape every sink receives, see
// docs/CONTRACT.md "Result row schema") as one NDJSON line to a local file,
// so `agent-test-kit run` persists results out of the box with no database
// to stand up first.
const fs = require('fs');
const path = require('path');

function createJsonFileSink(options) {
  const opts = options || {};
  const filePath = opts.filePath || path.join(process.cwd(), '.agent-test-kit-results.ndjson');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  return {
    filePath,
    async write(row) {
      fs.appendFileSync(filePath, JSON.stringify(row) + '\n', 'utf8');
    }
  };
}

module.exports = { createJsonFileSink };
