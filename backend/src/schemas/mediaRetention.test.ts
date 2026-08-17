import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEDIA_RETENTION_DAYS,
  DEFAULT_MEDIA_RETENTION_PAGE_SIZE,
  parseMediaRetentionArguments,
} from "./mediaRetention.js";

describe("media-retention command options", () => {
  it("is a dry run with conservative defaults unless execution is explicit", () => {
    expect(parseMediaRetentionArguments([])).toEqual({
      execute: false,
      cutoffDays: DEFAULT_MEDIA_RETENTION_DAYS,
      pageSize: DEFAULT_MEDIA_RETENTION_PAGE_SIZE,
    });
    expect(parseMediaRetentionArguments(["--execute", "--cutoff-days", "45", "--page-size=25"]))
      .toEqual({ execute: true, cutoffDays: 45, pageSize: 25 });
  });

  it("rejects unsafe ranges, unknown flags, duplicates, and ambiguous modes", () => {
    expect(() => parseMediaRetentionArguments(["--cutoff-days=6"])).toThrow();
    expect(() => parseMediaRetentionArguments(["--cutoff-days=3651"])).toThrow();
    expect(() => parseMediaRetentionArguments(["--page-size=101"])).toThrow();
    expect(() => parseMediaRetentionArguments(["--execute", "--dry-run"])).toThrow(/at most one/i);
    expect(() => parseMediaRetentionArguments(["--cutoff-days=30", "--cutoff-days=31"])).toThrow(/only be specified once/i);
    expect(() => parseMediaRetentionArguments(["--surprise"])).toThrow(/unknown/i);
  });
});
