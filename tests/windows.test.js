"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { makeRuntime } = require("../src/runtime");
const { delay } = require("../src/common");
const win = process.platform === "win32";
const ps = win ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amu-win-"));
  const project = path.join(root, "project space [test] é"); await fs.mkdir(project);
  const host = { runtimeArgs: { STATE_DIRECTORY: path.join(root, "state") } };
  const call = async (operation, args) => JSON.parse(await makeRuntime(operation).handler.call(host, args));
  const jobIds = [];
  t.after(async () => {
    for (const job_id of jobIds) {
      await call("jobs.stop", { job_id });
      for (let i = 0; i < 60; i++) {
        const s = await call("jobs.status", { job_id });
        if (!["running", "starting", "unknown"].includes(s.state)) break;
        await delay(200);
      }
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  });
  const start = async (args) => { const result = await call("jobs.start", { project, ...args }); assert.equal(result.ok, true, JSON.stringify(result)); jobIds.push(result.job_id); return result; };
  const wait = async (job_id) => {
    for (let i = 0; i < 160; i++) {
      const result = await call("jobs.status", { job_id }); assert.equal(result.ok, true, JSON.stringify(result));
      if (!["starting", "running"].includes(result.state)) return result;
      await delay(200);
    }
    throw new Error("Job did not finish within test deadline");
  };
  return { root, project, host, call, start, wait };
}
test("Windows: Unicode, quoted paths, stdout/stderr, and native exit codes", { skip: !win, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const a = await f.start({ command: "Write-Output 'héllo 日本語'; [Console]::Error.WriteLine('error stream'); Write-Output (Get-Location).Path; & $env:ComSpec /d /c exit 7" });
  const result = await f.wait(a.job_id);
  assert.equal(result.state, "failed", JSON.stringify(result)); assert.equal(result.exit_code, 7);
  assert.match(result.stdout.text, /héllo 日本語/); assert.ok(result.stdout.text.includes(f.project));
  assert.match(result.stderr.text, /error stream/);
});
test("Windows: detached jobs return before completion and can be polled with a fresh handler", { skip: !win, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const started = Date.now();
  const a = await f.start({ command: "Write-Output 'before'; Start-Sleep -Seconds 4; Write-Output 'after'" });
  assert.ok(Date.now() - started < 3500, "start_command should not wait for the command");
  const result = await f.wait(a.job_id);
  assert.equal(result.state, "completed", JSON.stringify(result)); assert.equal(result.exit_code, 0);
  assert.match(result.stdout.text, /before/); assert.match(result.stdout.text, /after/);
});
test("Windows: timeout and cooperative cancellation report terminal states", { skip: !win, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const a = await f.start({ command: "Start-Sleep -Seconds 30", timeout_seconds: 1 });
  assert.equal((await f.wait(a.job_id)).state, "timed_out");
  const b = await f.start({ command: "Start-Sleep -Seconds 30" });
  assert.equal((await f.call("jobs.stop", { job_id: b.job_id })).state, "stop_requested");
  assert.equal((await f.wait(b.job_id)).state, "cancelled");
});
test("Windows: large command scripts avoid Windows command-line length limits", { skip: !win, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const a = await f.start({ command: "# " + "x".repeat(40000) + "\nWrite-Output 'large script works'" });
  const result = await f.wait(a.job_id);
  assert.equal(result.state, "completed"); assert.match(result.stdout.text, /large script works/);
});
test("Windows: jobs survive their launching Node process exiting", { skip: !win, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const script = `const {makeRuntime}=require(${JSON.stringify(require.resolve("../src/runtime"))});
    makeRuntime('jobs.start').handler.call(${JSON.stringify(f.host)}, ${JSON.stringify({ project: f.project, command: "Start-Sleep -Seconds 3; Write-Output 'parent is gone'" })}).then(console.log);`;
  const result = await promisify(execFile)(process.execPath, ["-e", script], { encoding: "utf8", timeout: 15000 });
  const launch = JSON.parse(result.stdout.trim()); assert.equal(launch.ok, true);
  t.after(() => f.call("jobs.stop", { job_id: launch.job_id }));
  const done = await f.wait(launch.job_id);
  assert.equal(done.state, "completed", JSON.stringify(done));
  assert.match(done.stdout.text, /parent is gone/);
});
test("Windows: foreground tool reports PowerShell errors and explicit exit status", { skip: !win, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const success = await f.call("jobs.run", { project: f.project, command: "Write-Output 'foreground'; exit 0", timeout_seconds: 10 });
  assert.equal(success.state, "completed", JSON.stringify(success));
  assert.match(success.stdout.text, /foreground/);
  const failed = await f.call("jobs.run", { project: f.project, command: "throw 'intentional test failure'", timeout_seconds: 10 });
  assert.equal(failed.state, "failed", JSON.stringify(failed)); assert.equal(failed.exit_code, 1);
  assert.match(failed.stderr.text, /intentional test failure/);
});
test("Windows: installer, upgrade preservation, and uninstall in a disposable storage tree", { skip: !win, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const version = require("../package.json").version;
  const bundle = path.resolve(__dirname, "..", "dist", `AnythingLLM-made-useful-${version}-windows`);
  const storage = path.join(f.root, "storage spaces [x]"); await fs.mkdir(storage);
  const install = () => execFileSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(bundle, "Install.ps1"), "-StorageDirectory", storage], { encoding: "utf8" });
  install();
  const plugin = path.join(storage, "plugins", "agent-skills", "amu_run_command");
  const manifestPath = path.join(plugin, "plugin.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.active = false; manifest.setup_args.POWERSHELL_PATH.value = "C:\\custom\\pwsh.exe";
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  install();
  const upgraded = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(upgraded.active, false); assert.equal(upgraded.setup_args.POWERSHELL_PATH.value, "C:\\custom\\pwsh.exe");
  const defaultState = path.join(storage, "plugins", "anythingllm-made-useful");
  const runtime = require(path.join(storage, "plugins", "agent-skills", "amu_register_project", "handler.js")).runtime;
  assert.equal(JSON.parse(await runtime.handler.call({}, { name: "test", directory: f.project })).ok, true);
  assert.ok(await fs.stat(path.join(defaultState, "projects", "test.json")));
  execFileSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(bundle, "Uninstall.ps1"), "-StorageDirectory", storage]);
  await assert.rejects(fs.stat(plugin), { code: "ENOENT" });
  assert.ok(await fs.stat(path.join(defaultState, "projects", "test.json")));
});
