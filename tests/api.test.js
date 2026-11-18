"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { makeRuntime } = require("../src/runtime");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-api-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project [one] é"); await fs.mkdir(project);
  const attachments = [];
  const runtimeArgs = { STATE_DIRECTORY: path.join(root, "state"), DEFAULT_DIRECTORY: project,
    RIPGREP_PATH: process.env.TEST_RIPGREP_PATH || "rg" };
  const host = { runtimeArgs, super: { handlerProps: { invocation: { workspace_id: 1, user_id: 2, thread_id: 3 } }, addToolAttachment: a => attachments.push(a) } };
  const call = async (name, args = {}, instance = host) => JSON.parse(await makeRuntime(`agent.${name}`).handler.call(instance, args));
  return { project, root, host, call, attachments };
}
test("public schemas use Claude names and reject old/prefixed arguments", async (t) => {
  const { call } = await fixture(t);
  const catalog = require("../src/catalog");
  assert.ok(catalog.every(t => !t.id.startsWith("amu_")));
  assert.deepEqual(Object.keys(makeRuntime("agent.Edit").parameters.properties), ["file_path", "old_string", "new_string", "replace_all"]);
  assert.deepEqual(makeRuntime("agent.Write").parameters.required, ["file_path", "content"]);
  assert.match((await call("Read", {})).error, /file_path/);
  assert.match((await call("Read", { file_path: "a", project: "x" })).error, /Unknown argument: project/);
});
test("Read/Edit/Write preserve CRLF, enforce Read first, replace_all, and stale-read checks", async (t) => {
  const { project, call } = await fixture(t);
  const file_path = path.join(project, "a.txt");
  await fs.writeFile(file_path, "one\r\nrepeat repeat\r\nend\r\n");
  assert.equal((await call("Write", { file_path, content: "bad" })).ok, false);
  const read = await call("Read", { file_path, offset: 2, limit: 1 });
  assert.equal(read.file.content, "repeat repeat\r\n"); assert.equal(read.next_offset, 3);
  assert.equal((await call("Edit", { file_path, old_string: "repeat", new_string: "r" })).ok, false);
  assert.equal((await call("Edit", { file_path, old_string: "repeat", new_string: "r", replace_all: true })).replacements, 2);
  assert.equal(await fs.readFile(file_path, "utf8"), "one\r\nr r\r\nend\r\n");
  await fs.writeFile(file_path, "external change");
  assert.equal((await call("Write", { file_path, content: "bad" })).ok, false);
  await call("Read", { file_path });
  assert.equal((await call("Write", { file_path, content: "" })).type, "update");
  assert.equal(await fs.readFile(file_path, "utf8"), "");
  assert.equal((await call("Write", { file_path: path.join(project, "nested", "new.txt"), content: "new" })).type, "create");
});
test("project selection persists per conversation, without leaking directory or read observations", async (t) => {
  const { project, root, host, call } = await fixture(t);
  const second = path.join(root, "second"); await fs.mkdir(second);
  await call("RegisterProject", { name: "second", directory: second });
  assert.equal((await call("SetProject", { project: "second" })).persistence, "conversation");
  const restarted = { runtimeArgs: host.runtimeArgs, super: { handlerProps: host.super.handlerProps } };
  assert.equal((await call("ListProjects", {}, restarted)).current_directory, await fs.realpath(second));
  const other = { runtimeArgs: host.runtimeArgs, super: { handlerProps: { invocation: { workspace_id: 1, user_id: 2, thread_id: 4 } } } };
  assert.equal((await call("ListProjects", {}, other)).current_directory, project);
  const file_path = path.join(project, "observed.txt"); await fs.writeFile(file_path, "original");
  await call("Read", { file_path });
  assert.equal((await call("Write", { file_path, content: "bad" }, other)).ok, false);
  assert.equal((await call("Write", { file_path, content: "bad" }, restarted)).ok, false);
});
test("Grep uses ripgrep regex, ignore files, output modes, offsets and multiline", async (t) => {
  const { project, call } = await fixture(t);
  await fs.writeFile(path.join(project, ".ignore"), "ignored.txt\n");
  await fs.writeFile(path.join(project, "ignored.txt"), "value=999");
  await fs.writeFile(path.join(project, "code.js"), "first\nvalue=12\nVALUE=34\nlast\n");
  await fs.writeFile(path.join(project, "other.txt"), "value=56\n");
  let r = await call("Grep", { pattern: "value=\\d+", glob: "*.js", output_mode: "content", "-i": true });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.match(r.content, /:2:value=12/); assert.match(r.content, /:3:VALUE=34/);
  r = await call("Grep", { pattern: "value=\\d+", output_mode: "count" });
  assert.match(r.content, /code\.js:1/); assert.match(r.content, /other\.txt:1/); assert.doesNotMatch(r.content, /ignored/);
  r = await call("Grep", { pattern: "first.*last", multiline: true });
  assert.equal(r.numFiles, 1); assert.ok(r.filenames[0].endsWith("code.js"));
  r = await call("Grep", { pattern: "value=\\d+", head_limit: 1, offset: 1 });
  assert.equal(r.numFiles, 1);
  r = await call("Grep", { pattern: "[" }); assert.equal(r.ok, false); assert.match(r.error, /regex/);
});
test("Glob sorts matches by mtime and Skill loads project instructions with arguments", async (t) => {
  const { project, call } = await fixture(t);
  for (const [name, time] of [["old.js", 1], ["new.js", 2]]) {
    const file = path.join(project, name); await fs.writeFile(file, name); await fs.utimes(file, time, time);
  }
  const glob = await call("Glob", { pattern: "**/*.js" });
  assert.equal(glob.ok, true, JSON.stringify(glob)); assert.equal(glob.numFiles, 2); assert.ok(glob.filenames[0].endsWith("new.js"));
  const directory = path.join(project, ".claude", "skills", "demo"); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\nInspect $ARGUMENTS.\nRead references/info.md.");
  assert.ok((await call("ListSkills")).skills.some(s => s.name === "demo"));
  const skill = await call("Skill", { skill: "demo", args: "the board" });
  assert.equal(skill.base_directory, directory); assert.match(skill.instructions, /Inspect the board/);
});
test("Read images attaches image data; unsupported PDFs return an explicit error", async (t) => {
  const { project, call, attachments } = await fixture(t);
  const file_path = path.join(project, "tiny.png");
  await fs.writeFile(file_path, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDPsAAAAASUVORK5CYII=", "base64"));
  const read = await call("Read", { file_path });
  assert.equal(read.type, "image"); assert.equal(attachments.length, 1); assert.equal(attachments[0].mime, "image/png");
  assert.match((await call("Read", { file_path: path.join(project, "paper.pdf"), pages: "1" })).error, /PDF rendering/);
});
