# TXT transfer helpers. Credentials remain in memory until an explicit UI export.
function Protect-ModelCredential([string]$KeyText) {
    if ([string]::IsNullOrWhiteSpace($KeyText) -or $KeyText -match '\s') { throw '密钥不能为空或包含空白字符。' }
    $credentialBytes = [System.Text.Encoding]::UTF8.GetBytes($KeyText)
    $entropy = [System.Text.Encoding]::UTF8.GetBytes('rolldek-image-v1')
    try {
        return [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($credentialBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))
    } finally { [Array]::Clear($credentialBytes, 0, $credentialBytes.Length) }
}

function Get-ModelCredential($ModelConfig, $Vault) {
    if ($ModelConfig.key_env) { return [string][Environment]::GetEnvironmentVariable($ModelConfig.key_env) }
    if (-not $ModelConfig.key_alias -or -not $Vault.keys.Contains($ModelConfig.key_alias)) { return '' }
    $entropy = [System.Text.Encoding]::UTF8.GetBytes('rolldek-image-v1')
    try {
        $credentialBytes = [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($Vault.keys[$ModelConfig.key_alias]), $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    } catch { throw '有密钥无法由当前 Windows 账户解密，未导出文件。' }
    try { return [System.Text.Encoding]::UTF8.GetString($credentialBytes) }
    finally { [Array]::Clear($credentialBytes, 0, $credentialBytes.Length) }
}

function ConvertTo-ModelKeysTxt($Config, $Vault) {
    if ($Config.profiles.Count -eq 0) { throw '当前没有可导出的模型配置。' }
    $rows = @(foreach ($name in $Config.profiles.Keys) {
        $modelConfig = $Config.profiles[$name]
        $defaults = if ($null -eq $modelConfig.defaults) { '{}' } else { $modelConfig.defaults | ConvertTo-Json -Depth 20 -Compress }
        [pscustomobject][ordered]@{
            profile = $name
            model = $modelConfig.model
            key = Get-ModelCredential $modelConfig $Vault
            key_alias = $modelConfig.key_alias
            channel_mode = $modelConfig.channel_mode
            is_default = ($name -eq $Config.default_profile).ToString().ToLowerInvariant()
            defaults = $defaults
        }
    })
    $table = @($rows | ConvertTo-Csv -Delimiter "`t" -NoTypeInformation)
    return (@('# RollDek model keys TXT v1', '# 此文件包含明文密钥，请自行保管。') + $table -join "`r`n") + "`r`n"
}

function ConvertFrom-ModelKeysTxt([string]$Text, $Config, $Catalog) {
    $lines = @($Text.TrimStart([char]0xFEFF) -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and -not $_.TrimStart().StartsWith('#') })
    if ($lines.Count -eq 0) { throw 'TXT 中没有模型记录。' }
    $rawRows = @()
    if ($lines[0] -match '^\s*"?profile"?[\t,|]') {
        $delimiter = if ($lines[0].Contains("`t")) { [char]9 } elseif ($lines[0].Contains('|')) { [char]'|' } else { [char]',' }
        try { $rawRows = @(($lines -join "`n") | ConvertFrom-Csv -Delimiter $delimiter) }
        catch { throw 'TXT 表格格式错误，请使用本界面导出的格式。' }
        if ($rawRows.Count -eq 0) { throw 'TXT 表格中没有模型记录。' }
        foreach ($required in @('profile','model','key')) {
            if ($rawRows[0].PSObject.Properties.Name -notcontains $required) { throw 'TXT 表格需要 profile、model 和 key 列。' }
        }
    } else {
        foreach ($line in $lines) {
            $parts = ([regex]'\s*=\s*|\s*\|\s*|\s*,\s*|\t+|\s+').Split($line.Trim(), 2)
            if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[1])) { throw '快捷 TXT 格式应为每行“API模型=密钥”。' }
            $matchingProfiles = @($Config.profiles.Keys | Where-Object { $Config.profiles[$_].model -eq $parts[0] })
            if ($matchingProfiles.Count -gt 1) { throw '某个模型存在多个渠道，请使用完整 TXT 格式指定配置名称。' }
            $name = if ($matchingProfiles.Count -eq 1) { $matchingProfiles[0] } else { $parts[0] }
            $rawRows += [pscustomobject]@{ profile = $name; model = $parts[0]; key = $parts[1]; is_default = 'false' }
        }
    }
    $allowedModels = @($Catalog | Where-Object { $_.documented -and -not $_.hidden } | ForEach-Object { $_.id })
    $seenNames = @{}
    $aliasValues = @{}
    $defaultCount = 0
    $entries = @()
    $rowIndex = 0
    foreach ($record in $rawRows) {
        $rowIndex++
        $name = ([string]$record.profile).Trim()
        $model = ([string]$record.model).Trim()
        $keyText = ([string]$record.key).Trim()
        if ([string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 120 -or $name -match '[\t\r\n]') { throw "第 $rowIndex 条记录的配置名称不合法。" }
        if ($seenNames.ContainsKey($name)) { throw "第 $rowIndex 条记录与前面的配置名称重复。" }
        $seenNames[$name] = $true
        if ($allowedModels -notcontains $model) { throw "第 $rowIndex 条记录的 API 模型不在当前可用模型列表中。" }
        if ($keyText -match '\s') { throw "第 $rowIndex 条记录的密钥包含空白字符。" }
        $previous = if ($Config.profiles.Contains($name)) { $Config.profiles[$name] } else { $null }
        $alias = if (-not [string]::IsNullOrWhiteSpace([string]$record.key_alias)) { ([string]$record.key_alias).Trim() } elseif ($previous -and $previous.key_alias) { [string]$previous.key_alias } else { $name }
        if ($alias.Length -gt 120 -or $alias -match '[\t\r\n]') { throw "第 $rowIndex 条记录的密钥绑定名称不合法。" }
        if ($keyText.Length -gt 0) {
            if ($aliasValues.ContainsKey($alias) -and $aliasValues[$alias] -cne $keyText) { throw "第 $rowIndex 条记录对同一个密钥绑定填写了不同密钥。" }
            $aliasValues[$alias] = $keyText
        }
        $mode = if (-not [string]::IsNullOrWhiteSpace([string]$record.channel_mode)) { ([string]$record.channel_mode).Trim().ToLowerInvariant() } elseif ($previous -and $previous.model -eq $model) { [string]$previous.channel_mode } else { 'unknown' }
        $family = @($Catalog | Where-Object { $_.id -eq $model })[0].family
        if ($family -ne 'gpt25' -and $mode -eq 'unknown') { $mode = 'fixed' }
        if (@('fixed','official','unknown') -notcontains $mode -or ($family -eq 'gpt25' -and $mode -eq 'unknown' -and $keyText.Length -gt 0)) { throw "第 $rowIndex 条记录需要明确填写渠道规则 fixed 或 official。" }
        $defaultText = ([string]$record.is_default).Trim().ToLowerInvariant()
        if (@('','true','false','1','0','yes','no') -notcontains $defaultText) { throw "第 $rowIndex 条记录的 is_default 应为 true 或 false。" }
        $isDefault = @('true','1','yes') -contains $defaultText
        if ($isDefault) { $defaultCount++ }
        if ($defaultCount -gt 1) { throw 'TXT 只能指定一个默认配置。' }
        $defaults = if ($previous -and $null -ne $previous.defaults) { $previous.defaults } else { [ordered]@{} }
        if (-not [string]::IsNullOrWhiteSpace([string]$record.defaults)) {
            try { $parsedDefaults = ([string]$record.defaults) | ConvertFrom-Json -ErrorAction Stop }
            catch { throw "第 $rowIndex 条记录的 defaults 不是有效 JSON 对象。" }
            if ($parsedDefaults -isnot [System.Management.Automation.PSCustomObject]) { throw "第 $rowIndex 条记录的 defaults 必须为 JSON 对象。" }
            $defaults = $parsedDefaults
        }
        $entries += [pscustomobject]@{ profile = $name; model = $model; key = $keyText; key_alias = $alias; channel_mode = $mode; is_default = $isDefault; defaults = $defaults }
    }
    return $entries
}
