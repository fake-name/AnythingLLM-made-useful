# AnythingLLM made useful

Project, file, image, PowerShell, background-job, and `SKILL.md` tools for **AnythingLLM Desktop on Windows**.

[![Windows tests and package](https://github.com/fake-name/AnythingLLM-made-useful/actions/workflows/windows.yml/badge.svg)](https://github.com/fake-name/AnythingLLM-made-useful/actions/workflows/windows.yml)

No separate binary, Node installation, npm install, Rust toolchain, daemon, or listening port is needed on the user's machine. AnythingLLM's own Node runtime loads the plugins. Commands run in the Windows PowerShell 5.1 already included with Windows; PowerShell 7 can be configured optionally.

## Install

1. Download the Windows ZIP from [Releases](https://github.com/fake-name/AnythingLLM-made-useful/releases), or the `windows-package` artifact from a successful [Actions run](https://github.com/fake-name/AnythingLLM-made-useful/actions/workflows/windows.yml). The Actions download contains the installable ZIP and its checksum.
2. Extract the **entire installable ZIP** to a folder.
3. Double-click **Install.cmd**. Run as your normal Windows user.
4. Quit AnythingLLM using its system-tray menu and reopen it. Check **Settings > Agent Skills** for the `Made Useful:` tools and enable them for use. Depending on the installed version/provider, start your conversation with `@agent`.

The installer uses `%APPDATA%\anythingllm-desktop\storage\plugins\agent-skills`. If your storage is elsewhere, use the app's **Open storage** command to find it, then run:

```powershell
.\Install.ps1 -StorageDirectory 'D:\AnythingLLM\storage'
```

Launching AnythingLLM once creates its storage directory. Installation does not require administrator rights or download anything. The `.cmd` launcher sets execution policy for its one PowerShell process; it does not change the machine's policy. Organizational policies may still prevent scripts from running.

## Tools

Each row is a separate native AnythingLLM agent tool with its own parameter schema.

| Tool | Behavior |
| --- | --- |
| `amu_list_projects` | List saved names and project directories. |
| `amu_register_project` | Register an existing directory under a reusable name. |
| `amu_forget_project` | Forget a registration without deleting project files. |
| `amu_list_directory` | List files/folders with bounded recursion. |
| `amu_read_file` | Read line ranges from UTF-8 text; return SHA-256. |
| `amu_write_file` | Create or deliberately overwrite text, optionally checking SHA-256. |
| `amu_edit_file` | Exact text replacement with an expected occurrence count. |
| `amu_search_files` | Find literal filename/content matches recursively. |
| `amu_view_image` | Attach a local image to the model's next turn. |
| `amu_run_command` | Run PowerShell and wait for a bounded duration. |
| `amu_start_command` | Start a detached PowerShell job and return its ID immediately. |
| `amu_job_status` | Read state, exit code, and incremental stdout/stderr. |
| `amu_stop_job` | Request cancellation of a job and its ordinary process tree. |
| `amu_list_jobs` | Recover recent job IDs across chats/restarts. |
| `amu_list_skills` | Discover project/user `SKILL.md` instructions. |
| `amu_read_skill` | Load full skill instructions and their resource base directory. |

## Projects and files

Try: “Register `C:\Users\me\source\example` as project `example`, list its files, and read README.md.”

Every file, command, and skill operation takes an explicit `project`: either a registered name or an absolute directory. Relative paths resolve from that directory. There is no process-wide `chdir` or shared “current project” for another chat to change accidentally. Names are case-insensitive; registration lists are shared by the Windows user. You can use absolute file paths and `~`/`%USERPROFILE%` paths as well.

Text reads and edits preserve UTF-8 BOMs and CRLF/LF line endings. `edit_file` requires an exact match, including line endings; its default expected occurrence count is one. `write_file` defaults to refusing existing files. For an overwrite, pass `overwrite: true` and preferably `expected_sha256` from a preceding read. The hash check catches changes already made by another writer; it is not an OS-wide file lock. Replacements are staged in a neighboring temporary file and renamed; filesystem hard-link relationships and custom per-file metadata are not guaranteed to survive replacement.

Text operations accept files up to 8 MiB; read output is limited to 64 KiB per call. Search scans at most 10,000 entries, searches content only in UTF-8 files up to 1 MiB, and skips `.git`, `node_modules`, `.venv`, `venv`, `dist`, `.next`, and directory links. For other encodings, binary data, huge files, or different search rules, use PowerShell. Directory creation, moves, copies, and deletion are also available through PowerShell; writing a file can create its parents directly.

## Commands and background jobs

Try: “In project `example`, start `npm run dev` as a background job, then check its output.”

Commands use PowerShell syntax. For cmd syntax, invoke `cmd.exe /d /c ...` explicitly. Each call starts a new, noninteractive PowerShell process; environment assignments and location changes do not persist between jobs. Scripts go into UTF-8 files rather than a giant command-line argument, supporting Unicode and multiline/large scripts.

`run_command` defaults to a 60-second timeout (maximum 600 seconds). `start_command` defaults to no deadline, with an optional timeout up to 24 hours. Both produce persistent job IDs. A detached supervisor writes state and log files independently of the tool invocation. Closing a chat does not request cancellation. A Windows reboot ends processes; stale records report `unknown`, not success.

Poll `job_status` using `stdout.next_offset` and `stderr.next_offset` as the next call's `stdout_offset` and `stderr_offset`. The cursors are **byte offsets**. Default output is 32 KiB per stream per call. `stop_job` returns `stop_requested`; poll again to confirm `cancelled` or another final result. Cancellation and timeouts terminate the normal child process tree using Windows `taskkill /T`; programs that deliberately escape/reparent their process trees are outside this guarantee.

The supervisor checks log sizes every 200 ms and stops the job if either stream exceeds 16 MiB. A burst can overshoot that threshold. Scripts, logs, results, and installer backups are retained until you remove them; there is no automatic retention cleanup in v0.1. Set `POWERSHELL_PATH` on the two command tools to an absolute `pwsh.exe` path to use PowerShell 7 instead of 5.1.

## Image viewing

`view_image` uses AnythingLLM's `this.super.addToolAttachment()` channel. The image is attached for the model's next turn; its base64 is never returned as tool-result prose. It accepts PNG, JPEG, GIF, or WebP up to 8 MiB, and checks the file signature. Convert other formats first.

This needs a vision-capable agent model/provider and an AnythingLLM build exposing that attachment hook. The tool reports an explicit compatibility error on older builds. The hook is present in current upstream agent code, but it is an internal API rather than a stable custom-skill API. The model/provider controls which image formats it accepts and whether animated images are supported. No external image service is called by the plugin itself.

## SKILL.md workflows

Skill discovery checks these directories, looking one level down for `<skill>/SKILL.md`:

| Scope | Directories |
| --- | --- |
| Project | `<project>\.agents\skills`, `<project>\.claude\skills` |
| User | `%USERPROFILE%\.agents\skills`, `%USERPROFILE%\.claude\skills` |

`list_skills` returns names, description previews, scope, and paths. `read_skill` returns the full Markdown unchanged and the directory to use when resolving references such as `scripts/check.ps1` or `references/details.md`. The existing read/file/command tools can access those resources. The preview extractor handles common scalar and block-string frontmatter; it is not a full YAML parser, and full instructions remain available if metadata is unusual.

These are instruction documents, distinct from AnythingLLM's “agent skills,” which are the actual JavaScript tools installed by this package. Discovery is on demand; installing this does not automatically inject every skill into every chat. You can install a skill by copying its folder into one of the listed locations, or use the shell/file tools to create it.

Suggested workspace instructions:

```text
Use the Made Useful tools for local work. Specify the project explicitly in every call.
At the start of a task, discover available SKILL.md skills and read relevant ones.
Resolve a skill's relative resources from the base_directory returned by read_skill.
Use dedicated file/image tools when suitable; use PowerShell for other operations.
Run long-lived commands with start_command and keep their job IDs.
Check job state and exit code before saying a command succeeded.
When editing, read first, preserve line endings, and use the returned SHA-256.
```

## Execution context and state

The tools run with the same Windows account and permissions as AnythingLLM. Project directories are working-directory conveniences, **not a sandbox**; the command tool can access anything that account can. The built-in AnythingLLM filesystem tool's allowed-folder list does not govern these custom tools. No extra per-call approval UI is implemented by this package. File contents and images returned to the agent go to its configured model provider, just like other agent inputs.

State defaults to `<AnythingLLM storage>\plugins\anythingllm-made-useful`, separate from individual installed tool folders. It contains `projects`, `jobs`, and upgrade `backups`. An optional `STATE_DIRECTORY` setting overrides this; set the same absolute path on all Made Useful tools.

Rerun the installer to upgrade. It preserves each tool's enabled state and configuration values, keeps the old version in a timestamped backup, and leaves state/project files intact. Run `Uninstall.cmd` to remove the tools. Stop background jobs first if desired; uninstall does not terminate them or delete state/project files.

## Build and test

Development requires Node 18+ and Windows for PowerShell integration tests. There are no npm dependencies.

```powershell
npm run build
npm test
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Compress-Archive -Path "dist\AnythingLLM-made-useful-$version-windows" -DestinationPath "dist\AnythingLLM-made-useful-$version-windows.zip" -Force
```

The build generates one self-contained plugin folder per tool and includes the installers and checksums. Common JavaScript is copied into each tool so the normal AnythingLLM loader can load each independently. Source stays in `src`; do not hand-edit generated `dist` files.

The Windows GitHub Actions workflow builds and runs tests on Node 18 and 24, including real PowerShell launches, Unicode/paths, exit codes, timeouts, cancellation, installation, and upgrade/uninstall behavior. It then creates an installable ZIP and SHA-256 file. On a `v*` tag matching `package.json`, it also publishes a GitHub Release with those assets. To release:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Local non-Windows runs skip Windows integration tests. The test suite exercises the attachment contract with a fake agent host; live model behavior and the AnythingLLM Desktop UI require an application smoke test.

## References

- [AnythingLLM custom skill guide](https://docs.anythingllm.com/agent/custom/developer-guide)
- [Manifest reference](https://docs.anythingllm.com/agent/custom/plugin-json)
- [Handler reference](https://docs.anythingllm.com/agent/custom/handler-js)
- [Windows Desktop storage location](https://docs.anythingllm.com/installation-desktop/storage)
- [Upstream image attachment implementation](https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/agents/aibitat/index.js)
- [Upstream filesystem image use](https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/agents/aibitat/plugins/filesystem/read-text-file.js)
