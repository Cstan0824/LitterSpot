type ResourceLoaders<T extends Record<string, unknown>> = {
  [K in keyof T]: () => Promise<T[K]>;
};

type CacheEntry<T> = {
  value?: T;
  hasValue: boolean;
  loadedAt: number;
  invalidated: boolean;
  pending?: Promise<T>;
  pendingGeneration?: number;
  generation: number;
};

export class TimedResourceCache<T extends Record<string, unknown>> {
  private readonly entries = new Map<keyof T, CacheEntry<T[keyof T]>>();
  private readonly freshnessMs: number;
  private readonly now: () => number;
  private epoch = 0;

  constructor(
    private readonly loaders: ResourceLoaders<T>,
    options: { freshnessMs?: number; now?: () => number } = {},
  ) {
    this.freshnessMs = options.freshnessMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  read<K extends keyof T>(key: K, options: { force?: boolean } = {}): Promise<T[K]> {
    const current = this.entries.get(key) as CacheEntry<T[K]> | undefined;
    if (current?.pending && current.pendingGeneration === current.generation) return current.pending;
    if (!options.force && current?.hasValue && !current.invalidated && this.now() - current.loadedAt < this.freshnessMs) {
      return Promise.resolve(current.value as T[K]);
    }

    const entry: CacheEntry<T[K]> = current ?? { hasValue: false, loadedAt: 0, invalidated: false, generation: 0 };
    const generation = entry.generation;
    const epoch = this.epoch;
    const pending = this.loaders[key]().then((value) => {
      if (epoch !== this.epoch) throw new Error("Resource request belongs to a previous account session.");
      if (generation !== entry.generation) return this.read(key);
      entry.value = value;
      entry.hasValue = true;
      entry.loadedAt = this.now();
      entry.invalidated = false;
      return value;
    }).finally(() => {
      if (entry.pending === pending) entry.pending = undefined;
    });
    entry.pending = pending;
    entry.pendingGeneration = generation;
    this.entries.set(key, entry as CacheEntry<T[keyof T]>);
    return pending;
  }

  async readMany<K extends keyof T>(keys: readonly K[], options: { force?: boolean } = {}): Promise<Pick<T, K>> {
    const values = await Promise.all(keys.map((key) => this.read(key, options)));
    return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Pick<T, K>;
  }

  invalidate(keys: readonly (keyof T)[]) {
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        entry.invalidated = true;
        entry.generation += 1;
      }
    }
  }

  clear() {
    this.epoch += 1;
    this.entries.clear();
  }
}
