param(
    [Parameter(Mandatory=$true)][string]$CommandFile,
    [string]$CwdFile,
    [string]$WorkingDirectory
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
$OutputEncoding = $utf8
$global:LASTEXITCODE = 0
$code = 0
try {
    # PowerShell 5.1 can fall back to PSHOME when the native initial directory
    # contains wildcard characters. Establish its provider location explicitly.
    if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
    & $CommandFile
    if ($null -ne $LASTEXITCODE) { $code = $LASTEXITCODE }
} catch {
    [Console]::Error.WriteLine($_.ToString())
    $code = 1
} finally {
    if ($CwdFile) { [IO.File]::WriteAllText($CwdFile, (Get-Location).Path, $utf8) }
}
exit $code
