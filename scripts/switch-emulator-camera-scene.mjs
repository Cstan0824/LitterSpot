import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

const scene = process.argv[2];
const allowedScenes = new Set(["clean", "dirty"]);

if (!allowedScenes.has(scene)) {
  throw new Error("Choose a scene: npm run demo:scene:clean or npm run demo:scene:dirty");
}

const apiUrl = new URL(process.env.LITTERSPOT_API_URL ?? "http://127.0.0.1:3000");
const authUrl = new URL(process.env.LITTERSPOT_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9199");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (apiUrl.protocol !== "http:" || !loopbackHosts.has(apiUrl.hostname) || authUrl.protocol !== "http:" || !loopbackHosts.has(authUrl.hostname)) {
  throw new Error("Scene shortcuts require the local Node API and a loopback emulator URL.");
}

const emulatorAvailable = await new Promise(done => {
  const socket = createConnection({ host: authUrl.hostname, port: Number(authUrl.port || 80) });
  socket.setTimeout(1000); socket.once("connect", () => { socket.destroy(); done(true); });
  socket.once("error", () => done(false)); socket.once("timeout", () => { socket.destroy(); done(false); });
});
const mode = process.env.LITTERSPOT_AUTH_MODE ?? (emulatorAvailable ? "emulator" : "cloud");
if (!["emulator", "cloud"].includes(mode)) throw new Error("LITTERSPOT_AUTH_MODE must be emulator or cloud.");
let loginUrl;
if (mode === "emulator") loginUrl = new URL("/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator", authUrl);
else {
  const configuration = readFileSync(new URL("../frontend/.env.local", import.meta.url), "utf8");
  const apiKey = process.env.LITTERSPOT_FIREBASE_WEB_API_KEY ?? configuration.split(/\r?\n/).find(line => line.startsWith("VITE_FIREBASE_API_KEY="))?.slice("VITE_FIREBASE_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
  if (!apiKey) throw new Error("The cloud Firebase web API key is missing from frontend/.env.local.");
  loginUrl = new URL(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`);
}

const cameraId = process.env.LITTERSPOT_DEMO_CAMERA_ID ?? "0q4vBxM6XjVAa4mHnAL2";
const sceneKey = scene === "clean"
  ? process.env.LITTERSPOT_DEMO_CLEAN_SCENE ?? "clean"
  : process.env.LITTERSPOT_DEMO_DIRTY_SCENE ?? "dirty";
const email = process.env.LITTERSPOT_DEMO_ROOT_EMAIL ?? "root@sunway-test.com";
const password = process.env.LITTERSPOT_DEMO_ROOT_PASSWORD ?? "password123";

async function responseBody(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { error: text || `HTTP ${response.status}` }; }
}

let login;
try {
  login = await fetch(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
} catch {
  throw new Error("Firebase Authentication is unavailable. Check the selected cloud or emulator connection.");
}

const loginBody = await responseBody(login);
if (!login.ok || typeof loginBody.idToken !== "string") {
  throw new Error(`Root login failed: ${loginBody.error?.message ?? loginBody.error ?? login.status}`);
}

let selected;
try {
  selected = await fetch(new URL(`/api/development/cameras/${encodeURIComponent(cameraId)}/scenes/${encodeURIComponent(sceneKey)}/select`, apiUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${loginBody.idToken}` },
  });
} catch {
  throw new Error("LitterSpot API is not running. Start the cloud app or use npm run start:emulator.");
}

const selectedBody = await responseBody(selected);
if (!selected.ok) {
  const detail = selectedBody.error ?? selected.status;
  const hint = detail === "Scene does not match this Camera Registration."
    ? " Re-register the clean and dirty scenes after changing Camera regions."
    : "";
  throw new Error(`Scene switch failed: ${detail}${hint}`);
}

console.log(`WPLR CAM1 switched underground to ${scene.toUpperCase()}.`);
console.log(`Playback generation: ${selectedBody.generation}`);
