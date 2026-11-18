$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = '15.2.0'
$asset = "ripgrep-$version-x86_64-pc-windows-msvc.zip"
$expected = '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5'
$vendor = Join-Path $root 'vendor\ripgrep'
$temp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
    $archive = Join-Path $temp $asset
    Invoke-WebRequest -Uri "https://github.com/BurntSushi/ripgrep/releases/download/$version/$asset" -OutFile $archive -UseBasicParsing
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'ripgrep archive SHA-256 mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $temp 'expanded')
    $source = Join-Path $temp ('expanded\' + $asset.Replace('.zip', ''))
    New-Item -ItemType Directory -Path $vendor -Force | Out-Null
    foreach ($file in @('rg.exe', 'COPYING', 'LICENSE-MIT', 'UNLICENSE')) {
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $vendor $file) -Force
    }
    Set-Content -LiteralPath (Join-Path $vendor 'SOURCE.txt') -Value "ripgrep $version, upstream release $asset, SHA-256 $expected" -Encoding ascii
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
