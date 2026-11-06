param([Parameter(Mandatory=$true)][string]$VaultPath, [Parameter(Mandatory=$true)][string]$KeyAlias)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
try {
    $vault = Get-Content -LiteralPath $VaultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $entry = $vault.keys.PSObject.Properties[$KeyAlias]
    if ($null -eq $entry -or [string]::IsNullOrWhiteSpace($entry.Value)) { throw 'Missing credential' }
    $entropy = [System.Text.Encoding]::UTF8.GetBytes('rolldek-image-v1')
    $credentialBytes = [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($entry.Value), $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
        $keyValue = [System.Text.Encoding]::UTF8.GetString($credentialBytes)
        @{ key = $keyValue } | ConvertTo-Json -Compress
    } finally {
        [Array]::Clear($credentialBytes, 0, $credentialBytes.Length)
        $keyValue = $null
    }
} catch {
    [Console]::Error.WriteLine('Credential unavailable for this Windows account.')
    exit 1
}
