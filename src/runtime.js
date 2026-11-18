"use strict";
const path = require("node:path");
const modules = { agent: require("./agent"), projects: require("./projects"), files: require("./files"), jobs: require("./jobs"), skills: require("./skills") };
function makeRuntime(operation) {
  const tool = require("./catalog").find(t => t.operation === operation);
  return {
    ...(tool ? { parameters: { type: "object", properties: tool.params, required: tool.required, additionalProperties: false } } : {}),
    handler: async function (args = {}) {
      try {
        if (tool) {
          for (const required of tool.required) if (args?.[required] === undefined) throw new Error(`Missing required argument: ${required}`);
          for (const name of Object.keys(args || {})) if (!Object.hasOwn(tool.params, name)) throw new Error(`Unknown argument: ${name}`);
        }
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
