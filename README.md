# AnythingLLM made useful

Claude Code-style file, search, shell, background-task and skill tools for **AnythingLLM Desktop on Windows**. Designed around familiar tool calls for coding models such as Claude Opus.

[![Windows tests and package](https://github.com/fake-name/AnythingLLM-made-useful/actions/workflows/windows.yml/badge.svg)](https://github.com/fake-name/AnythingLLM-made-useful/actions/workflows/windows.yml)

The plugin runs in AnythingLLM's own Node runtime. No separate Node installation, npm install, custom Rust binary, daemon, or listening port is needed. The ZIP includes the official **ripgrep 15.2.0 Windows x64 executable** for search. PowerShell is included with Windows; `Bash` additionally requires [Git for Windows](https://gitforwindows.org/).

## Install

1. Download the Windows ZIP from [Releases](https://github.com/fake-name/AnythingLLM-made-useful/releases), or the `windows-package` artifact from a successful [Actions run](https://github.com/fake-name/AnythingLLM-made-useful/actions/workflows/windows.yml). The Actions artifact contains the installable ZIP and its checksum.
2. Extract the **entire installable ZIP**.
3. Double-click **Install.cmd**, as your normal Windows user.
4. Quit AnythingLLM from its system tray and reopen it. Check **Settings > Agent Skills** and enable the tools for your agent. Depending on your version/provider, start the conversation with `@agent`.

The default destination is `%APPDATA%\anythingllm-desktop\storage\plugins\agent-skills`. Launch AnythingLLM once to create its storage folder. If you use another location, find it with the app's **Open storage** command and run:

```powershell
.\Install.ps1 -StorageDirectory 'D:\AnythingLLM\storage'
```

Installation needs no administrator rights and downloads nothing. The launcher applies execution-policy bypass only to its own PowerShell process. The packaged ripgrep binary targets Windows x64; ARM64 is not yet validated.

## Tools

These are separate tools with their own schemas, without a plugin prefix.

| Tool | Arguments / purpose |
| --- | --- |
| `Read` | `file_path`, optional `offset`, `limit`, `pages`, `allow_large`. Read UTF-8 text or attach an image. PDF rendering is not implemented. |
| `Write` | `file_path`, `content`. Create or overwrite a file. Read an existing file first. |
| `Edit` | `file_path`, `old_string`, `new_string`, optional `replace_all`. Exact replacement, with stale-read detection. |
| `Glob` | `pattern`, optional `path`. Find files, newest first. |
| `Grep` | `pattern`, optional `path`, filters, output mode and context. Real ripgrep regex search. |
| `Bash` | `command`, optional `timeout`, `description`, `run_in_background`, `dangerouslyDisableSandbox`. Uses Git Bash. |
| `PowerShell` | Same shell argument shape, using Windows PowerShell 5.1 or configured PowerShell 7. |
| `TaskOutput` | `task_id`, optional `block`, `timeout`. Read output, status and exit code. |
| `TaskStop` | `task_id` (or deprecated `shell_id`). Cancel a shell task and its normal child process tree. |
| `Skill` | `skill`, optional `args`. Load a discovered SKILL.md workflow. |
| `SetProject` | `project`: a registered name or absolute directory. Select the working directory. |
| `ListProjects` | List registered projects and current directory. |
| `RegisterProject` | `name`, `directory`. Save an existing directory under a name. |
| `ForgetProject` | `name`. Remove a registration without deleting files. |
| `ListSkills` | Discover project/user SKILL.md workflows and their descriptions. |
| `ListTasks` | List persistent shell task IDs, optionally limited with `limit`. |

The main input fields follow the published Claude Agent SDK. This is an independent implementation, with AnythingLLM JSON-string results and some narrower capabilities. See the [compatibility table](docs/compatibility.md) for exact limits and differences. No claims are made about any model's training data.

## Projects and files

Try: “Register `C:\Users\me\work\example` as `example`, select it, then inspect the code and load any relevant skills.”

`SetProject` controls the default directory for shells, searches and skills. With current AnythingLLM invocation metadata, it persists separately for each workspace/user/thread. On older hosts without that metadata it lasts for the current agent invocation. `ListProjects` reports the selected directory. Files use absolute `file_path` arguments, just as Claude Code does. The default directory before selection is your home directory.

`Read` defaults to 2000 lines and a 64 KiB text output cap, with `next_offset` for continuation. `allow_large` raises the output cap to 256 KiB. Text files are limited to 8 MiB. Writes create missing parent folders. Edits are exact, preserving CRLF/LF and bytes outside the replacement. Read existing files before changing them; the tool keeps a SHA-256 observation internally and rejects a stale edit. A new agent invocation must read them again.

Project selection is a working directory, **not an access boundary**. File and shell tools run with your Windows account's access. There is no separate shell sandbox or per-command permission dialog added by this plugin.

## Shells and background tasks

Use `Bash` for Bash syntax and `PowerShell` for PowerShell syntax. Bash requires Git for Windows; the rest of the package works without Git. `GIT_BASH_PATH` on the Bash tool or the environment variable `CLAUDE_CODE_GIT_BASH_PATH` can specify `bash.exe`. Set `POWERSHELL_PATH` on a shell tool to an absolute `pwsh.exe` path to use PowerShell 7.

`timeout` is in **milliseconds**. Foreground commands default to 120000 ms, maximum 600000. Background commands default to 1800000 ms, maximum 7200000. Start a long task with `run_in_background: true`; the response includes `backgroundTaskId`, `stdout_file`, and `stderr_file`. Poll with `TaskOutput`, or use `Read` on those output files. Use `TaskStop` to cancel it. `TaskOutput` is retained for compatibility with earlier Claude Code versions; current Claude Code uses `Read` on background output files.

Always check `state` and `exit_code`. A successfully launched or successfully polled task may have failed. A stale supervisor reports `unknown`, never success. Logs and task records survive AnythingLLM restarts; normal background tasks survive their launching Node process exiting. Rebooting Windows ends the processes. Cancellation/timeout use `taskkill /T`; deliberately reparented or escaped processes are outside that guarantee.

Foreground working-directory changes persist; environment variables and shell functions do not. Background directory changes do not alter the conversation's directory. The supervisor monitors each output stream for a 16 MiB limit; a burst can overshoot it. Output is bounded in tool responses, with complete captured logs available through the returned paths. Commands and logs are retained until you remove them.

## Images and skills

`Read` attaches PNG, JPEG, GIF or WebP images up to 8 MiB through AnythingLLM's image channel. The model needs vision support. Unsupported AnythingLLM versions return a clear attachment error. PDF rendering and notebook rendering are not included; notebook files can be read as JSON.

`ListSkills` scans `<project>/.agents/skills`, `<project>/.claude/skills`, and the same two directories under your home folder. Each workflow lives in `<name>/SKILL.md`. Project skills take precedence over user skills with the same name. `Skill({skill, args})` loads the full instructions, substitutes `$ARGUMENTS`, and returns the base directory for relative resources. The model can then read referenced files and run scripts with the appropriate tools. Loading a skill does not automatically execute its scripts or implement Claude Code's skill-specific hooks or permission policies.

## Upgrades and removal

Run the new ZIP's `Install.cmd` to upgrade. Settings and active states are preserved; replaced plugins and old `amu_` plugins are backed up under `storage/plugins/anythingllm-made-useful/backups`. The installer checks every generic tool name first and refuses a collision with an unrelated plugin.

Run `Uninstall.cmd` to remove this package's tools. It preserves project files, registrations, logs, backups, support files, and running jobs. Stop tasks before uninstalling if you want them to terminate.

State defaults to `storage/plugins/anythingllm-made-useful`. `STATE_DIRECTORY` can override it; use the same absolute value on all tools. `DEFAULT_DIRECTORY` sets the initial working directory. Search tools can override the bundled executable with `RIPGREP_PATH`.

## Build and test

On Windows with Node 18 or newer:

```powershell
.\scripts\prepare-vendor.ps1
npm run build
npm test
```

The vendor preparation script downloads a pinned official ripgrep archive and verifies its SHA-256 before extraction. Its licenses are included in the package. There are no npm runtime dependencies. Windows Actions test Node 18 and 24, exercise shell execution, Unicode and literal paths, parent exit, cancellation, installer upgrades and API behavior, then produce the ZIP and checksums. A tag matching `package.json` (for example `v0.1.0`) publishes the release after those checks pass.

Linux can run the platform-independent tests with ripgrep installed; Windows tests are skipped there. Automated tests use an AnythingLLM host fixture. Actual Desktop/provider integration, especially the internal image hook, still needs a first install check against your deployed version.
