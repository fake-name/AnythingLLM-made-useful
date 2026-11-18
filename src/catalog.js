"use strict";
// Public argument names follow Claude Code's Agent SDK definitions. Descriptions
// describe this implementation honestly; see docs/compatibility.md for differences.
const s = description => ({ type: "string", description });
const n = description => ({ type: "number", description });
const b = description => ({ type: "boolean", description });
const file_path = s("Absolute path to the file.");
const shell = {
  command: s("The command to execute."),
  timeout: n("Timeout in milliseconds. Foreground: default 120000, maximum 600000. Background: default 1800000, maximum 7200000."),
  description: s("Brief description of what the command does."),
  run_in_background: b("Run in the background and return a task ID and output paths immediately."),
  dangerouslyDisableSandbox: b("Accepted for API compatibility. Commands already run as the current Windows user without a sandbox.")
};
const tools = [
  ["Read", "Read UTF-8 text with 1-based offset/limit, or view a PNG/JPEG/GIF/WebP image. Text defaults to 2000 lines with a 64 KiB output cap. Read existing files before Edit or Write. PDFs/notebooks are not rendered.", { file_path, offset: n("First line to read, starting at 1."), limit: n("Number of lines to read, default 2000."), pages: s("PDF page range. PDF rendering is not supported by this package."), allow_large: b("Raise the text output cap to 256 KiB; the file size limit remains 8 MiB.") }, ["file_path"]],
  ["Write", "Write a UTF-8 file, creating parent directories and overwriting if it exists. Existing files must have been Read in this agent session; refuse stale reads.", { file_path, content: s("Complete file content. May be empty.") }, ["file_path", "content"]],
  ["Edit", "Replace exact text in a file already Read in this session. Preserve indentation and CRLF/LF. Reject ambiguous matches unless replace_all is true; reject stale reads.", { file_path, old_string: s("Exact nonempty text to replace."), new_string: s("Replacement text, different from old_string. May be empty."), replace_all: b("Replace all occurrences; default false.") }, ["file_path", "old_string", "new_string"]],
  ["Glob", "Find files using glob patterns such as **/*.js. Results are absolute paths sorted by modification time, newest first. Uses ripgrep, respects ignore files, and returns at most 100 paths.", { pattern: s("Glob pattern to match."), path: s("Directory to search. Defaults to the selected project directory.") }, ["pattern"]],
  ["Grep", "Search file contents with ripgrep regular expressions. Default output_mode is files_with_matches. Supports glob/type filters, context, case-insensitive and multiline search. Use Read for whole files.", {
    pattern: s("Regular expression to search for."), path: s("File or directory to search. Defaults to the selected project."), glob: s("Glob filter, for example *.ts or *.{js,ts}."),
    output_mode: { ...s("files_with_matches (default), content, or count."), enum: ["content", "files_with_matches", "count"] },
    "-B": n("Lines before each match, for content output."), "-A": n("Lines after each match, for content output."), "-C": n("Lines around each match, for content output."), context: n("Alias for -C."),
    "-n": b("Show line numbers in content output; default true."), "-i": b("Case-insensitive search; default false."), "-o": b("Show only matched text; requires content mode."),
    type: s("ripgrep file type, for example js, py, or rust."), head_limit: n("Maximum returned lines/files/counts, default 250; 0 disables this limit. A 256 KiB response cap still applies."), offset: n("Skip this many output lines/files/counts."), multiline: b("Match across lines; enables ripgrep --multiline --multiline-dotall.")
  }, ["pattern"]],
  ["Bash", "Execute a real Git Bash command on Windows. Requires Git for Windows. Foreground directory changes persist for the selected conversation; environment variables do not. Use run_in_background for long tasks, Read on output files, and TaskStop to cancel. Check exit_code before claiming success.", shell, ["command"]],
  ["PowerShell", "Execute PowerShell on Windows (5.1 built in, or configured PowerShell 7). Same command/timeout/run_in_background interface as Bash. Directory changes persist for foreground commands; variables do not. Check exit_code before claiming success.", shell, ["command"]],
  ["TaskOutput", "Retrieve stdout, stderr and status from a background task. Compatibility with older Claude Code TaskOutput. Set block=true to wait up to timeout milliseconds. Output can also be read from the returned file paths.", { task_id: s("Task ID returned by Bash or PowerShell."), block: b("Wait for completion; default true."), timeout: n("Maximum wait in milliseconds, default 30000, maximum 600000.") }, ["task_id"]],
  ["TaskStop", "Stop a running background shell task and its normal descendant process tree. Returns the observed state; a stop request is not completion.", { task_id: s("Task ID to stop."), shell_id: s("Deprecated alias for task_id.") }, []],
  ["Skill", "Load a SKILL.md workflow by name from the selected project or user .agents/skills and .claude/skills. Use ListSkills to discover names. Follow returned instructions and resolve references from base_directory. Optional args replace $ARGUMENTS; scripts are not automatically executed.", { skill: s("Name returned by ListSkills."), args: s("Optional arguments for the skill.") }, ["skill"]],
  ["SetProject", "Select a registered project name or absolute directory for Bash, PowerShell, Glob, Grep and skills. Selection persists per AnythingLLM workspace/user/thread when available, otherwise for this agent invocation. Never changes the app's process directory.", { project: s("Registered name or absolute directory.") }, ["project"]],
  ["ListProjects", "List registered project names and directories, and the currently selected working directory.", {}, []],
  ["RegisterProject", "Register an existing absolute project directory under a reusable name. Does not select it; call SetProject to select it.", { name: s("Name: letters, digits, underscore or hyphen, up to 64 characters."), directory: s("Existing absolute directory; ~ and %USERPROFILE% are supported.") }, ["name", "directory"]],
  ["ForgetProject", "Forget a project registration without deleting its files.", { name: s("Registered project name.") }, ["name"]],
  ["ListSkills", "Discover SKILL.md names and descriptions in the selected project and user .agents/skills and .claude/skills directories. Call Skill to load the full workflow.", {}, []],
  ["ListTasks", "List recent persistent shell task IDs, output paths, working directories and creation times. Call TaskOutput for state and output.", { limit: n("Maximum tasks, default 50, maximum 500.") }, []]
];
module.exports = tools.map(([id, description, params, required]) => ({ id, name: id, operation: `agent.${id}`, description, params, required }));
