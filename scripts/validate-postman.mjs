import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const postmanRoot = join(root, "postman");
const files = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name.endsWith(".yaml")) files.push(path);
  }
}

function validateScripts(value, file) {
  if (Array.isArray(value)) return value.forEach((item) => validateScripts(item, file));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "code" && typeof item === "string") {
      try {
        // Compile only; Postman's `pm` runtime is intentionally not executed.
        new Function("pm", item);
      } catch (error) {
        throw new Error(`${relative(root, file)} contains invalid Postman JavaScript: ${error.message}`);
      }
    } else validateScripts(item, file);
  }
}

await walk(postmanRoot);
for (const file of files.sort()) {
  let document;
  try {
    document = parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${relative(root, file)} contains invalid YAML: ${error.message}`);
  }
  validateScripts(document, file);
}

console.log(`Validated ${files.length} canonical Postman YAML resources and embedded scripts.`);
