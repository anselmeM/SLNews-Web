type Rotatable = {
  id: string;
  priority: number;
  weight: number;
};

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function nextSeed(seed: number): number {
  let value = seed || 0x9e3779b9;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

/**
 * Deterministic weighted rotation within each priority band.
 *
 * The newest campaign must not permanently starve older sold inventory. The
 * seed changes hourly, so a cached read is stable for its TTL while delivery
 * rotates over time. Priority is strict; weight only affects ties.
 */
export function rotateSponsorships<T extends Rotatable>(
  rows: T[],
  limit: number,
  seed = Math.floor(Date.now() / 3_600_000)
): T[] {
  if (limit <= 0 || rows.length === 0) return [];
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const priority = Math.max(0, Math.trunc(row.priority));
    const group = groups.get(priority) ?? [];
    group.push(row);
    groups.set(priority, group);
  }

  const selected: T[] = [];
  const priorities = [...groups.keys()].sort((a, b) => b - a);
  for (const priority of priorities) {
    const pool = [...(groups.get(priority) ?? [])];
    let random = nextSeed(seed ^ hash(`p:${priority}`));
    while (pool.length > 0 && selected.length < limit) {
      random = nextSeed(random);
      const totalWeight = pool.reduce(
        (sum, row) => sum + Math.max(1, Math.trunc(row.weight)),
        0
      );
      let ticket = random % totalWeight;
      let index = 0;
      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i];
        if (!candidate) continue;
        ticket -= Math.max(1, Math.trunc(candidate.weight));
        if (ticket < 0) {
          index = i;
          break;
        }
      }
      const picked = pool[index];
      if (picked) {
        selected.push(picked);
        pool.splice(index, 1);
      }
    }
    if (selected.length >= limit) break;
  }
  return selected;
}
