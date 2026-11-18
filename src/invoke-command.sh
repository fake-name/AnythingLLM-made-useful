#!/usr/bin/env bash
command_file=$1
cwd_file=$2
shift 2
# Git Bash's -W emits a Windows path usable by the other tools. Environment
# assignments stay local to this process; only the working directory persists.
trap 'printf "%s\n" "$(pwd -W)" > "$cwd_file"' EXIT
source "$command_file"
