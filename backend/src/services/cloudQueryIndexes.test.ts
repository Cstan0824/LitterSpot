import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexes = JSON.parse(readFileSync(new URL("../../../firestore.indexes.json", import.meta.url), "utf8")).indexes;
function covers(collection: string, equalities: string[], order: string) {
  return indexes.some((index: any) => index.collectionGroup === collection && index.queryScope === "COLLECTION"
    && index.fields.length === equalities.length + 1
    && equalities.every(field => index.fields.slice(0, -1).some((entry: any) => entry.fieldPath === field && entry.order === "ASCENDING"))
    && index.fields.at(-1).fieldPath === order && index.fields.at(-1).order === "DESCENDING");
}

describe("deployed indexes for authenticated cloud lists", () => {
  it.each([false, true])("covers Cleaner Work pagination with status filter %s", status => {
    expect(covers("workOrders", ["siteId", "schemaVersion", "assignedCleanerId", ...(status ? ["status"] : [])], "updatedAt")).toBe(true);
  });
  it.each([[], ["siteId"], ["actorUid"], ["siteId", "actorUid"]].map(filters => ({ filters })))("covers Superadmin Audit filters $filters", ({ filters }) => {
    expect(covers("auditEvents", ["actorRole", ...filters], "occurredAt")).toBe(true);
  });
});
