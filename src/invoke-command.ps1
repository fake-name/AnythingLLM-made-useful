param([Parameter(Mandatory=$true)][string]$CommandFile)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
$OutputEncoding = $utf8
$global:LASTEXITCODE = 0
try {
    & $CommandFile
    if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.ToString())
    exit 1
}
