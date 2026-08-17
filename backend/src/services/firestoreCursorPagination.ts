import { createHash } from "node:crypto";
import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { z } from "zod";
import { opaqueCursorSchema } from "../schemas/pagination.js";
import { HttpError } from "../shared/httpError.js";

export { opaqueCursorSchema } from "../schemas/pagination.js";

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  resource: z.string().min(1).max(80),
  order: z.object({
    field: z.string().min(1).max(80),
    value: z.string().datetime({ offset: true }),
  }).strict(),
  id: z.string().min(1).max(1500),
  query: z.string().length(64).regex(/^[a-f0-9]+$/),
}).strict();

type PageCursorContext = {
  resource: string;
  orderField: string;
  filters: Record<string, unknown>;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  paginationMode?: "cursor" | "bounded_legacy_scan";
  resultCompleteness?: "complete" | "bounded";
  scannedCount?: number;
};

function normalizedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizedValue(item)]),
    );
  }
  return value;
}

export function paginationQueryFingerprint(filters: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(normalizedValue(filters))).digest("hex");
}

export function encodePageCursor(
  context: PageCursorContext,
  orderValue: Timestamp,
  id: string,
) {
  const payload = cursorPayloadSchema.parse({
    version: 1,
    resource: context.resource,
    order: { field: context.orderField, value: orderValue.toDate().toISOString() },
    id,
    query: paginationQueryFingerprint(context.filters),
  });
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePageCursor(cursor: string, context: PageCursorContext) {
  try {
    const parsed = cursorPayloadSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.resource !== context.resource
      || parsed.order.field !== context.orderField
      || parsed.query !== paginationQueryFingerprint(context.filters)) {
      throw new Error("Cursor context mismatch.");
    }
    const orderDate = new Date(parsed.order.value);
    if (Number.isNaN(orderDate.getTime())) throw new Error("Invalid cursor timestamp.");
    return { orderValue: Timestamp.fromDate(orderDate), id: parsed.id };
  } catch {
    throw new HttpError(400, "The pagination cursor is invalid for this query.");
  }
}

function requiredOrderTimestamp(snapshot: QueryDocumentSnapshot, orderField: string) {
  const value = snapshot.get(orderField);
  if (!(value instanceof Timestamp)) {
    throw new TypeError(`Stored ${snapshot.ref.path} is missing the pagination field ${orderField}.`);
  }
  return value;
}

export async function queryCursorPage<T>(options: {
  query: Query<DocumentData>;
  resource: string;
  orderField: string;
  filters: Record<string, unknown>;
  limit: number;
  cursor?: string;
  present: (snapshot: QueryDocumentSnapshot) => T;
}): Promise<CursorPage<T>> {
  const context: PageCursorContext = {
    resource: options.resource,
    orderField: options.orderField,
    filters: options.filters,
  };
  let query = options.query
    .orderBy(options.orderField, "desc")
    .orderBy(FieldPath.documentId(), "desc");
  if (options.cursor) {
    const decoded = decodePageCursor(options.cursor, context);
    query = query.startAfter(decoded.orderValue, decoded.id);
  }
  const snapshot = await query.limit(options.limit + 1).get();
  const selected = snapshot.docs.slice(0, options.limit);
  const last = selected.at(-1);
  return {
    items: selected.map(options.present),
    nextCursor: snapshot.size > options.limit && last
      ? encodePageCursor(context, requiredOrderTimestamp(last, options.orderField), last.id)
      : null,
  };
}
