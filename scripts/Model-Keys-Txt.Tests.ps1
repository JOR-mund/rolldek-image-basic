param([Parameter(Mandatory=$true)][string]$TempRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
. (Join-Path $PSScriptRoot 'Model-Keys-Txt.ps1')
$resolvedRoot = [System.IO.Path]::GetFullPath($TempRoot)
$tempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $resolvedRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Tests require an isolated temporary directory.' }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert-True $rejected 'An invalid TXT import was accepted.'
}
$catalog = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\assets\catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json).models
$config = [ordered]@{ default_profile = 'sunburst'; profiles = [ordered]@{
    sunburst = [ordered]@{ model='gpt-image-2.5-sunburst'; key_alias='shared'; channel_mode='official'; defaults=[ordered]@{ quality='high' } }
    banana = [ordered]@{ model='gemini-3-pro-image-preview'; key_alias='shared'; channel_mode='fixed'; defaults=[ordered]@{} }
    flash = [ordered]@{ model='gemini-3.1-flash-image-preview'; key_alias='missing'; channel_mode='fixed'; defaults=[ordered]@{} }
} }
$vault = [ordered]@{ keys = [ordered]@{ shared = Protect-ModelCredential 'synthetic-shared-credential==' } }
$beforeConfig = $config | ConvertTo-Json -Depth 20 -Compress
$beforeVault = $vault | ConvertTo-Json -Depth 20 -Compress
$text = ConvertTo-ModelKeysTxt $config $vault
$records = @(ConvertFrom-ModelKeysTxt $text $config $catalog)
Assert-True ($records.Count -eq 3) 'TXT round trip lost a model.'
Assert-True ($records[0].key -ceq 'synthetic-shared-credential==' -and $records[1].key -ceq $records[0].key) 'Shared key values were not preserved.'
Assert-True ($records[0].key_alias -eq 'shared' -and $records[1].key_alias -eq 'shared') 'Shared key aliases were not preserved.'
Assert-True ($records[0].channel_mode -eq 'official' -and $records[0].is_default) 'Channel mode or default profile was lost.'
Assert-True ($records[0].defaults.quality -eq 'high') 'Default generation settings were lost.'
Assert-True ([string]::IsNullOrEmpty($records[2].key)) 'Missing-key profile was not preserved.'
$quick = @(ConvertFrom-ModelKeysTxt 'gemini-3-pro-image-preview=synthetic-updated==' $config $catalog)
Assert-True ($quick[0].profile -eq 'banana' -and $quick[0].key -ceq 'synthetic-updated==') 'Quick import did not retain an equals suffix or the existing profile.'
foreach ($delimiter in @("`t",'|',',',' ')) {
    $quick = @(ConvertFrom-ModelKeysTxt ('gemini-3-pro-image-preview' + $delimiter + 'synthetic-fast-key') $config $catalog)
    Assert-True ($quick[0].key -ceq 'synthetic-fast-key') 'A supported quick delimiter failed.'
}
Assert-Rejected { ConvertFrom-ModelKeysTxt "gemini-3-pro-image-preview=synthetic`nunknown-model=synthetic" $config $catalog }
Assert-Rejected { ConvertFrom-ModelKeysTxt 'gpt-image-2=synthetic' $config $catalog }
Assert-Rejected { ConvertFrom-ModelKeysTxt 'gemini-3-pro-image-preview=contains whitespace' $config $catalog }
$duplicate = @(
    [pscustomobject]@{ profile='same'; model='gemini-3-pro-image-preview'; key='synthetic'; key_alias='a'; channel_mode='fixed'; is_default='false' },
    [pscustomobject]@{ profile='same'; model='gemini-3.1-flash-image-preview'; key='synthetic'; key_alias='b'; channel_mode='fixed'; is_default='false' }
)
Assert-Rejected { ConvertFrom-ModelKeysTxt (($duplicate | ConvertTo-Csv -Delimiter "`t" -NoTypeInformation) -join "`n") $config $catalog }
$duplicate[1].profile = 'different'
$duplicate[1].key_alias = 'a'
$duplicate[1].key = 'synthetic-other'
Assert-Rejected { ConvertFrom-ModelKeysTxt (($duplicate | ConvertTo-Csv -Delimiter "`t" -NoTypeInformation) -join "`n") $config $catalog }
$duplicate[1].key = 'synthetic'
$duplicate[0].is_default = 'true'
$duplicate[1].is_default = 'true'
Assert-Rejected { ConvertFrom-ModelKeysTxt (($duplicate | ConvertTo-Csv -Delimiter "`t" -NoTypeInformation) -join "`n") $config $catalog }
$emptyConfig = [ordered]@{ profiles=[ordered]@{} }
Assert-Rejected { ConvertFrom-ModelKeysTxt 'gpt-image-2.5-sunburst=synthetic' $emptyConfig $catalog }
Assert-True (($config | ConvertTo-Json -Depth 20 -Compress) -ceq $beforeConfig) 'Validation changed the source configuration.'
Assert-True (($vault | ConvertTo-Json -Depth 20 -Compress) -ceq $beforeVault) 'Validation changed the encrypted source credentials.'
$records = $null
$quick = $null
$text = $null
Write-Output 'TXT transfer tests passed: shared bindings, default settings, empty credentials, quick formats, complete validation, no partial mutation.'
