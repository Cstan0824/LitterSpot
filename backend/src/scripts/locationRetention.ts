import { runLocationHistoryRetention } from "../services/locationRetentionService.js";

const arguments_ = process.argv.slice(2);
const execute = arguments_.includes("--execute");
if (arguments_.some((item) => !["--execute", "--dry-run"].includes(item))) throw new Error("Use --dry-run or --execute.");
if (arguments_.includes("--execute") && arguments_.includes("--dry-run")) throw new Error("Choose one retention mode.");
const result = await runLocationHistoryRetention({ execute, pageSize: 100 });
console.log(JSON.stringify(result, null, 2));
if (!execute) console.log("Dry run only. Use --execute only under the documented privacy-retention procedure.");
