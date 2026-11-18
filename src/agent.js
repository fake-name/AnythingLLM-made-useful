"use strict";
const { fs, path, string, integer, boolean, hash, readBytes, decodeText, delay } = require("./common");
const files = require("./files");
const projects = require("./projects");
const skills = require("./skills");
const jobs = require("./jobs");
const search = require("./search");
const { session, select } = require("./session");
const running = s => ["starting", "running"].includes(s);
async function absolute(value) {
  string(value, "file_path");
  if (!path.isAbsolute(value)) throw new Error("file_path must be absolute.");
  try { return await fs.realpath(value); } catch (e) { if (e.code === "ENOENT") return path.resolve(value); throw e; }
}
const internal = file => ({ project: path.parse(file).root, path: file });
const readKey = file => process.platform === "win32" ? file.toLowerCase() : file;
async function Read(args, ctx) {
  const file = await absolute(args.file_path);
  if (args.pages !== undefined || /\.pdf$/i.test(file)) throw new Error("PDF rendering is not implemented. Convert the needed pages to PNG and Read those images, or extract text using an installed utility.");
  if (/\.(png|jpe?g|gif|webp)$/i.test(file)) return { type: "image", ...await files.image(internal(file), ctx) };
  const { bytes } = await readBytes(file, 8 * 1024 * 1024);
  const lines = decodeText(bytes).match(/[^\n]*\n|[^\n]+$/g) || [];
  const start = integer(args.offset, 1, 1, Number.MAX_SAFE_INTEGER, "offset");
  const count = integer(args.limit, 2000, 1, Number.MAX_SAFE_INTEGER, "limit");
  const cap = boolean(args.allow_large, false, "allow_large") ? 262144 : 65536;
  let content = "", size = 0, numLines = 0;
  for (let i = start - 1; i < Math.min(lines.length, start - 1 + count); i++) {
    const n = Buffer.byteLength(lines[i]); if (size + n > cap) break;
    content += lines[i]; size += n; numLines++;
  }
  if (start <= lines.length && !numLines) throw new Error("A line exceeds the output cap. Use allow_large or a shell command to read a smaller segment.");
  (await session(ctx)).reads.set(readKey(file), hash(bytes));
  return { type: "text", file: { filePath: file, content, numLines, startLine: start, totalLines: lines.length },
    truncated: start - 1 + numLines < lines.length, next_offset: start - 1 + numLines < lines.length ? start + numLines : null };
}
async function observed(file, ctx) {
  const state = await session(ctx);
  const expected = state.reads.get(readKey(file));
  const current = await readBytes(file, 8 * 1024 * 1024);
  if (!expected) throw new Error("Read this existing file before changing it.");
  if (hash(current.bytes) !== expected) throw new Error("File changed since Read. Read it again before changing it.");
  return { state, expected, text: decodeText(current.bytes) };
}
async function Write(args, ctx) {
  const file = await absolute(args.file_path); let prior;
  string(args.content, "content", { empty: true });
  try { prior = await observed(file, ctx); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const result = await files.write({ ...internal(file), content: args.content, overwrite: !!prior, expected_sha256: prior?.expected }, ctx);
  (await session(ctx)).reads.set(readKey(file), result.sha256);
  return { type: prior ? "update" : "create", filePath: file, bytes_written: result.bytes_written };
}
async function Edit(args, ctx) {
  const file = await absolute(args.file_path);
  const old = string(args.old_string, "old_string", { empty: true });
  const replacement = string(args.new_string, "new_string", { empty: true });
  if (!old || old === replacement) throw new Error("old_string must be nonempty and different from new_string.");
  const prior = await observed(file, ctx);
  const all = boolean(args.replace_all, false, "replace_all");
  const count = prior.text.split(old).length - 1;
  if (!count) throw new Error("old_string was not found. Preserve exact text and line endings.");
  const result = await files.edit({ ...internal(file), old_text: old, new_text: replacement, expected_occurrences: all ? count : 1, expected_sha256: prior.expected }, ctx);
  prior.state.reads.set(readKey(file), result.sha256);
  return { filePath: file, replacements: result.replacements, replaceAll: all };
}
function output(info) {
  return { task_id: info.job_id, state: info.state, exit_code: info.exit_code ?? null,
    stdout: info.stdout?.text || "", stderr: info.stderr?.text || "", interrupted: ["cancelled", "timed_out", "output_limit"].includes(info.state),
    stdout_file: path.join(info.directory, "stdout.log"), stderr_file: path.join(info.directory, "stderr.log"),
    output_truncated: !!(info.stdout?.more || info.stderr?.more), ...(info.error ? { error: info.error } : {}) };
}
async function command(args, ctx, shell) {
  const state = await session(ctx); const generation = state.generation;
  const background = boolean(args.run_in_background, false, "run_in_background");
  const timeout = integer(args.timeout, background ? 1800000 : 120000, 1, background ? 7200000 : 600000, "timeout");
  const request = { project: state.cwd, command: args.command, shell, timeout_ms: timeout };
  const started = await jobs.start(request, ctx);
  if (background) return { ...output(started), backgroundTaskId: started.job_id, backgroundedByUser: true };
  const info = await wait(started.job_id, timeout + 5000, ctx);
  if (!running(info.state) && state.generation === generation) {
    const cwd = (await fs.readFile(path.join(info.directory, "cwd.txt"), "utf8").catch(() => "")).replace(/^\uFEFF/, "").trim();
    if (path.isAbsolute(cwd) && (await fs.stat(cwd).catch(() => null))?.isDirectory()) await select(ctx, cwd);
  }
  return { ...output(info), ...(info.state === "timed_out" ? { timedOutAfterMs: timeout } : {}) };
}
async function wait(id, timeout, ctx) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const info = await jobs.status({ job_id: id, max_bytes: 65536 }, ctx);
    if (!running(info.state) || Date.now() >= deadline) return info;
    await delay(Math.min(200, Math.max(1, deadline - Date.now())));
  }
}
async function TaskOutput(args, ctx) {
  const block = boolean(args.block, true, "block");
  const timeout = integer(args.timeout, 30000, 0, 600000, "timeout");
  const info = await wait(string(args.task_id, "task_id"), block ? timeout : 0, ctx);
  return { retrieval_status: running(info.state) ? block ? "timeout" : "not_ready" : "success", ...output(info) };
}
async function TaskStop(args, ctx) {
  const id = string(args.task_id || args.shell_id, "task_id");
  await jobs.stop({ job_id: id }, ctx);
  const info = await wait(id, 7000, ctx);
  return { ...output(info), task_type: "local_shell", message: running(info.state) || info.state === "unknown" ? "Stop requested; confirm completion with TaskOutput." : `Task is ${info.state}.` };
}
async function SetProject(args, ctx) {
  const cwd = await projects.root(args.project, ctx); const state = await select(ctx, cwd);
  return { directory: state.cwd, persistence: state.file ? "conversation" : "agent invocation" };
}
async function ListProjects(args, ctx) { return { ...await projects.list(args, ctx), current_directory: (await session(ctx)).cwd }; }
async function ListSkills(args, ctx) { return skills.list({ project: (await session(ctx)).cwd }, ctx); }
async function Skill(args, ctx) {
  const name = string(args.skill, "skill").replace(/^\//, "");
  const found = (await ListSkills({}, ctx)).skills.find(s => s.name === name);
  if (!found) throw new Error(`Unknown skill '${name}'. Use ListSkills to discover available skills.`);
  const result = await skills.read({ project: (await session(ctx)).cwd, path: found.path }, ctx);
  const supplied = args.args === undefined ? "" : string(args.args, "args", { empty: true });
  result.instructions = result.instructions.replace(/\$ARGUMENTS/g, () => supplied);
  return { ...result, skill: name, args: supplied };
}
async function ListTasks(args, ctx) {
  const result = await jobs.list(args, ctx);
  return { tasks: result.jobs.map(j => ({ task_id: j.job_id, cwd: j.cwd, created_at: j.created_at, stdout_file: path.join(ctx.stateDir, "jobs", j.job_id, "stdout.log"), stderr_file: path.join(ctx.stateDir, "jobs", j.job_id, "stderr.log") })), truncated: result.truncated };
}
module.exports = { Read, Write, Edit, Glob: search.glob, Grep: search.grep,
  Bash: (args, ctx) => command(args, ctx, "bash"), PowerShell: (args, ctx) => command(args, ctx, "powershell"),
  TaskOutput, TaskStop, Skill, SetProject, ListProjects, RegisterProject: projects.register, ForgetProject: projects.forget, ListSkills, ListTasks };
