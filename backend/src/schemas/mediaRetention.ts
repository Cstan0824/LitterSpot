import { z } from "zod";

export const MIN_MEDIA_RETENTION_DAYS = 7;
export const MAX_MEDIA_RETENTION_DAYS = 3_650;
export const DEFAULT_MEDIA_RETENTION_DAYS = 30;
export const MAX_MEDIA_RETENTION_PAGE_SIZE = 100;
export const DEFAULT_MEDIA_RETENTION_PAGE_SIZE = 50;

export const mediaRetentionOptionsSchema = z.object({
  execute: z.boolean().default(false),
  cutoffDays: z.number().int()
    .min(MIN_MEDIA_RETENTION_DAYS)
    .max(MAX_MEDIA_RETENTION_DAYS)
    .default(DEFAULT_MEDIA_RETENTION_DAYS),
  pageSize: z.number().int()
    .min(1)
    .max(MAX_MEDIA_RETENTION_PAGE_SIZE)
    .default(DEFAULT_MEDIA_RETENTION_PAGE_SIZE),
}).strict();

export type MediaRetentionOptions = z.infer<typeof mediaRetentionOptionsSchema>;

function readNumericArgument(arguments_: string[], index: number, name: string) {
  const argument = arguments_[index]!;
  const inlineValue = argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : null;
  if (inlineValue !== null) return { value: inlineValue, consumed: 1 };
  const next = arguments_[index + 1];
  if (next === undefined || next.startsWith("--")) throw new Error(`${name} requires a value.`);
  return { value: next, consumed: 2 };
}

export function parseMediaRetentionArguments(arguments_: string[]) {
  let execute = false;
  let executionModeSeen = false;
  let cutoffDays: number | undefined;
  let pageSize: number | undefined;

  for (let index = 0; index < arguments_.length;) {
    const argument = arguments_[index]!;
    if (argument === "--execute" || argument === "--dry-run") {
      if (executionModeSeen) throw new Error("Specify at most one of --execute or --dry-run.");
      execute = argument === "--execute";
      executionModeSeen = true;
      index += 1;
      continue;
    }
    if (argument === "--cutoff-days" || argument.startsWith("--cutoff-days=")) {
      if (cutoffDays !== undefined) throw new Error("--cutoff-days may only be specified once.");
      const parsed = readNumericArgument(arguments_, index, "--cutoff-days");
      cutoffDays = Number(parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (argument === "--page-size" || argument.startsWith("--page-size=")) {
      if (pageSize !== undefined) throw new Error("--page-size may only be specified once.");
      const parsed = readNumericArgument(arguments_, index, "--page-size");
      pageSize = Number(parsed.value);
      index += parsed.consumed;
      continue;
    }
    throw new Error(`Unknown media-retention argument: ${argument}`);
  }

  return mediaRetentionOptionsSchema.parse({ execute, cutoffDays, pageSize });
}
