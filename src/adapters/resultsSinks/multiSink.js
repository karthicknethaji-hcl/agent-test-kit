// Fans write()/finalize() out to a list of sinks, so a repo can persist
// results to more than one destination in a single run (e.g. a Markdown
// report AND a database table) without either sink knowing the other
// exists. Each child sink still receives the exact same canonical row.
function createMultiSink(sinks) {
  if (!Array.isArray(sinks) || sinks.length === 0) {
    throw new Error('multiSink: sinks must be a non-empty array.');
  }
  return {
    describe() {
      return sinks.map((s) => (typeof s.describe === 'function' ? s.describe() : 'unnamed sink')).join('; ');
    },
    async write(row) {
      for (const sink of sinks) await sink.write(row);
    },
    async finalize(runSummary) {
      for (const sink of sinks) {
        if (typeof sink.finalize === 'function') await sink.finalize(runSummary);
      }
    }
  };
}

module.exports = { createMultiSink };
