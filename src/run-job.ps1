param([Parameter(Mandatory=$true)][string]$JobDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save-Json([string]$Name, $Value) {
    $file = Join-Path $JobDirectory $Name
    $temp = $file + '.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8 -Compress), $utf8)
    Move-Item -LiteralPath $temp -Destination $file -Force
}
function Stop-CommandTree($Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
        & $taskkill /PID $Process.Id /T /F 2>&1 | Out-Null
        if (-not $Process.WaitForExit(5000)) { throw 'The command tree did not stop within five seconds.' }
    }
}
$child = $null
try {
    $request = Get-Content -LiteralPath (Join-Path $JobDirectory 'request.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $started = [DateTime]::UtcNow
    Save-Json 'heartbeat.json' @{ updated_at = $started.ToString('o'); supervisor_pid = $PID }
    $stdout = Join-Path $JobDirectory 'stdout.log'
    $stderr = Join-Path $JobDirectory 'stderr.log'
    $wrapper = Join-Path $JobDirectory 'invoke-command.ps1'
    $commandFile = Join-Path $JobDirectory 'command.ps1'
    # Paths cannot contain double quotes on Windows. Quote the two file paths
    # because Start-Process joins ArgumentList into one Windows command line.
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $wrapper + '" -CommandFile "' + $commandFile + '"'
    $child = Start-Process -FilePath $request.executable -ArgumentList $arguments -WorkingDirectory $request.cwd -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $null = $child.Handle # retain a process handle so ExitCode remains available
    $reason = 'completed'
    while (-not $child.HasExited) {
        if (Test-Path -LiteralPath (Join-Path $JobDirectory 'stop.request')) { $reason = 'cancelled'; break }
        if ($request.timeout_seconds -gt 0 -and ([DateTime]::UtcNow - $started).TotalSeconds -ge $request.timeout_seconds) { $reason = 'timed_out'; break }
        $outLength = (Get-Item -LiteralPath $stdout -ErrorAction SilentlyContinue).Length
        $errLength = (Get-Item -LiteralPath $stderr -ErrorAction SilentlyContinue).Length
        if ($outLength -gt $request.max_log_bytes -or $errLength -gt $request.max_log_bytes) { $reason = 'output_limit'; break }
        Save-Json 'heartbeat.json' @{ updated_at = [DateTime]::UtcNow.ToString('o'); supervisor_pid = $PID; command_pid = $child.Id }
        Start-Sleep -Milliseconds 200
        $child.Refresh()
    }
    if ($reason -ne 'completed') { Stop-CommandTree $child }
    $child.WaitForExit() # flush asynchronous redirected stream writes
    $exitCode = $child.ExitCode
    if ($reason -eq 'completed' -and $exitCode -ne 0) { $reason = 'failed' }
    Save-Json 'result.json' @{ state = $reason; exit_code = $exitCode; completed_at = [DateTime]::UtcNow.ToString('o') }
} catch {
    $message = $_.ToString()
    try { Stop-CommandTree $child } catch { $message += '; cleanup: ' + $_.ToString() }
    Save-Json 'result.json' @{ state = 'failed'; error = $message; completed_at = [DateTime]::UtcNow.ToString('o') }
    [Console]::Error.WriteLine($message)
    exit 1
} finally {
    if ($null -ne $child) { $child.Dispose() }
}
