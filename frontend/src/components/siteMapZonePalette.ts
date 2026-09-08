export type SiteMapZoneColour = { fill: string; stroke: string; selectedStroke: string };

/** Derive identity colours from the Zone ID so they remain stable without user configuration. */
export function siteMapZoneColour(zoneId: string): SiteMapZoneColour {
  let hash = 2166136261;
  for (const character of zoneId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const unsignedHash = hash >>> 0;
  const hue = unsignedHash % 360;
  const saturation = 70 + ((unsignedHash >>> 8) % 11);
  const lightness = 43 + ((unsignedHash >>> 16) % 9);
  return {
    fill: `hsl(${hue} ${saturation}% ${lightness}% / 0.24)`,
    stroke: `hsl(${hue} ${saturation}% ${Math.max(28, lightness - 10)}%)`,
    selectedStroke: `hsl(${hue} ${saturation}% ${Math.max(22, lightness - 18)}%)`,
  };
}
