"use strict";
const path = require("node:path");
const modules = { projects: require("./projects"), files: require("./files"), jobs: require("./jobs"), skills: require("./skills") };
function makeRuntime(operation) {
  return {
    handler: async function (args = {}) {
      try {
        const [module, method] = operation.split(".");
        const stateDir = this?.runtimeArgs?.STATE_DIRECTORY || path.resolve(__dirname, "../../../anythingllm-made-useful");
        if (!path.isAbsolute(stateDir)) throw new Error("STATE_DIRECTORY must be an absolute path.");
        const ctx = { host: this, stateDir };
        const result = await modules[module][method](args || {}, ctx);
        return JSON.stringify({ ok: true, ...result });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error.message, code: error.code || null });
      }
    }
  };
}
module.exports = { makeRuntime };
