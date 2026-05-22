/**
 * pMapLimit — run an async mapper over `items` with bounded concurrency.
 *
 * - Preserves input order in the result array.
 * - Rejects on first error, matching `Promise.all` semantics. Use
 *   `pMapLimitSettled` (or `Promise.allSettled` on the result) if you need to
 *   tolerate per-item failures.
 */
export async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/**
 * Variant of pMapLimit that resolves with PromiseSettledResult entries — does
 * not short-circuit on the first rejection.
 */
export async function pMapLimitSettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i], i);
        out[i] = { status: 'fulfilled', value };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}
