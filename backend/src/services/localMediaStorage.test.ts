import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  cleanupStaleTemporaryMedia,
  discardStagedMedia,
  inspectMedia,
  inspectMediaIntegrity,
  inspectStagedMedia,
  moveStagedMedia,
  resolveStorageKey,
  resolveTemporaryMediaName,
  temporaryMediaName,
  writeMedia,
} from "./localMediaStorage.js";

describe("local media storage paths", () => {
  const root = "/tmp/litterspot-storage-test";

  it("resolves generated keys under the configured root", () => {
    expect(resolveStorageKey("media/abc/original.jpg", root)).toBe(`${root}/media/abc/original.jpg`);
  });

  it.each(["../secret", "media/../../secret", "/tmp/secret", "media\\secret.jpg", ""])("rejects unsafe key %s", (key) => {
    expect(() => resolveStorageKey(key, root)).toThrow("Invalid storage key");
  });

  it("atomically writes and inspects a generated media key", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "litterspot-storage-"));
    try {
      const contents = Buffer.from("test image bytes");
      const filePath = await writeMedia("media/id/original.jpg", contents, temporaryRoot);
      expect(await readFile(filePath)).toEqual(contents);
      expect((await inspectMedia("media/id/original.jpg", temporaryRoot)).byteSize).toBe(contents.length);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("accepts only direct-child staging names", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "litterspot-staging-"));
    try {
      const stagedPath = join(temporaryRoot, "safe.upload");
      expect(temporaryMediaName(stagedPath, temporaryRoot)).toBe("safe.upload");
      expect(resolveTemporaryMediaName("safe.upload", temporaryRoot)).toBe(stagedPath);
      expect(() => temporaryMediaName(join(temporaryRoot, "nested", "file.upload"), temporaryRoot)).toThrow("direct child");
      expect(() => resolveTemporaryMediaName("../escape.upload", temporaryRoot)).toThrow("Invalid temporary media name");
      expect(() => resolveTemporaryMediaName("nested/file.upload", temporaryRoot)).toThrow("Invalid temporary media name");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("moves a staged upload without overwriting and verifies its integrity", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "litterspot-staging-"));
    const storageRoot = await mkdtemp(join(tmpdir(), "litterspot-media-"));
    try {
      const contents = Buffer.from("accepted video bytes");
      const sha256 = createHash("sha256").update(contents).digest("hex");
      await writeFile(join(temporaryRoot, "first.upload"), contents);
      expect(await inspectStagedMedia("first.upload", contents.length, sha256, temporaryRoot)).toMatchObject({
        byteSize: contents.length,
      });

      const storedPath = await moveStagedMedia("first.upload", "media/id/original.mp4", temporaryRoot, storageRoot);
      expect(await readFile(storedPath)).toEqual(contents);
      await expect(stat(join(temporaryRoot, "first.upload"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await inspectMediaIntegrity("media/id/original.mp4", contents.length, sha256, storageRoot)).toMatchObject({
        byteSize: contents.length,
      });

      await writeFile(join(temporaryRoot, "second.upload"), Buffer.from("different"));
      await expect(moveStagedMedia("second.upload", "media/id/original.mp4", temporaryRoot, storageRoot))
        .rejects.toThrow("already exists");
      expect(await readFile(storedPath)).toEqual(contents);
      await discardStagedMedia("second.upload", temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("removes only stale unreferenced staging files", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "litterspot-staging-"));
    try {
      await Promise.all([
        writeFile(join(temporaryRoot, "delete.upload"), "old"),
        writeFile(join(temporaryRoot, "preserve.upload"), "old"),
        writeFile(join(temporaryRoot, "recent.upload"), "new"),
        mkdir(join(temporaryRoot, "nested")),
      ]);
      const oldDate = new Date(1_000);
      await Promise.all([
        utimes(join(temporaryRoot, "delete.upload"), oldDate, oldDate),
        utimes(join(temporaryRoot, "preserve.upload"), oldDate, oldDate),
      ]);
      const deleted = await cleanupStaleTemporaryMedia({
        temporaryRoot,
        olderThanMillis: 5_000,
        nowMillis: 10_000,
        preserveNames: new Set(["preserve.upload"]),
      });
      expect(deleted).toBe(1);
      await expect(stat(join(temporaryRoot, "delete.upload"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await stat(join(temporaryRoot, "preserve.upload"))).isFile()).toBe(true);
      expect((await stat(join(temporaryRoot, "recent.upload"))).isFile()).toBe(true);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
