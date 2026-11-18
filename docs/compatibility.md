# Claude Code compatibility

The public names and input fields are based on the published Claude Agent SDK TypeScript definitions, checked against `@anthropic-ai/claude-agent-sdk` **0.3.327**, and **0.2.76** for the older `TaskOutput` interface. These are independent implementations running inside AnythingLLM. No Claude Code executable or Anthropic account is required.

Primary references:

- [Agent SDK TypeScript tool inputs and outputs](https://code.claude.com/docs/en/agent-sdk/typescript#tool-input-types)
- [Claude Code Windows setup and shells](https://code.claude.com/docs/en/setup)
- [AnythingLLM custom agent skills](https://docs.anythingllm.com/agent/custom/developer-guide)
- [AnythingLLM custom tool loader](https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/agents/imported.js)
- [AnythingLLM image attachment channel](https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/agents/aibitat/index.js)
- [ripgrep](https://github.com/BurntSushi/ripgrep)

| Tool | Input compatibility | Implemented behavior / differences |
| --- | --- | --- |
| `Read` | `file_path`, `offset`, `limit`, `pages`, `allow_large` | UTF-8 text and PNG/JPEG/GIF/WebP. 1-based lines, default 2000. 8 MiB file cap, 64 KiB output, raised to 256 KiB with `allow_large`. PDF `pages` returns an explicit unsupported error. Notebooks read as JSON. Images use AnythingLLM attachments. |
| `Write` | `file_path`, `content` | Create parent directories, overwrite existing files only after Read, reject a changed file using an internal SHA-256 observation. |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all` | Exact replacements, reject ambiguous matches and stale reads. Preserve unedited bytes and line endings. No fuzzy matching. |
| `Glob` | `pattern`, `path` | ripgrep glob rules and ignore files; newest modification time first; 100 returned paths. |
| `Grep` | `pattern`, `path`, `glob`, `type`, `output_mode`, `-i`, `-o`, `-n`, `-B`, `-A`, `-C`, `context`, `head_limit`, `offset`, `multiline` | Real ripgrep regex search. Default 250 output entries. 20-second execution ceiling, 8 MiB capture cap, 256 KiB response cap. Explicit failure if capture/time limits are exceeded. |
| `Bash` | `command`, `timeout`, `description`, `run_in_background`, `dangerouslyDisableSandbox` | Real Git Bash, never PowerShell under a Bash label. Foreground default 120000 ms/max 600000; background default 1800000/max 7200000. Ordinary final working-directory changes persist; exports do not. `exec`, replacing the EXIT trap, forced termination, or changing to a non-filesystem location can prevent directory capture. |
| `TaskStop` | `task_id`, deprecated `shell_id` | Cancels local shell jobs and normal descendant trees. Does not stop Claude agents; this package does not implement agents. |
| `TaskOutput` | `task_id`, `block`, `timeout` | Legacy compatibility tool. Current Claude Code removed it in v2.1.277 in favor of Read on output files. Kept here for explicit status/exit-code polling; block/timeout default to true/30000, max wait 600000 ms. |
| `PowerShell` | Uses the Bash-style fields above | Native Windows extension. This is an explicit adapter contract; its exact current Claude Code schema was not present in the published SDK types inspected. |
| `Skill` | `skill`, `args` | Loads discovered SKILL.md instructions and substitutes `$ARGUMENTS`. Lightweight frontmatter preview; no complete Claude skill runner, hooks, tool policy enforcement, automatic shell interpolation, or subagent launching. |

`SetProject`, `ListProjects`, `RegisterProject`, `ForgetProject`, `ListSkills`, and `ListTasks` are generic helpers added by this package; they are not claimed to be Claude Code API replicas.

AnythingLLM custom handlers return **JSON strings**, not Claude Code's exact output envelopes or renderer text. Results include `{ok: true, ...}` or `{ok: false, error, code}`. Shell launch can succeed while the command fails: check `state` and `exit_code`. `TaskOutput.retrieval_status=success` means status was retrieved, not that the command succeeded.

Required fields and enum values are exported through the runtime's `parameters` schema; manifest parameters contain the simpler scalar descriptors AnythingLLM accepts. No conversation examples are injected.

## State and permissions

Project selection is saved under a hash of AnythingLLM's workspace/user/thread identifiers when its invocation metadata supplies them. Otherwise it lasts for the current agent invocation. File-read observations last only for the agent invocation: after restarting it, Read existing files again before Edit/Write. Separate threads do not share selected directories or read observations. No process-wide `chdir` is used.

Commands have the current Windows user's normal access. `dangerouslyDisableSandbox` is accepted but changes nothing because this package does not implement a sandbox. Project selection is a working directory, not a filesystem access boundary. AnythingLLM permissions and model instructions remain host concerns.

The image hook, runtime schema override, and invocation metadata are verified against current upstream source, but are internal AnythingLLM APIs. Automated tests exercise a host fixture and the installed handlers. They do not claim end-to-end verification inside every AnythingLLM Desktop release or provider/model combination.
