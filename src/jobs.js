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
async function start(args, ctx) {
  const executable = powershell(ctx);
  const command = string(args.command, "command");
  if (Buffer.byteLength(command) > 256 * 1024) throw new Error("Command script exceeds 256 KiB.");
  const cwd = await projects.resolve(args.project, args.cwd || ".", ctx);
  if (!(await fs.stat(cwd)).isDirectory()) throw new Error("cwd must be a directory.");
  const timeout = integer(args.timeout_seconds, 0, 0, 86400, "timeout_seconds");
  const jobId = randomUUID(); const directory = jobDirectory(ctx, jobId);
  await fs.mkdir(directory, { recursive: true });
  const request = { job_id: jobId, command, cwd, executable, timeout_seconds: timeout,
    max_log_bytes: 16 * 1024 * 1024, created_at: new Date().toISOString() };
  await writeJson(path.join(directory, "request.json"), request);
  // UTF-8 BOM is needed for non-ASCII source in Windows PowerShell 5.1.
  await fs.writeFile(path.join(directory, "command.ps1"), "\uFEFF" + command, "utf8");
  for (const name of ["run-job.ps1", "invoke-command.ps1"]) await fs.copyFile(path.join(__dirname, name), path.join(directory, name));
  const supervisorLog = await fs.open(path.join(directory, "supervisor.log"), "a");
  try {
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(directory, "run-job.ps1"), "-JobDirectory", directory], {
      // Windows PowerShell exits silently with libuv's DETACHED_PROCESS flag.
      // File-backed stdio plus unref keeps the job independent of Node's lifetime.
      cwd, detached: false, windowsHide: true, stdio: ["ignore", supervisorLog.fd, supervisorLog.fd]
    });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.once("exit", async (code, signal) => {
      try {
        if (!await readJson(path.join(directory, "result.json"), null)) {
          const details = await fs.readFile(path.join(directory, "supervisor.log"), "utf8").catch(() => "");
          await writeJson(path.join(directory, "result.json"), { state: "failed", exit_code: code,
            error: `Job supervisor exited without a result (${signal || code}). ${details.slice(-8192)}`,
            completed_at: new Date().toISOString() });
        }
      } catch { /* Status also detects stale heartbeats if the app is closing. */ }
    });
    child.unref();
    return { job_id: jobId, state: "starting", cwd, directory, timeout_seconds: timeout,
      message: "Started a detached PowerShell job. Poll job_status for output and completion; stop_job requests cancellation." };
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
    ...(state === "unknown" ? { message: "No recent supervisor heartbeat. The process may have been interrupted. Inspect supervisor.log; do not assume success or blindly relaunch.", supervisor_log: (await fs.readFile(path.join(directory, "supervisor.log"), "utf8").catch(() => "")).slice(-8192) } : {}) };
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
