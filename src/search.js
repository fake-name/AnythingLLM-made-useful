"use strict";
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { fs, path, string, integer, boolean } = require("./common");
const { session } = require("./session");
const execute = promisify(execFile);
function executable(ctx) {
  return ctx.host?.runtimeArgs?.RIPGREP_PATH || (process.platform === "win32"
    ? path.resolve(__dirname, "../../../anythingllm-made-useful/bin/rg.exe") : "rg");
}
async function run(args, cwd, ctx) {
  try {
    return (await execute(executable(ctx), ["--no-config", "--color", "never", ...args], {
      cwd, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 20000
    })).stdout;
  } catch (e) {
    if (e.code === 1) return e.stdout || ""; // ripgrep: no matches
    if (e.code === "ENOENT") throw new Error("Bundled ripgrep was not found. Reinstall the Windows package, or configure RIPGREP_PATH.");
    throw new Error(`ripgrep failed: ${e.stderr || e.message}`);
  }
}
async function root(args, ctx) { return path.resolve((await session(ctx)).cwd, args.path === undefined ? "." : string(args.path, "path")); }
async function glob(args, ctx) {
  const start = Date.now(); const directory = await root(args, ctx);
  const pattern = string(args.pattern, "pattern");
  const out = await run(["--files", "--hidden", "--glob", "!.git", "--glob", pattern, "--null", "--", "."], directory, ctx);
  const names = out.split("\0").filter(Boolean);
  const entries = [];
  // Bound directory metadata work rather than launching thousands of stat calls.
  if (names.length > 100000) throw new Error("More than 100000 matches. Narrow the path or pattern.");
  for (const name of names) {
    const file = path.resolve(directory, name);
    try { entries.push({ file, mtime: (await fs.stat(file)).mtimeMs }); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  entries.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
  return { durationMs: Date.now() - start, numFiles: Math.min(entries.length, 100), filenames: entries.slice(0, 100).map(e => e.file), truncated: entries.length > 100, totalMatches: entries.length };
}
async function grep(args, ctx) {
  const target = await root(args, ctx); const cwd = (await session(ctx)).cwd;
  const pattern = string(args.pattern, "pattern", { empty: true });
  const mode = args.output_mode || "files_with_matches";
  if (!["content", "files_with_matches", "count"].includes(mode)) throw new Error("Invalid output_mode.");
  const flags = ["--hidden", "--glob", "!.git"];
  if (mode === "files_with_matches") flags.push("--files-with-matches", "--null");
  else if (mode === "count") flags.push("--count", "--with-filename");
  else {
    flags.push("--with-filename");
    if (boolean(args["-n"], true, "-n")) flags.push("--line-number");
    const context = args.context ?? args["-C"];
    if (context !== undefined) flags.push("--context", String(integer(context, 0, 0, 10000, "context")));
    for (const flag of ["-A", "-B"]) if (args[flag] !== undefined) flags.push(flag, String(integer(args[flag], 0, 0, 10000, flag)));
  }
  if (boolean(args["-o"], false, "-o")) {
    if (mode !== "content") throw new Error("-o requires output_mode=content.");
    flags.push("--only-matching");
  }
  if (boolean(args["-i"], false, "-i")) flags.push("--ignore-case");
  if (boolean(args.multiline, false, "multiline")) flags.push("--multiline", "--multiline-dotall");
  for (const name of ["glob", "type"]) if (args[name] !== undefined) flags.push(`--${name}`, string(args[name], name));
  const limit = integer(args.head_limit, 250, 0, Number.MAX_SAFE_INTEGER, "head_limit");
  const offset = integer(args.offset, 0, 0, Number.MAX_SAFE_INTEGER, "offset");
  const out = await run([...flags, "-e", pattern, "--", target], cwd, ctx);
  const lines = mode === "files_with_matches" ? out.split("\0").filter(Boolean) : out.replace(/\r?\n$/, "").split(/\r?\n/).filter(Boolean);
  const selected = []; let size = 0;
  for (const line of lines.slice(offset, limit ? offset + limit : undefined)) {
    const bytes = Buffer.byteLength(line) + 1; if (size + bytes > 262144) break;
    selected.push(line); size += bytes;
  }
  return { mode, ...(mode === "files_with_matches" ? { filenames: selected, numFiles: selected.length, totalFiles: lines.length }
    : { content: selected.join("\n"), numLines: selected.length, totalLines: lines.length }),
    appliedLimit: limit, appliedOffset: offset, truncated: offset + selected.length < lines.length };
}
module.exports = { glob, grep };
