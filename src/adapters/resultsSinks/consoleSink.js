// Zero-config default results sink — no persistence, just what run-tests
// already prints to the console. Every sink receives the SAME canonical row
// shape (see docs/CONTRACT.md "Result row schema") regardless of where it
// writes to; this sink simply discards it, since the console summary printed
// by the runner already covers the interactive case.
function createConsoleSink() {
  return {
    async write(row) {
      // Intentionally a no-op beyond what the runner already logs per test —
      // this sink exists so "no sink configured" and "explicitly disabled
      // persistence" are the same code path, not a special case.
    }
  };
}

module.exports = { createConsoleSink };
