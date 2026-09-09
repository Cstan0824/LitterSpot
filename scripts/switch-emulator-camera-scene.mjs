const scene = process.argv[2];
const allowedScenes = new Set(["clean", "dirty"]);

if (!allowedScenes.has(scene)) {
  throw new Error("Choose a scene: npm run demo:scene:clean or npm run demo:scene:dirty");
}

const apiUrl = new URL(process.env.LITTERSPOT_API_URL ?? "http://127.0.0.1:3000");
const authUrl = new URL(process.env.LITTERSPOT_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9199");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (apiUrl.protocol !== "http:" || authUrl.protocol !== "http:" || !loopbackHosts.has(apiUrl.hostname) || !loopbackHosts.has(authUrl.hostname)) {
  throw new Error("Demo scene shortcuts only work with loopback API and Firebase Auth emulator URLs.");
}

const cameraId = process.env.LITTERSPOT_DEMO_CAMERA_ID ?? "0q4vBxM6XjVAa4mHnAL2";
const sceneKey = scene === "clean"
  ? process.env.LITTERSPOT_DEMO_CLEAN_SCENE ?? "clean-v2"
  : process.env.LITTERSPOT_DEMO_DIRTY_SCENE ?? "dirty-v2";
const email = process.env.LITTERSPOT_DEMO_ROOT_EMAIL ?? "root@sunway-test.com";
const password = process.env.LITTERSPOT_DEMO_ROOT_PASSWORD ?? "password123";

async function responseBody(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { error: text || `HTTP ${response.status}` }; }
}

let login;
try {
  login = await fetch(new URL("/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator", authUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
} catch {
  throw new Error("Firebase Auth emulator is not running. Start the app with npm run start:emulator.");
}

const loginBody = await responseBody(login);
if (!login.ok || typeof loginBody.idToken !== "string") {
  throw new Error(`Emulator Root login failed: ${loginBody.error?.message ?? loginBody.error ?? login.status}`);
}

let selected;
try {
  selected = await fetch(new URL(`/api/development/cameras/${encodeURIComponent(cameraId)}/scenes/${encodeURIComponent(sceneKey)}/select`, apiUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${loginBody.idToken}` },
  });
} catch {
  throw new Error("LitterSpot API is not running. Start the app with npm run start:emulator.");
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
