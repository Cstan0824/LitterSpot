import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectMedia, resolveStorageKey, writeMedia } from "./localMediaStorage.js";

describe("local media storage paths", () => {
  const root = join(tmpdir(), "litterspot-storage-test");

  it("resolves generated keys under the configured root", () => {
    expect(resolveStorageKey("media/abc/original.jpg", root)).toBe(join(root, "media", "abc", "original.jpg"));
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
});
