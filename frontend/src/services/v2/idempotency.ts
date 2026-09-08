function randomPart() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function operationPart(operation: string) {
  const normalized = operation.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("An idempotency operation name is required.");
  return normalized.slice(0, 48);
}

export function createIdempotencyKey(operation: string) {
  return `${operationPart(operation)}-${randomPart()}`.slice(0, 160);
}

export class MutationIdempotencyKey {
  private current: string;

  constructor(private readonly operation: string) {
    this.current = createIdempotencyKey(operation);
  }

  value() {
    return this.current;
  }

  rotate() {
    this.current = createIdempotencyKey(this.operation);
    return this.current;
  }
}
