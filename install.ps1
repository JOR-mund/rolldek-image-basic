param([string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $codexDirectory = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $Destination = Join-Path $codexDirectory 'skills\rolldek-image-basic'
}
$Destination = [System.IO.Path]::GetFullPath($Destination)
if ($Destination.TrimEnd('\') -eq $sourceDirectory.TrimEnd('\')) { throw 'Choose an installation directory different from the package source.' }
$manifestFile = Join-Path $sourceDirectory 'package-manifest.json'
$manifest = [System.IO.File]::ReadAllText($manifestFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$sourcePrefix = $sourceDirectory.TrimEnd('\') + '\'
$destinationPrefix = $Destination.TrimEnd('\') + '\'
$verifiedFiles = @(foreach ($item in $manifest.files) {
    if ([System.IO.Path]::IsPathRooted($item.path) -or $item.path -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Invalid package path.' }
    $sourceFile = [System.IO.Path]::GetFullPath((Join-Path $sourceDirectory $item.path))
    $destinationFile = [System.IO.Path]::GetFullPath((Join-Path $Destination $item.path))
    if (-not $sourceFile.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase) -or -not $destinationFile.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path leaves the installation directory.' }
    $actualHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
    if ($actualHash -ne $item.sha256) { throw ('Package integrity check failed: ' + $item.path) }
    [pscustomobject]@{ Source=$sourceFile; Destination=$destinationFile }
})
foreach ($item in $verifiedFiles) {
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $item.Destination)) | Out-Null
    [System.IO.File]::Copy($item.Source, $item.Destination, $true)
}
[System.IO.File]::Copy($manifestFile, (Join-Path $Destination 'package-manifest.json'), $true)
Write-Output ('Installed rolldek-image-basic to ' + $Destination)
Write-Output 'Existing runtime configuration and credentials were not read or changed.'
Write-Output 'Open model settings: node <installation-directory>\scripts\rolldek.mjs configure'
