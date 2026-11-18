param(
    [Parameter(Mandatory=$true)][string]$JobDirectory,
    [Parameter(Mandatory=$true)][string]$SupervisorExecutable
)
$ErrorActionPreference = 'Stop'
# Start-Process gives the supervisor its own hidden Windows console. Direct
# detached Node spawns make PowerShell exit silently; sharing the Node console
# also makes the supervisor vulnerable when that console's owner exits.
$script = Join-Path $JobDirectory 'run-job.ps1'
$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script + '" -JobDirectory "' + $JobDirectory + '"'
Start-Process -FilePath $SupervisorExecutable -ArgumentList $arguments -WindowStyle Hidden -WorkingDirectory $env:SystemRoot -RedirectStandardOutput (Join-Path $JobDirectory 'supervisor.stdout.log') -RedirectStandardError (Join-Path $JobDirectory 'supervisor.stderr.log') | Out-Null
