"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { makeRuntime } = require("../src/runtime");
const skills = require("../src/skills");
const { logSlice } = require("../src/jobs");
const { randomUUID } = require("node:crypto");

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amu-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "project spaces [x] é");
  await fs.mkdir(project);
  const attachments = [];
  const host = { runtimeArgs: { STATE_DIRECTORY: path.join(dir, "state") }, super: { addToolAttachment: (image) => attachments.push(image) } };
  const call = async (operation, args) => {
    const result = await makeRuntime(operation).handler.call(host, args);
    assert.equal(typeof result, "string");
    return JSON.parse(result);
  };
  return { dir, project, host, attachments, call };
}
test("project aliases are persistent, case-normalized, and independent across calls", async (t) => {
  const { project, call } = await fixture(t);
  assert.equal((await call("projects.register", { name: "Example", directory: project })).directory, project);
  assert.equal((await call("projects.list", {})).projects[0].name, "example");
  assert.equal((await call("files.write", { project: "EXAMPLE", path: "a.txt", content: "test" })).ok, true);
  assert.equal((await call("projects.forget", { name: "example" })).files_deleted, false);
  assert.equal(await fs.readFile(path.join(project, "a.txt"), "utf8"), "test");
  assert.equal((await call("files.read", { project: "example", path: "a.txt" })).ok, false);
});
test("creation, line ranges, BOM/CRLF, exact edits, and stale-write detection", async (t) => {
  const { project, call } = await fixture(t);
  const base = { project, path: "nested/code.txt" };
  const text = "\uFEFFone\r\ntwo\r\nthree\r\n";
  assert.equal((await call("files.write", { ...base, content: text })).ok, true);
  const read = await call("files.read", { ...base, start_line: 2, line_count: 1 });
  assert.equal(read.content, "two\r\n"); assert.equal(read.next_start_line, 3);
  const edited = await call("files.edit", { ...base, old_text: "two", new_text: "TWO", expected_sha256: read.sha256 });
  assert.equal(edited.replacements, 1);
  assert.equal(await fs.readFile(path.join(project, base.path), "utf8"), text.replace("two", "TWO"));
  assert.equal((await call("files.write", { ...base, content: "lost", overwrite: true, expected_sha256: read.sha256 })).ok, false);
  assert.equal((await call("files.write", { ...base, content: "lost" })).ok, false);
});
test("ambiguous/missing matches do not modify a file and repeated replacement is explicit", async (t) => {
  const { project, call } = await fixture(t); const base = { project, path: "a.txt" };
  await call("files.write", { ...base, content: "hello hello" });
  assert.equal((await call("files.edit", { ...base, old_text: "hello", new_text: "x" })).ok, false);
  assert.equal((await call("files.edit", { ...base, old_text: "no", new_text: "x" })).ok, false);
  assert.equal((await call("files.read", base)).content, "hello hello");
  assert.equal((await call("files.edit", { ...base, old_text: "hello", new_text: "", expected_occurrences: 2 })).replacements, 2);
  assert.equal((await call("files.edit", { ...base, old_text: " ", new_text: "" })).replacements, 1);
  assert.equal((await call("files.read", base)).content, "");
});
test("competing guarded edits cannot silently overwrite each other", async (t) => {
  const { project, call } = await fixture(t); const base = { project, path: "a.txt" };
  const written = await call("files.write", { ...base, content: "original" });
  const results = await Promise.all(["one", "two"].map(content => call("files.write", { ...base, content, overwrite: true, expected_sha256: written.sha256 })));
  assert.equal(results.filter(x => x.ok).length, 1);
});
test("binary and invalid UTF-8 files are rejected instead of corrupted", async (t) => {
  const { project, call } = await fixture(t);
  for (const [name, bytes] of [["binary", [0, 1]], ["bad", [255, 254]]]) {
    await fs.writeFile(path.join(project, name), Buffer.from(bytes));
    assert.equal((await call("files.read", { project, path: name })).ok, false);
  }
});
test("search is literal, bounded, and skips generated directories", async (t) => {
  const { project, call } = await fixture(t);
  await call("files.write", { project, path: "src/code.js", content: "Find [literal]\nnext\n" });
  await call("files.write", { project, path: "node_modules/no.js", content: "Find [literal]" });
  const result = await call("files.search", { project, text: "[literal]" });
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].line, 1);
  const list = await call("files.list", { project, depth: 2, limit: 1 });
  assert.equal(list.entries.length, 1); assert.equal(list.truncated, true);
});
test("image viewing uses the attachment channel, never base64 tool-result text", async (t) => {
  const { project, call, attachments, host } = await fixture(t);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDPsAAAAASUVORK5CYII=", "base64");
  await fs.writeFile(path.join(project, "tiny.png"), png);
  const result = await call("files.image", { project, path: "tiny.png" });
  assert.equal(result.attached, true); assert.equal(attachments[0].mime, "image/png");
  assert.equal(attachments[0].contentString, `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(JSON.stringify(result).includes("base64"), false);
  delete host.super.addToolAttachment;
  assert.equal((await call("files.image", { project, path: "tiny.png" })).ok, false);
});
test("skill discovery previews metadata and reading preserves full instructions/resources", async (t) => {
  const { project, call } = await fixture(t);
  const instructions = "---\nname: example\ndescription: >\n  Check circuits\n  and review layouts.\n---\n# Instructions\nRead references/details.md.\n";
  await call("files.write", { project, path: ".agents/skills/example/SKILL.md", content: instructions });
  const result = await call("skills.list", { project });
  const skill = result.skills.find(x => x.name === "example");
  assert.equal(skill.description, "Check circuits and review layouts.");
  const read = await call("skills.read", { project, path: skill.path });
  assert.equal(read.instructions, instructions);
  assert.equal(read.base_directory, path.dirname(skill.path));
  assert.equal(skills.metadata("---\nname: 'it''s quoted'\n---\n").name, "it's quoted");
});
test("job log cursors preserve UTF-8 characters split across reads", async (t) => {
  const { dir } = await fixture(t); const file = path.join(dir, "utf8.log");
  await fs.writeFile(file, "abcéXYZ");
  const a = await logSlice(file, 0, 4); assert.equal(a.text, "abc"); assert.equal(a.next_offset, 3);
  const b = await logSlice(file, a.next_offset, 4); assert.equal(b.text, "éXY");
});
test("stale background jobs report unknown, and cancellation targets a job file not a bare PID", async (t) => {
  const { host, call } = await fixture(t); const id = randomUUID();
  const directory = path.join(host.runtimeArgs.STATE_DIRECTORY, "jobs", id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "request.json"), JSON.stringify({ created_at: "2020-01-01T00:00:00Z", cwd: "." }));
  assert.equal((await call("jobs.status", { job_id: id })).state, "unknown");
  assert.equal((await call("jobs.stop", { job_id: id })).state, "stop_requested");
  assert.ok(await fs.stat(path.join(directory, "stop.request")));
  assert.equal((await call("jobs.status", { job_id: "../../wrong" })).ok, false);
});
