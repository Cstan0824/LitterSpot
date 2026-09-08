const PRACTICAL_INTERVALS = [1, 2, 5, 10, 15, 20, 25, 30, 50, 100] as const;

export type SiteMapGridSummary = {
  columns: number;
  rows: number;
  totalCells: number;
};

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function recommendedSiteMapGridInterval(widthMeters: number): number | null {
  if (!isPositiveFinite(widthMeters)) return null;

  const rawInterval = widthMeters / 30;
  const practicalInterval = PRACTICAL_INTERVALS.find((interval) => interval >= rawInterval);
  if (practicalInterval) return practicalInterval;

  const magnitude = 10 ** Math.floor(Math.log10(rawInterval));
  const scaledInterval = [1, 2, 5, 10].find((multiple) => multiple * magnitude >= rawInterval);
  const interval = (scaledInterval ?? 10) * magnitude;
  return Number.isFinite(interval) ? interval : null;
}

export function siteMapGridSummary(widthMeters: number, heightMeters: number, intervalMeters: number): SiteMapGridSummary | null {
  if (![widthMeters, heightMeters, intervalMeters].every(isPositiveFinite)) return null;

  const columns = Math.ceil(widthMeters / intervalMeters);
  const rows = Math.ceil(heightMeters / intervalMeters);
  const totalCells = columns * rows;
  if (![columns, rows, totalCells].every(Number.isSafeInteger)) return null;

  return { columns, rows, totalCells };
}
