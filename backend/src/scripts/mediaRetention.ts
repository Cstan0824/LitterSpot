import { parseMediaRetentionArguments } from "../schemas/mediaRetention.js";
import { runMediaRetention } from "../services/mediaRetentionService.js";

async function main() {
  const options = parseMediaRetentionArguments(process.argv.slice(2));
  const result = await runMediaRetention(options);
  console.log(JSON.stringify(result, null, 2));
  if (!options.execute) {
    console.log("Dry run only. Stop the backend and rerun with --execute after reviewing this result and completing a coordinated backup.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
