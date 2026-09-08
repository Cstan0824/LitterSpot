import { describe, expect, it } from "vitest";
import { siteMapZoneColour } from "./siteMapZonePalette";

describe("siteMapZoneColour", () => {
  it("assigns the same colour to a Zone ID every time", () => {
    expect(siteMapZoneColour("central-lagoon-beach")).toEqual(siteMapZoneColour("central-lagoon-beach"));
  });

  it("produces identity, border, and selected-state colours without user configuration", () => {
    expect(siteMapZoneColour("kids-splash-area")).toMatchObject({
      fill: /^hsl\(\d+ \d+% \d+% \/ 0\.24\)$/,
      stroke: /^hsl\(\d+ \d+% \d+%\)$/,
      selectedStroke: /^hsl\(\d+ \d+% \d+%\)$/,
    });
  });
});
