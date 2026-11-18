"use strict";
const { fs, path, string, integer, boolean, hash, readBytes, decodeText, atomicWrite } = require("./common");
const projects = require("./projects");
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_OUTPUT = 65536;
const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];

async function read(args, ctx) {
  const file = await projects.resolve(args.project, args.path, ctx);
  const { bytes } = await readBytes(file, MAX_TEXT);
  const lines = linesOf(decodeText(bytes));
  const start = integer(args.start_line, 1, 1, Number.MAX_SAFE_INTEGER, "start_line");
  const count = integer(args.line_count, 200, 1, 2000, "line_count");
  let content = "", end = start - 1;
  for (let i = start - 1; i < Math.min(lines.length, start - 1 + count); i++) {
    if (Buffer.byteLength(content) + Buffer.byteLength(lines[i]) > MAX_OUTPUT) break;
    content += lines[i]; end = i + 1;
  }
  if (start <= lines.length && end < start) throw new Error("This line exceeds 64 KiB; use PowerShell to read a smaller segment.");
  return { path: file, sha256: hash(bytes), total_lines: lines.length, start_line: start,
    end_line: end, content, more: end < lines.length, next_start_line: end < lines.length ? end + 1 : null };
}

// Shared across copies of this module loaded for separate AnythingLLM tools.
// Serializes this plugin's writes; expected_sha256 also detects external edits
// made before the check. It is not an OS-wide lock against other applications.
const lockKey = Symbol.for("AnythingLLM-made-useful.file-locks");
const locks = globalThis[lockKey] ||= new Map();
async function withLock(file, fn) {
  const key = process.platform === "win32" ? file.toLowerCase() : file;
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}
function checkHash(expected, bytes) {
  if (expected !== undefined && expected !== null && expected !== "") {
    if (!/^[a-fA-F0-9]{64}$/.test(string(expected, "expected_sha256"))) throw new Error("expected_sha256 must be a SHA-256 hex digest.");
    if (hash(bytes) !== expected.toLowerCase()) throw new Error("File changed since it was read (SHA-256 mismatch). Read it again before writing.");
  }
}
async function target(args, ctx) {
  const requested = await projects.resolve(args.project, args.path, ctx);
  try { return await fs.realpath(requested); } // preserve existing symlinks/junctions
  catch (e) { if (e.code === "ENOENT") return requested; throw e; }
}
async function write(args, ctx) {
  const content = string(args.content, "content", { empty: true });
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_TEXT) throw new Error("Content exceeds 8 MiB.");
  const overwrite = boolean(args.overwrite, false, "overwrite");
  const createParents = boolean(args.create_parents, true, "create_parents");
  const file = await target(args, ctx);
  return withLock(file, async () => {
    if (createParents) await fs.mkdir(path.dirname(file), { recursive: true });
    let current;
    try { current = await readBytes(file, MAX_TEXT); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current) {
      if (!overwrite) throw new Error("File already exists. Set overwrite=true deliberately, preferably with expected_sha256 from read_file.");
      checkHash(args.expected_sha256, current.bytes);
      await atomicWrite(file, bytes, current.stat.mode);
    } else {
      if (args.expected_sha256) throw new Error("File no longer exists; expected_sha256 cannot be satisfied.");
      await fs.writeFile(file, bytes, { flag: "wx" });
    }
    return { path: file, bytes_written: bytes.length, sha256: hash(bytes) };
  });
}
async function edit(args, ctx) {
  const oldText = string(args.old_text, "old_text", { empty: true });
  if (!oldText.length) throw new Error("old_text must not be empty.");
  const newText = string(args.new_text, "new_text", { empty: true });
  const expected = integer(args.expected_occurrences, 1, 1, 100000, "expected_occurrences");
  const file = await target(args, ctx);
  return withLock(file, async () => {
    const { bytes, stat } = await readBytes(file, MAX_TEXT);
    checkHash(args.expected_sha256, bytes);
    const text = decodeText(bytes);
    const parts = text.split(oldText);
    if (parts.length - 1 !== expected) throw new Error(`Expected ${expected} exact occurrence(s), found ${parts.length - 1}. File was not changed. Preserve the file's CRLF/LF line endings in old_text.`);
    const output = Buffer.from(parts.join(newText), "utf8");
    if (output.length > MAX_TEXT) throw new Error("Edited file would exceed 8 MiB.");
    await atomicWrite(file, output, stat.mode);
    return { path: file, replacements: expected, sha256: hash(output), bytes_written: output.length };
  });
}
async function list(args, ctx) {
  const directory = await projects.resolve(args.project, args.path || ".", ctx);
  const depth = integer(args.depth, 1, 1, 8, "depth");
  const limit = integer(args.limit, 500, 1, 5000, "limit");
  const entries = []; let truncated = false;
  async function visit(dir, remaining) {
    const handle = await fs.opendir(dir);
    for await (const item of handle) {
      if (entries.length >= limit) { truncated = true; break; }
      const full = path.join(dir, item.name);
      entries.push({ path: path.relative(directory, full), type: item.isSymbolicLink() ? "link" : item.isDirectory() ? "directory" : item.isFile() ? "file" : "other" });
      // Do not recurse through symlinks/junctions or loops.
      if (item.isDirectory() && !item.isSymbolicLink() && remaining > 1) await visit(full, remaining - 1);
      if (truncated) break;
    }
  }
  await visit(directory, depth);
  return { directory, entries, truncated };
}
async function search(args, ctx) {
  const directory = await projects.resolve(args.project, args.path || ".", ctx);
  const text = args.text === undefined ? "" : string(args.text, "text", { empty: true });
  const name = args.name_contains === undefined ? "" : string(args.name_contains, "name_contains", { empty: true });
  if (!text && !name) throw new Error("Specify text or name_contains (literal substrings).");
  const insensitive = boolean(args.ignore_case, true, "ignore_case");
  const normalize = (s) => insensitive ? s.toLowerCase() : s;
  const needle = normalize(text), filename = normalize(name);
  const limit = integer(args.limit, 100, 1, 1000, "limit");
  const matches = [], skips = { unreadable_or_non_utf8: 0, excluded_directories: 0 };
  let visited = 0, truncated = false;
  const excluded = new Set([".git", "node_modules", ".venv", "venv", "dist", ".next"]);
  async function visit(dir, depth) {
    if (depth > 20) { truncated = true; return; }
    const handle = await fs.opendir(dir);
    for await (const item of handle) {
      if (++visited > 10000 || matches.length >= limit) { truncated = true; break; }
      const full = path.join(dir, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (excluded.has(item.name)) { skips.excluded_directories++; continue; }
        try { await visit(full, depth + 1); } catch { skips.unreadable_or_non_utf8++; }
      } else if (item.isFile() && normalize(item.name).includes(filename)) {
        if (!text) matches.push({ path: full });
        else {
          try {
            const { bytes } = await readBytes(full, 1024 * 1024);
            const lines = linesOf(decodeText(bytes));
            for (let i = 0; i < lines.length && matches.length < limit; i++) {
              if (normalize(lines[i]).includes(needle)) matches.push({ path: full, line: i + 1, text: lines[i].replace(/[\r\n]+$/, "").slice(0, 2000) });
            }
          } catch { skips.unreadable_or_non_utf8++; }
        }
      }
      if (visited > 10000 || matches.length >= limit) { truncated = true; break; }
    }
  }
  await visit(directory, 0);
  return { directory, matches, truncated, skipped: skips, excluded_directories: [...excluded] };
}
async function image(args, ctx) {
  if (typeof ctx.host?.super?.addToolAttachment !== "function") throw new Error("This AnythingLLM version does not expose addToolAttachment. Update AnythingLLM Desktop to enable model image viewing.");
  const file = await projects.resolve(args.project, args.path, ctx);
  const { bytes } = await readBytes(file, 8 * 1024 * 1024);
  let mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = "image/png";
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = "image/jpeg";
  else if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))) mime = "image/gif";
  else if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") mime = "image/webp";
  else throw new Error("Unsupported image signature. Use PNG, JPEG, GIF or WebP (up to 8 MiB). Convert SVG/BMP/other formats first.");
  ctx.host.super.addToolAttachment({ name: path.basename(file), mime, contentString: `data:${mime};base64,${bytes.toString("base64")}` });
  return { path: file, mime, attached: true, message: "Image attached to the model's next turn. Interpretation requires a vision-capable model/provider." };
}
module.exports = { read, write, edit, list, search, image };
