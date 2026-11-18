"use strict";
const { fs, path, string, expand, readJson } = require("./common");
function nameOf(name) {
  string(name, "name");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name))
    throw new Error("Project names must use 1-64 letters, digits, underscores or hyphens, starting with a letter or digit.");
  return name.toLowerCase();
}
function registryFile(ctx, name) { return path.join(ctx.stateDir, "projects", `${nameOf(name)}.json`); }
async function list(_args, ctx) {
  const dir = path.join(ctx.stateDir, "projects");
  let names;
  try { names = await fs.readdir(dir); } catch (e) { if (e.code === "ENOENT") return { projects: [] }; throw e; }
  const projects = [];
  for (const name of names.sort()) if (name.endsWith(".json")) projects.push(await readJson(path.join(dir, name)));
  return { projects };
}
async function register(args, ctx) {
  const name = nameOf(args.name);
  const expanded = expand(args.directory);
  if (!path.isAbsolute(expanded)) throw new Error("directory must be absolute (or start with ~ or %USERPROFILE%).");
  const directory = await fs.realpath(expanded);
  if (!(await fs.stat(directory)).isDirectory()) throw new Error("directory is not a folder.");
  const file = registryFile(ctx, name);
  const record = { name, directory };
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readJson(file);
    if (existing.directory !== directory) throw new Error("That project name already points to another directory. Forget the old registration first; that does not delete its files.");
  }
  return record;
}
async function forget(args, ctx) {
  const name = nameOf(args.name);
  await fs.unlink(registryFile(ctx, name));
  return { name, forgotten: true, files_deleted: false };
}
async function root(project, ctx) {
  const expanded = expand(string(project, "project"));
  const directory = path.isAbsolute(expanded)
    ? expanded : (await readJson(registryFile(ctx, project), null))?.directory;
  if (!directory) throw new Error(`Unknown project '${project}'. Register it or pass its absolute directory.`);
  if (!(await fs.stat(directory)).isDirectory()) throw new Error(`Project directory is unavailable: ${directory}`);
  return directory;
}
async function resolve(project, file, ctx) {
  const directory = await root(project, ctx);
  return path.resolve(directory, expand(string(file, "path")));
}
module.exports = { list, register, forget, root, resolve };
