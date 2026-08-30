import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Index = {
  collectionGroup: string;
  fields: Array<{ fieldPath: string; order?: string }>;
};

const indexFile = fileURLToPath(new URL("../../../firestore.indexes.json", import.meta.url));
const indexes = (JSON.parse(readFileSync(indexFile, "utf8")) as { indexes: Index[] }).indexes;

function hasAuditIndex(fields: Array<[string, "ASCENDING" | "DESCENDING"]>) {
  return indexes.some((index) => index.collectionGroup === "auditEvents"
    && index.fields.length === fields.length
    && index.fields.every((field, position) => field.fieldPath === fields[position][0] && field.order === fields[position][1]));
}

describe("Firestore V2 audit indexes", () => {
  it("keeps every Audit Event query used by Root and Superadmin APIs deployable", () => {
    expect(hasAuditIndex([["siteId", "ASCENDING"], ["occurredAt", "DESCENDING"]])).toBe(true);
    expect(hasAuditIndex([["actorUid", "ASCENDING"], ["occurredAt", "DESCENDING"]])).toBe(true);
    expect(hasAuditIndex([["siteId", "ASCENDING"], ["actorUid", "ASCENDING"], ["occurredAt", "DESCENDING"]])).toBe(true);
  });
});
