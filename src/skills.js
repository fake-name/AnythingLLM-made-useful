"use strict";
const os = require("node:os");
const { fs, path, string, integer, readBytes, decodeText, hash } = require("./common");
const projects = require("./projects");

// Metadata preview only, not a general YAML parser. Full instructions are always
// returned verbatim by read(). Accept ordinary scalars and YAML block strings;
// unfamiliar frontmatter stays discoverable and can still be read in full.
function metadata(markdown) {
  const match = markdown.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  function field(key) {
    const i = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (i < 0) return undefined;
    let value = lines[i].slice(key.length + 1).trim();
    if (/^[|>][-+]?\s*(?:#.*)?$/.test(value)) {
      const parts = [];
      for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || !lines[j]); j++) parts.push(lines[j].trim());
      return parts.join(value[0] === ">" ? " " : "\n").trim();
    }
    if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return value; } }
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
    return value.replace(/\s+#.*$/, "");
  }
  return { name: field("name"), description: field("description") };
}
async function list(args, ctx) {
  const root = await projects.root(args.project, ctx);
  const limit = integer(args.limit, 200, 1, 1000, "limit");
  const candidates = [
    { scope: "project", directory: path.join(root, ".agents", "skills") },
    { scope: "project", directory: path.join(root, ".claude", "skills") },
    { scope: "user", directory: path.join(os.homedir(), ".agents", "skills") },
    { scope: "user", directory: path.join(os.homedir(), ".claude", "skills") }
  ];
  const skills = [], warnings = [], seen = new Set(); let truncated = false;
  for (const candidate of candidates) {
    let handle;
    try { handle = await fs.opendir(candidate.directory); }
    catch (e) { if (e.code !== "ENOENT") warnings.push({ path: candidate.directory, error: e.message }); continue; }
    for await (const entry of handle) {
      if (skills.length >= limit) { truncated = true; break; }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const file = path.join(candidate.directory, entry.name, "SKILL.md");
      try {
        const real = await fs.realpath(file);
        if (seen.has(real)) continue;
        seen.add(real);
        const { bytes } = await readBytes(real, 256 * 1024);
        const info = metadata(decodeText(bytes));
        skills.push({ name: info.name || entry.name, description: String(info.description || "No readable description; load SKILL.md for details.").slice(0, 1200), scope: candidate.scope, path: file });
      } catch (e) { if (e.code !== "ENOENT") warnings.push({ path: file, error: e.message }); }
    }
  }
  return { skills, roots: candidates, warnings, truncated };
}
async function read(args, ctx) {
  let file = await projects.resolve(args.project, string(args.path, "path"), ctx);
  if ((await fs.stat(file)).isDirectory()) file = path.join(file, "SKILL.md");
  const { bytes } = await readBytes(file, 256 * 1024);
  return { path: file, base_directory: path.dirname(file), sha256: hash(bytes), instructions: decodeText(bytes),
    message: "Resolve this skill's relative references from base_directory. Use the file and command tools for its resources and scripts." };
}
module.exports = { list, read, metadata };
