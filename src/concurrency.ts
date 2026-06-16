/**
 * Pure concurrency helper. Runs `fn` over `items` with at most `limit` in
 * flight at once, and returns results in the original input order. Kept
 * side-effect-free so it is easy to unit test.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
