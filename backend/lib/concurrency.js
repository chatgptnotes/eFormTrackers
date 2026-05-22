/**
 * pMapLimit(items, limit, mapper)
 *
 * Run `mapper(item, index)` over `items` with at most `limit` calls in flight.
 * Returns results in the same order as `items`. If any mapper rejects, the
 * whole call rejects (same semantics as Promise.all). Use a try/catch inside
 * `mapper` if per-item failures should be tolerated.
 */
async function pMapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

module.exports = { pMapLimit };
