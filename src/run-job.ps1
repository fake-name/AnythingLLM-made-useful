param([Parameter(Mandatory=$true)][string]$JobDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save-Json([string]$Name, $Value) {
    $file = Join-Path $JobDirectory $Name
    $temp = $file + '.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8 -Compress), $utf8)
    # PowerShell 5.1 coerces $null string arguments to an empty path. Use a
    # concrete backup path while atomically replacing the live status file.
    if ([IO.File]::Exists($file)) { [IO.File]::Replace($temp, $file, ($file + '.previous')) }
    else { [IO.File]::Move($temp, $file) }
}
function Stop-CommandTree($Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
        & $taskkill /PID $Process.Id /T /F 2>&1 | Out-Null
        if (-not $Process.WaitForExit(5000)) { throw 'The command tree did not stop within five seconds.' }
    }
}
$child = $null
$outFile = $null
$errFile = $null
try {
    $request = Get-Content -LiteralPath (Join-Path $JobDirectory 'request.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $started = [DateTime]::UtcNow
    Save-Json 'heartbeat.json' @{ updated_at = $started.ToString('o'); supervisor_pid = $PID }
    $stdout = Join-Path $JobDirectory 'stdout.log'
    $stderr = Join-Path $JobDirectory 'stderr.log'
    $wrapper = Join-Path $JobDirectory 'invoke-command.ps1'
    $commandFile = Join-Path $JobDirectory 'command.ps1'
    $cwdFile = Join-Path $JobDirectory 'cwd.txt'
    $workingDirectory = [IO.Path]::Combine($request.cwd, '.')
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $wrapper + '" -CommandFile "' + $commandFile + '" -CwdFile "' + $cwdFile + '" -WorkingDirectory "' + $workingDirectory + '"'
    if ($request.shell -eq 'bash') {
        $wrapper = (Join-Path $JobDirectory 'invoke-command.sh').Replace('\', '/')
        $commandFile = (Join-Path $JobDirectory 'command.sh').Replace('\', '/')
        $arguments = '--noprofile --norc "' + $wrapper + '" "' + $commandFile + '" "' + $cwdFile.Replace('\', '/') + '"'
    }
    # ProcessStartInfo treats [] and other path characters literally. The
    # Start-Process cmdlet applies wildcard expansion to WorkingDirectory.
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $request.executable
    $info.Arguments = $arguments
    $info.WorkingDirectory = $request.cwd
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $child = New-Object System.Diagnostics.Process
    $child.StartInfo = $info
    $null = $child.Start()
    $child.StandardInput.Close()
    # Copy raw bytes asynchronously; PowerShell event callbacks require a
    # runspace and its default text redirection can change Unicode encoding.
    $outFile = [IO.File]::Open($stdout, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
    $errFile = [IO.File]::Open($stderr, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
    $outCopy = $child.StandardOutput.BaseStream.CopyToAsync($outFile)
    $errCopy = $child.StandardError.BaseStream.CopyToAsync($errFile)
    $reason = 'completed'
    while (-not $child.HasExited) {
        if (Test-Path -LiteralPath (Join-Path $JobDirectory 'stop.request')) { $reason = 'cancelled'; break }
        if ($request.timeout_ms -gt 0 -and ([DateTime]::UtcNow - $started).TotalMilliseconds -ge $request.timeout_ms) { $reason = 'timed_out'; break }
        if ($outFile.Length -gt $request.max_log_bytes -or $errFile.Length -gt $request.max_log_bytes) { $reason = 'output_limit'; break }
        $outFile.Flush()
        $errFile.Flush()
        Save-Json 'heartbeat.json' @{ updated_at = [DateTime]::UtcNow.ToString('o'); supervisor_pid = $PID; command_pid = $child.Id }
        Start-Sleep -Milliseconds 200
        $child.Refresh()
    }
    if ($reason -ne 'completed') { Stop-CommandTree $child }
    $child.WaitForExit()
    if (-not $outCopy.Wait(5000) -or -not $errCopy.Wait(5000)) { throw 'Output handles remained open after the command exited.' }
    $outFile.Flush()
    $errFile.Flush()
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
    if ($null -ne $outFile) { $outFile.Dispose() }
    if ($null -ne $errFile) { $errFile.Dispose() }
    if ($null -ne $child) { $child.Dispose() }
}
