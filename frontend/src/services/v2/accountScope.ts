export type AccountScopedCleanup = () => void;

export class AccountScopeRegistry {
  private uid: string | null = null;
  private readonly cleanups = new Set<AccountScopedCleanup>();

  register(cleanup: AccountScopedCleanup) {
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  transition(nextUid: string | null) {
    if (this.uid === nextUid) return false;
    this.clear();
    this.uid = nextUid;
    return true;
  }

  clear() {
    for (const cleanup of [...this.cleanups]) {
      try {
        cleanup();
      } catch {
        // One stale listener must not prevent the remaining account data and
        // object URLs from being released.
      }
    }
  }

  currentUid() {
    return this.uid;
  }
}

export const accountScopeRegistry = new AccountScopeRegistry();

export const registerAccountScopedCleanup = (cleanup: AccountScopedCleanup) => accountScopeRegistry.register(cleanup);
export const transitionAccountScope = (uid: string | null) => accountScopeRegistry.transition(uid);
export const clearAccountScopedState = () => accountScopeRegistry.clear();

export function createAccountScopedCache<K, V>() {
  const values = new Map<K, V>();
  const unregister = registerAccountScopedCleanup(() => values.clear());
  return {
    get: (key: K) => values.get(key),
    set: (key: K, value: V) => values.set(key, value),
    delete: (key: K) => values.delete(key),
    clear: () => values.clear(),
    dispose: () => { values.clear(); unregister(); },
  };
}
