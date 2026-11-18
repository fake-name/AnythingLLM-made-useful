"use strict";
const os = require("node:os");
const { path, hash, readJson, writeJson } = require("./common");
const key = Symbol.for("AnythingLLM-made-useful.session");
async function session(ctx) {
  const owner = ctx.host?.super || ctx.host;
  if (!owner) throw new Error("Missing tool invocation context.");
  // All generated plugins use Symbol.for so copies share one invocation state.
  if (!owner[key]) owner[key] = (async () => {
    const invocation = owner.handlerProps?.invocation;
    const scope = invocation?.workspace_id == null ? null :
      [invocation.workspace_id, invocation.user_id ?? null, invocation.thread_id ?? null];
    const file = scope ? path.join(ctx.stateDir, "sessions", `${hash(JSON.stringify(scope))}.json`) : null;
    const saved = file ? await readJson(file, {}) : {};
    const cwd = saved.cwd || ctx.host?.runtimeArgs?.DEFAULT_DIRECTORY || os.homedir();
    if (!path.isAbsolute(cwd)) throw new Error("DEFAULT_DIRECTORY must be absolute.");
    return { cwd, file, reads: new Map(), generation: 0 };
  })();
  return owner[key];
}
async function select(ctx, cwd) {
  const state = await session(ctx);
  state.cwd = cwd; state.generation++;
  if (state.file) await writeJson(state.file, { cwd });
  return state;
}
module.exports = { session, select };
