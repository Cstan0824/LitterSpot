import { readFile } from "node:fs/promises";
import { basename } from "node:path";
const args = process.argv.slice(2);
const arg = key => args[args.indexOf(key) + 1];
const camera = args.includes("--camera") && arg("--camera");
const scene = args.includes("--scene") && arg("--scene");
const token = process.env.LITTERSPOT_DEMO_TOKEN;
if (!camera || !scene || !token) throw new Error("Use --camera <id> --scene <key> and set LITTERSPOT_DEMO_TOKEN to a Supervisor ID token. Optional --upload <video-path> registers a scene.");
const base = process.env.LITTERSPOT_API_URL ?? "http://127.0.0.1:3000";
let path = `/api/development/cameras/${encodeURIComponent(camera)}/scenes/${encodeURIComponent(scene)}`;
let body;
if (args.includes("--upload")) {
  const file = arg("--upload"); body = new FormData();
  body.set("video", new Blob([await readFile(file)], { type: file.toLowerCase().endsWith(".webm") ? "video/webm" : file.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4" }), basename(file));
} else path += "/select";
const response = await fetch(new URL(path, base), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
console.log(await response.text()); if (!response.ok) process.exitCode = 1;
