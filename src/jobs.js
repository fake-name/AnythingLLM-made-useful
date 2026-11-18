"use strict";
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { fs, path, string, integer, readJson, writeJson, delay } = require("./common");
const projects = require("./projects");

function jobDirectory(ctx, id) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(string(id, "job_id"))) throw new Error("Invalid job_id.");
  return path.join(ctx.stateDir, "jobs", id);
}
function powershell(ctx) {
  if (process.platform !== "win32") throw new Error("Command execution targets Windows Desktop only.");
  return ctx.host?.runtimeArgs?.POWERSHELL_PATH || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
async function gitBash(ctx) {
  const configured = ctx.host?.runtimeArgs?.GIT_BASH_PATH || process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const candidates = configured ? [configured] : [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local", "Programs", "Git", "bin", "bash.exe"),
    ...String(process.env.PATH || "").split(path.delimiter).filter(p => /[\\/]Git[\\/](cmd|bin)[\\/]?$/i.test(p)).map(p => path.resolve(p, "..", "bin", "bash.exe"))
  ];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && (await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  throw new Error("Git Bash was not found. Install Git for Windows or set GIT_BASH_PATH. Use PowerShell for native Windows commands.");
}
async function start(args, ctx) {
  const supervisor = powershell(ctx);
  const shell = args.shell || "powershell";
  const executable = shell === "bash" ? await gitBash(ctx) : supervisor;
  const command = string(args.command, "command");
  if (Buffer.byteLength(command) > 256 * 1024) throw new Error("Command script exceeds 256 KiB.");
  const cwd = await projects.resolve(args.project, args.cwd || ".", ctx);
  if (!(await fs.stat(cwd)).isDirectory()) throw new Error("cwd must be a directory.");
  const timeout = args.timeout_ms === undefined ? integer(args.timeout_seconds, 0, 0, 86400, "timeout_seconds") * 1000 : integer(args.timeout_ms, 120000, 1, 7200000, "timeout_ms");
  const jobId = randomUUID(); const directory = jobDirectory(ctx, jobId);
  await fs.mkdir(directory, { recursive: true });
  const request = { job_id: jobId, command, cwd, shell, executable, timeout_ms: timeout,
    max_log_bytes: 16 * 1024 * 1024, created_at: new Date().toISOString() };
  await writeJson(path.join(directory, "request.json"), request);
  // UTF-8 BOM is needed for non-ASCII source in Windows PowerShell 5.1.
  await fs.writeFile(path.join(directory, shell === "bash" ? "command.sh" : "command.ps1"), (shell === "bash" ? "" : "\uFEFF") + command, "utf8");
  for (const name of ["run-job.ps1", "invoke-command.ps1", "invoke-command.sh"]) await fs.copyFile(path.join(__dirname, name), path.join(directory, name));
  const supervisorLog = await fs.open(path.join(directory, "supervisor.log"), "a");
  try {
    const child = spawn(supervisor, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "launch-job.ps1"), "-JobDirectory", directory, "-SupervisorExecutable", supervisor], {
      cwd: process.env.SystemRoot || cwd, windowsHide: true, stdio: ["ignore", supervisorLog.fd, supervisorLog.fd]
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`PowerShell launcher failed (${code}). Inspect ${directory}`)));
    });
    return { job_id: jobId, state: "starting", cwd, directory, timeout_ms: timeout,
      message: "Started a background shell task. Use TaskOutput to inspect progress and TaskStop to cancel." };
  } catch (error) {
    await writeJson(path.join(directory, "result.json"), { state: "failed", error: error.message, completed_at: new Date().toISOString() });
    throw error;
  } finally { await supervisorLog.close(); }
}
async function logSlice(file, offset, count) {
  let handle;
  try { handle = await fs.open(file, "r"); }
  catch (error) { if (error.code === "ENOENT") return { text: "", next_offset: 0, size: 0, more: false }; throw error; }
  try {
    const { size } = await handle.stat();
    if (offset > size) throw new Error("Log offset is beyond the end of the file.");
    const data = Buffer.alloc(Math.min(count, size - offset));
    const { bytesRead } = await handle.read(data, 0, data.length, offset);
    const decoder = new StringDecoder("utf8");
    const text = decoder.write(data.subarray(0, bytesRead));
    // Re-read any incomplete UTF-8 sequence on the next poll.
    const pending = decoder.lastNeed ? decoder.lastTotal - decoder.lastNeed : 0;
    const next = offset + bytesRead - pending;
    return { text, next_offset: next, size, more: next < size };
  } finally { await handle.close(); }
}
async function status(args, ctx) {
  const directory = jobDirectory(ctx, args.job_id);
  const request = await readJson(path.join(directory, "request.json"));
  const result = await readJson(path.join(directory, "result.json"), null);
  const heartbeat = await readJson(path.join(directory, "heartbeat.json"), null);
  const count = integer(args.max_bytes, 32768, 4, 262144, "max_bytes");
  const stdoutOffset = integer(args.stdout_offset, 0, 0, Number.MAX_SAFE_INTEGER, "stdout_offset");
  const stderrOffset = integer(args.stderr_offset, 0, 0, Number.MAX_SAFE_INTEGER, "stderr_offset");
  const stdout = await logSlice(path.join(directory, "stdout.log"), stdoutOffset, count);
  const stderr = await logSlice(path.join(directory, "stderr.log"), stderrOffset, count);
  const age = Date.now() - Date.parse(heartbeat?.updated_at || request.created_at);
  const state = result?.state || (age > 15000 ? "unknown" : heartbeat ? "running" : "starting");
  return { job_id: args.job_id, cwd: request.cwd, created_at: request.created_at, state,
    ...(result || {}), stdout, stderr, directory,
    ...(state === "unknown" ? { message: "No recent supervisor heartbeat. The process may have been interrupted. Inspect supervisor.log; do not assume success or blindly relaunch.", supervisor_log: (await Promise.all(["supervisor.log", "supervisor.stderr.log", "supervisor.stdout.log"].map(name => fs.readFile(path.join(directory, name), "utf8").catch(() => "")))).join("\n").slice(-8192) } : {}) };
}
async function run(args, ctx) {
  const timeout = integer(args.timeout_seconds, 60, 1, 600, "timeout_seconds");
  const started = await start({ ...args, timeout_seconds: timeout }, ctx);
  const deadline = Date.now() + Math.min(timeout + 5, 605) * 1000;
  while (Date.now() < deadline) {
    const info = await status({ job_id: started.job_id, max_bytes: 32768 }, ctx);
    if (!["starting", "running"].includes(info.state)) return info;
    await delay(250);
  }
  return { ...(await status({ job_id: started.job_id }, ctx)), message: "The command has not finished reporting. Use job_status with this job_id; do not restart the command." };
}
async function stop(args, ctx) {
  const directory = jobDirectory(ctx, args.job_id);
  const current = await status({ job_id: args.job_id, max_bytes: 4 }, ctx);
  if (!["starting", "running", "unknown"].includes(current.state)) return current;
  await fs.writeFile(path.join(directory, "stop.request"), new Date().toISOString(), "utf8");
  return { job_id: args.job_id, state: "stop_requested", message: "The supervisor will stop the command tree. Poll job_status to confirm cancellation." };
}
async function list(args, ctx) {
  const dir = path.join(ctx.stateDir, "jobs");
  const limit = integer(args.limit, 50, 1, 500, "limit");
  let names;
  try { names = await fs.readdir(dir); } catch (e) { if (e.code === "ENOENT") return { jobs: [] }; throw e; }
  const jobs = [];
  for (const id of names) {
    try {
      const request = await readJson(path.join(jobDirectory(ctx, id), "request.json"));
      jobs.push({ job_id: id, cwd: request.cwd, created_at: request.created_at });
    } catch { /* Ignore incomplete directories left during startup. */ }
  }
  jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { jobs: jobs.slice(0, limit), truncated: jobs.length > limit };
}
module.exports = { start, run, status, stop, list, logSlice };
