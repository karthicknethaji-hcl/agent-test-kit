// Fans write()/finalize() out to a list of sinks, so a repo can persist
// results to more than one destination in a single run (e.g. a Markdown
// report AND a database table) without either sink knowing the other
// exists. Each child sink still receives the exact same canonical row.
function createMultiSink(sinks) {
  if (!Array.isArray(sinks) || sinks.length === 0) {
    throw new Error('multiSink: sinks must be a non-empty array.');
  }
  function label(sink) {
    return typeof sink.describe === 'function' ? sink.describe() : 'unnamed sink';
  }

  return {
    describe() {
      return sinks.map(label).join('; ');
    },
    // Fans out to every child that implements preflight(), skipping the
    // rest — a child with no preflight() has nothing cheap to probe. Runs
    // them concurrently (each is typically an independent network probe,
    // e.g. two Supabase-backed sinks) and isolates each child's own
    // rejection into an { ok: false, reason } entry rather than letting one
    // failing child's exception take down every other child's result (and,
    // via runCmd.js, the whole run) — preflight() is documented as never
    // throwing, and a well-behaved child sink shouldn't either, but a
    // third-party one might. Returns one { describe, ok, reason? } entry per
    // probed child so a caller can report per-sink, not just per-run.
    async preflight() {
      const probed = sinks.filter((sink) => typeof sink.preflight === 'function');
      const results = await Promise.all(probed.map((sink) =>
        Promise.resolve()
          .then(() => sink.preflight())
          .catch((e) => ({ ok: false, reason: e.message }))
      ));
      return probed.map((sink, i) => Object.assign({ describe: label(sink) }, results[i]));
    },
    async write(row) {
      for (const sink of sinks) await sink.write(row);
    },
    async finalize(runSummary) {
      for (const sink of sinks) {
        if (typeof sink.finalize === 'function') await sink.finalize(runSummary);
      }
    },
    // One entry per child sink (so a caller can print one line per sink),
    // with stats: null for children that don't track attempted/failed
    // counts, or that threw while computing them (isolated the same way as
    // preflight() above, so one misbehaving child doesn't blank out the
    // others' real stats).
    getStats() {
      return sinks.map((sink) => {
        if (typeof sink.getStats !== 'function') return { describe: label(sink), stats: null };
        try {
          return { describe: label(sink), stats: sink.getStats() };
        } catch (e) {
          return { describe: label(sink), stats: null };
        }
      });
    }
  };
}

module.exports = { createMultiSink };
