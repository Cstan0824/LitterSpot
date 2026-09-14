import { describe, expect, it } from "vitest";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import { scryptSync } from "node:crypto";
import { archiveHash, archiveValue, emulatorUserForImport, restoreValue } from "./firebaseMigrationArchive.js";
describe("Firebase migration archive", () => {
  it("round-trips special types and map keys without losing timestamp precision", () => {
    const raw = { timestamp: new Timestamp(1, 123456789), bytes: Buffer.from([1, 2]), point: new GeoPoint(3, 4), kind: "timestamp", numbers: [NaN, Infinity, -Infinity], nested: { b: 2, a: 1 } };
    expect(restoreValue(archiveValue(raw), {} as any)).toEqual(raw);
    expect(archiveValue({ b: 2, a: 1 })).toEqual(archiveValue({ a: 1, b: 2 }));
  });
  it("hashes documents independently of traversal order", () => {
    const rows = [{ path: "a/1", data: archiveValue({ b: 2 }) }, { path: "a/2", data: null }];
    expect(archiveHash(rows)).toBe(archiveHash([...rows].reverse()));
  });
  it("converts emulator credentials to standard scrypt without changing the password or UID", () => {
    const user = emulatorUserForImport({ localId: "user", email: "test@example.test", salt: "salt", passwordHash: "fakeHash:salt=salt:password=a:complex=password", createdAt: "1000" });
    expect(user.uid).toBe("user");
    expect(user.passwordHash).toEqual(scryptSync("a:complex=password", user.passwordSalt!, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    expect(user.metadata?.creationTime).toBe("1970-01-01T00:00:01.000Z");
    expect(() => emulatorUserForImport({ localId: "user", salt: "salt", passwordHash: "unsupported" })).toThrow("unsupported format");
  });
});
