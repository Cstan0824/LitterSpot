import { chmod, mkdir, readdir, rename, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mediaRoot = join(root, ".local", "emulator-media");
const backupRoot = join(root, ".local", "emulator-media-originals", new Date().toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14));
const minimumBytes = 20_000_000;
const apply = process.argv.includes("--apply");

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (entry.isFile() && entry.name === "camera-source.mp4") files.push(path);
  }
  return files;
}

async function probe(path) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate",
    "-show_entries", "format=duration,size", "-of", "json", path,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream || !Number.isFinite(Number(data.format?.duration))) throw new Error(`Could not inspect ${path}.`);
  return {
    codec: String(stream.codec_name), width: Number(stream.width), height: Number(stream.height), frameRate: String(stream.r_frame_rate),
    duration: Number(data.format.duration), size: (await stat(path)).size,
  };
}

async function transcode(path, output) {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", path,
    "-map", "0:v:0", "-c:v", "libx264", "-preset", "medium", "-crf", "31",
    "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", output,
  ]);
}

if (!apply) {
  console.log("Dry run only. Pass --apply after reviewing the files below.");
}

const files = [];
for (const path of await collect(join(mediaRoot, "media"))) {
  if ((await stat(path)).size >= minimumBytes) files.push(path);
}
if (!files.length) {
  console.log(JSON.stringify({ status: "nothing_to_compress", mediaRoot }, null, 2));
  process.exit(0);
}

const plans = [];
for (const path of files) {
  const input = await probe(path);
  const output = `${path}.compressed-${process.pid}.tmp.mp4`;
  if (apply) await transcode(path, output);
  const outputSize = apply ? (await stat(output)).size : null;
  const outputProbe = apply ? await probe(output) : null;
  if (apply && (outputProbe.width !== input.width || outputProbe.height !== input.height || outputProbe.frameRate !== input.frameRate || Math.abs(outputProbe.duration - input.duration) > 0.25 || outputSize >= input.size)) {
    throw new Error(`Compatibility check failed for ${relative(mediaRoot, path)}.`);
  }
  plans.push({ path, input, output, outputProbe, outputSize });
}

if (!apply) {
  console.log(JSON.stringify(plans.map(({ path, input }) => ({ path: relative(mediaRoot, path), input })), null, 2));
  process.exit(0);
}

await mkdir(backupRoot, { recursive: true });
const moved = [];
try {
  for (const plan of plans) {
    const backup = join(backupRoot, relative(mediaRoot, plan.path));
    await mkdir(dirname(backup), { recursive: true });
    await rename(plan.path, backup);
    try {
      await rename(plan.output, plan.path);
      await chmod(plan.path, 0o600);
    } catch (error) {
      await rename(backup, plan.path);
      throw error;
    }
    moved.push({ ...plan, backup });
  }
} catch (error) {
  for (const plan of moved.reverse()) {
    await rename(plan.path, plan.output).catch(() => undefined);
    await rename(plan.backup, plan.path).catch(() => undefined);
  }
  throw error;
}

console.log(JSON.stringify({
  status: "complete",
  backupRoot,
  videos: moved.map(({ path, input, outputProbe, outputSize }) => ({
    path: relative(mediaRoot, path), inputBytes: input.size, outputBytes: outputSize,
    inputCodec: input.codec, outputCodec: outputProbe.codec, width: outputProbe.width, height: outputProbe.height,
    frameRate: outputProbe.frameRate, inputDurationSeconds: input.duration, outputDurationSeconds: outputProbe.duration,
  })),
}, null, 2));
