"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const pkg = require("../package.json");
const catalog = require("../src/catalog");
const output = path.join(root, "dist", `AnythingLLM-made-useful-${pkg.version}-windows`);
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const setting = (hint) => ({ type: "string", required: false, input: { type: "text", default: "", hint }, value: "" });
for (const tool of catalog) {
  const dir = path.join(output, "plugins", tool.id);
  fs.mkdirSync(dir, { recursive: true });
  const setup = { STATE_DIRECTORY: setting("Optional absolute state directory. Leave blank to store projects/jobs alongside the installed plugins. Use the same value for every Made Useful tool.") };
  if (tool.operation === "jobs.run" || tool.operation === "jobs.start") setup.POWERSHELL_PATH = setting("Optional full path to pwsh.exe (PowerShell 7). Leave blank for built-in Windows PowerShell 5.1.");
  const manifest = {
    $schema: "https://raw.githubusercontent.com/Mintplex-Labs/anything-llm/refs/heads/master/server/utils/agents/imported-manifest.schema.json",
    active: true, imported: true, hubId: tool.id, name: tool.name, schema: "skill-1.0.0", version: pkg.version,
    description: tool.description, license: "MIT", setup_args: setup,
    // Intentionally no injected conversation examples; descriptions define usage.
    examples: [], entrypoint: { file: "handler.js", params: tool.params }
  };
  fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "handler.js"), `"use strict";\nmodule.exports.runtime = require("./lib/runtime").makeRuntime(${JSON.stringify(tool.operation)});\n`);
  fs.cpSync(path.join(root, "src"), path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), `# ${tool.name}\n\n${tool.description}\n\nPart of [AnythingLLM-made-useful](https://github.com/fake-name/AnythingLLM-made-useful). See the bundle README for installation and use.\n`);
}
for (const name of ["README.md", "LICENSE"]) fs.copyFileSync(path.join(root, name), path.join(output, name));
for (const name of fs.readdirSync(path.join(root, "packaging"))) fs.copyFileSync(path.join(root, "packaging", name), path.join(output, name));
const files = [];
function checksum(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) checksum(full);
    else files.push(`${createHash("sha256").update(fs.readFileSync(full)).digest("hex")}  ${path.relative(output, full).split(path.sep).join("/")}`);
  }
}
checksum(output);
fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), files.join("\n") + "\n");
console.log(`Built ${catalog.length} tools: ${output}`);
