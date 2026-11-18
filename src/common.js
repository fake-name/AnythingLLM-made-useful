"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");

function string(value, name, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.includes("\0"))
    throw new Error(`${name} must be ${empty ? "a" : "a nonempty"} string without NUL characters.`);
  return value;
}
function integer(value, fallback, min, max, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
function boolean(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}
function expand(value) {
  value = string(value, "directory");
  if (value === "~") return os.homedir();
  if (/^~[\\/]/.test(value)) value = path.join(os.homedir(), value.slice(2));
  return value.replace(/%([^%]+)%/g, (match, key) => process.env[key] ?? match);
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function readJson(file, fallback) {
  try { return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "")); }
  catch (error) { if (error.code === "ENOENT" && fallback !== undefined) return fallback; throw error; }
}
async function atomicWrite(file, bytes, mode) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, bytes, { flag: "wx", mode: mode ?? 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
async function writeJson(file, object) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify(object, null, 2) + "\n");
}
async function readBytes(file, limit) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Expected a regular file.");
    if (stat.size > limit) throw new Error(`File exceeds the ${limit}-byte limit for this tool. Use a shell command for larger files.`);
    // Read at most limit + 1 even if another process grows the file after stat().
    const chunks = []; let total = 0;
    while (total <= limit) {
      const buffer = Buffer.alloc(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead)); total += bytesRead;
    }
    if (total > limit) throw new Error(`File grew beyond the ${limit}-byte limit while reading.`);
    return { bytes: Buffer.concat(chunks), stat };
  } finally { await handle.close(); }
}
function decodeText(bytes) {
  if (bytes.includes(0)) throw new Error("This is not a UTF-8 text file. Use view_image for images, or PowerShell for other encodings/binary files.");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("Invalid UTF-8. Convert the file explicitly with PowerShell before editing it as text."); }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = { fs, path, string, integer, boolean, expand, hash, readJson, writeJson, atomicWrite, readBytes, decodeText, delay };
