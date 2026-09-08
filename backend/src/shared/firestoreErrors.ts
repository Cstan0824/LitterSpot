export function firestoreErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = error as Record<string, any>;
  return value.code ?? value.status ?? value.response?.status ?? value.response?.data?.error?.code ?? null;
}

export function isFirestoreQuotaError(error: unknown) {
  const code = firestoreErrorCode(error);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === 8 || code === "8" || code === 429 || code === "429" || code === "RESOURCE_EXHAUSTED"
    || /RESOURCE_EXHAUSTED|quota exceeded/i.test(message);
}

export function safeFirestoreError(error: unknown) {
  return {
    errorCode: String(firestoreErrorCode(error) ?? "unknown"),
    quotaExceeded: isFirestoreQuotaError(error),
  };
}
