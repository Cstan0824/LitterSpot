export function initialBinPlacementLookback() {
  return "";
}

export function lookbackFromSnapshot(snapshot: { requestedLookbackDays: number }) {
  const days = Number(snapshot.requestedLookbackDays);
  return Number.isInteger(days) && days >= 2 && days <= 3660 ? String(days) : "30";
}
