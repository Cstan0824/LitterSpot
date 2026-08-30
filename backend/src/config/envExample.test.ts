import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("backend environment example", () => {
  it("does not override the cross-platform media directories with placeholder paths", () => {
    const examplePath = fileURLToPath(new URL("../../.env.example", import.meta.url));
    const lines = readFileSync(examplePath, "utf8").split(/\r?\n/).map((line) => line.trim());

    expect(lines.some((line) => line.startsWith("MEDIA_STORAGE_ROOT="))).toBe(false);
    expect(lines.some((line) => line.startsWith("VIDEO_UPLOAD_TEMP_ROOT="))).toBe(false);
  });
});
