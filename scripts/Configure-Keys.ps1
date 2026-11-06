param([string]$ConfigPath, [switch]$SelfTest, [string]$SelectProfile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
[System.Windows.Forms.Application]::EnableVisualStyles()
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    if ($SelfTest) { throw 'SelfTest requires an isolated ConfigPath.' }
    $codexDirectory = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $ConfigPath = Join-Path $codexDirectory 'rolldek\config.json'
}
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$configDirectory = Split-Path -Parent $ConfigPath
$vaultPath = Join-Path $configDirectory 'vault.dpapi.json'
$skillDirectory = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Model-Keys-Txt.ps1')

function ConvertTo-Map($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $map = [ordered]@{}
        foreach ($prop in $Value.PSObject.Properties) { $map[$prop.Name] = ConvertTo-Map $prop.Value }
        return $map
    }
    if ($Value -is [System.Collections.IDictionary]) { return $Value }
    if ($Value -is [array]) {
        $items = @($Value | ForEach-Object { ConvertTo-Map $_ })
        return ,$items
    }
    return $Value
}
function Read-Map([string]$File) {
    return ConvertTo-Map (Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function Protect-File([string]$File) {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')))
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, 'FullControl', 'Allow')))
    [System.IO.File]::SetAccessControl($File, $acl)
}
function Write-ProtectedText([string]$File, [string]$Text, [bool]$Bom = $false) {
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $File)) | Out-Null
    $temporary = $File + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [System.IO.File]::WriteAllText($temporary, $Text, (New-Object System.Text.UTF8Encoding($Bom)))
    Protect-File $temporary
    if ([System.IO.File]::Exists($File)) { [System.IO.File]::Replace($temporary, $File, [NullString]::Value) }
    else { [System.IO.File]::Move($temporary, $File) }
    Protect-File $File
}
function Write-Map([string]$File, $Value) { Write-ProtectedText $File ($Value | ConvertTo-Json -Depth 30) }
function Copy-Map($Value) { return ConvertTo-Map ($Value | ConvertTo-Json -Depth 30 | ConvertFrom-Json) }
function Save-Stores($NextConfig, $NextVault) {
    try {
        Write-Map $vaultPath $NextVault
        Write-Map $ConfigPath $NextConfig
    } catch {
        try { Write-Map $vaultPath $script:vault; Write-Map $ConfigPath $script:config } catch { }
        throw '保存失败，请检查配置文件是否可写；没有发送任何生成请求。'
    }
    $script:config = $NextConfig
    $script:vault = $NextVault
}
function Ensure-DefaultProfile($Config, $Vault) {
    if ($Config.profiles.Count -eq 0) { $Config.default_profile = ''; return }
    if ($Config.default_profile -and $Config.profiles.Contains($Config.default_profile)) { return }
    $ready = @($Config.profiles.Keys | Where-Object {
        $p = $Config.profiles[$_]
        $Vault.keys.Contains($p.key_alias) -or ($p.key_env -and [Environment]::GetEnvironmentVariable($p.key_env))
    })
    $Config.default_profile = if ($ready.Count -gt 0) { $ready[0] } else { @($Config.profiles.Keys)[0] }
}

[System.IO.Directory]::CreateDirectory($configDirectory) | Out-Null
if (Test-Path -LiteralPath $ConfigPath) { $script:config = Read-Map $ConfigPath }
else {
    $script:config = Read-Map (Join-Path $skillDirectory 'assets\config.example.json')
    Write-Map $ConfigPath $script:config
}
if (Test-Path -LiteralPath $vaultPath) { $script:vault = Read-Map $vaultPath }
else { $script:vault = [ordered]@{ version = 1; protection = 'Windows-DPAPI-CurrentUser'; keys = [ordered]@{} } }
if ($null -eq $script:config.profiles -or $null -eq $script:vault.keys) { throw 'Configuration format is invalid.' }
$catalog = (Read-Map (Join-Path $skillDirectory 'assets\catalog.json')).models
$availableCatalog = @($catalog | Where-Object { $_.documented -and -not $_.hidden })

$form = New-Object System.Windows.Forms.Form
$form.Text = 'RollDek 模型与密钥管理'
$form.ClientSize = New-Object System.Drawing.Size(950, 680)
$form.MinimumSize = New-Object System.Drawing.Size(966, 719)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)

function Add-Label([string]$Text, [int]$X, [int]$Y, [int]$W, [int]$H = 25) {
    $control = New-Object System.Windows.Forms.Label
    $control.Text = $Text
    $control.Location = New-Object System.Drawing.Point($X,$Y)
    $control.Size = New-Object System.Drawing.Size($W,$H)
    $form.Controls.Add($control)
    return $control
}
function Add-Text([int]$X, [int]$Y, [int]$W) {
    $control = New-Object System.Windows.Forms.TextBox
    $control.Location = New-Object System.Drawing.Point($X,$Y)
    $control.Size = New-Object System.Drawing.Size($W,30)
    $form.Controls.Add($control)
    return $control
}
function Add-Combo([int]$X, [int]$Y, [int]$W, [bool]$Editable = $false) {
    $control = New-Object System.Windows.Forms.ComboBox
    $control.Location = New-Object System.Drawing.Point($X,$Y)
    $control.Size = New-Object System.Drawing.Size($W,30)
    $control.DropDownStyle = if ($Editable) { 'DropDown' } else { 'DropDownList' }
    $form.Controls.Add($control)
    return $control
}
function Add-Button([string]$Text, [int]$X, [int]$Y, [int]$W) {
    $control = New-Object System.Windows.Forms.Button
    $control.Text = $Text
    $control.Location = New-Object System.Drawing.Point($X,$Y)
    $control.Size = New-Object System.Drawing.Size($W,38)
    $form.Controls.Add($control)
    return $control
}

$heading = Add-Label '模型、密钥与默认参数' 22 18 850 34
$heading.Font = New-Object System.Drawing.Font('Microsoft YaHei UI',17,[System.Drawing.FontStyle]::Bold)
$null = Add-Label '选左侧配置 → 输入密钥 → 保存。密钥仅在本机加密存储，输入框不会回填已有密钥。' 22 62 900 28
$null = Add-Label '分辨率、画质按模型保存；支持 TXT 批量导入 / 导出模型、密钥与默认参数。' 22 91 900 25
$null = Add-Label '模型 / 渠道配置' 22 126 300
$profileList = New-Object System.Windows.Forms.ListBox
$profileList.Location = New-Object System.Drawing.Point(22,155)
$profileList.Size = New-Object System.Drawing.Size(310,343)
$profileList.HorizontalScrollbar = $true
$profileList.DisplayMember = 'Label'
$form.Controls.Add($profileList)

$null = Add-Label '配置名称（例如 gemini-pro-专线）' 360 126 560
$profileName = Add-Text 360 152 550
$null = Add-Label 'API 模型' 360 190 550
$modelBox = Add-Combo 360 216 550
foreach ($model in $availableCatalog) { $null = $modelBox.Items.Add($model.id) }
$null = Add-Label '密钥绑定名称（可选择已保存名称来共用密钥）' 360 254 560
$aliasBox = Add-Combo 360 280 550 $true
$null = Add-Label '默认分辨率' 360 318 175
$resolutionBox = Add-Combo 360 344 170
$qualityLabel = Add-Label '默认画质' 550 318 175
$qualityBox = Add-Combo 550 344 170
$detailLabel = Add-Label '渠道规则' 740 318 175
$modeBox = Add-Combo 740 344 170
$null = $modeBox.Items.Add('待确认渠道')
$null = $modeBox.Items.Add('非官渠：固定尺寸')
$null = $modeBox.Items.Add('官渠：自定义尺寸')
$null = $modeBox.Items.Add('按模型接口')
$complexityBox = Add-Combo 740 344 170
foreach ($value in @('接口默认', 'low', 'medium', 'high')) { $null = $complexityBox.Items.Add($value) }
$complexityBox.Visible = $false
$keyLabel = Add-Label 'API 密钥（留空保留已有密钥）' 360 382 560
$passwordBox = Add-Text 360 408 550
$passwordBox.UseSystemPasswordChar = $true
$passwordBox.ShortcutsEnabled = $true
$passwordBox.MaxLength = 4096
$defaultCheck = New-Object System.Windows.Forms.CheckBox
$defaultCheck.Text = '设为默认生成配置'
$defaultCheck.Location = New-Object System.Drawing.Point(360,450)
$defaultCheck.Size = New-Object System.Drawing.Size(330,30)
$form.Controls.Add($defaultCheck)
$newButton = Add-Button '新增模型 / 渠道' 22 510 148
$removeButton = Add-Button '移除当前配置' 184 510 148
$importButton = Add-Button '导入 TXT' 22 556 148
$exportButton = Add-Button '导出 TXT' 184 556 148
$saveButton = Add-Button '保存当前配置与密钥' 360 494 280
$closeButton = Add-Button '完成并关闭' 680 494 230
$null = Add-Label '快捷 TXT：每行“API模型=密钥”。完整格式可由导出生成。' 360 550 550 28
$exportHint = Add-Label '导出的 TXT 含明文密钥，请自行保管。' 360 581 550 28
$exportHint.ForeColor = [System.Drawing.Color]::FromArgb(150, 85, 20)
$status = Add-Label '' 22 620 900 42
$status.ForeColor = [System.Drawing.Color]::FromArgb(42, 75, 113)

function Update-Aliases {
    $selected = $aliasBox.Text
    $aliasBox.Items.Clear()
    foreach ($alias in $script:vault.keys.Keys) { $null = $aliasBox.Items.Add($alias) }
    $aliasBox.Text = $selected
}
function Update-Model {
    $selected = @($catalog | Where-Object { $_.id -eq $modelBox.Text })[0]
    $modeBox.Enabled = ($selected.family -eq 'gpt25')
    $modeBox.Visible = ($selected.family -ne 'gpt26')
    $complexityBox.Visible = ($selected.family -eq 'gpt26')
    $complexityBox.SelectedIndex = 0
    $detailLabel.Text = if ($selected.family -eq 'gpt26') { '默认复杂度' } else { '渠道规则' }
    if (-not $modeBox.Enabled) { $modeBox.SelectedIndex = 3 }
    else { $modeBox.SelectedIndex = 0 }
    $resolutionBox.Items.Clear()
    $qualityBox.Items.Clear()
    $qualityLabel.Text = '默认画质'
    $resolutionBox.Enabled = $selected.family -in @('gpt25', 'gpt26', 'seedream', 'gemini-pro', 'gemini-flash', 'gemini-banana21')
    $null = $resolutionBox.Items.Add('接口默认')
    if ($resolutionBox.Enabled) {
        foreach ($value in @('1K', '2K')) { $null = $resolutionBox.Items.Add($value) }
        if ($selected.family -ne 'seedream') { $null = $resolutionBox.Items.Add('4K') }
    }
    $resolutionBox.SelectedIndex = 0
    $qualityBox.Enabled = $selected.family -in @('gpt25', 'gpt26', 'gemini-banana21')
    if ($selected.family -in @('gpt25', 'gpt26')) {
        foreach ($value in @('接口默认', 'auto', 'low', 'medium', 'high', 'xhigh', 'max')) { $null = $qualityBox.Items.Add($value) }
    } elseif ($selected.family -eq 'gemini-banana21') {
        $qualityLabel.Text = '默认思考档位'
        foreach ($value in @('接口默认', 'minimal', 'medium', 'high')) { $null = $qualityBox.Items.Add($value) }
    } else {
        $null = $qualityBox.Items.Add('模型自动')
    }
    $qualityBox.SelectedIndex = 0
    if (-not $selected.documented) {
        $status.Text = '此模型只在公告或模型目录中出现，接口契约待核查；可以保存密钥，当前客户端会阻止生成。'
    }
}
function Refresh-Profiles([string]$SelectName) {
    $profileList.Items.Clear()
    foreach ($name in $script:config.profiles.Keys) {
        $p = $script:config.profiles[$name]
        $hasKey = $script:vault.keys.Contains($p.key_alias) -or ($p.key_env -and [Environment]::GetEnvironmentVariable($p.key_env))
        $mark = if ($hasKey) { '已设置' } else { '待输入' }
        $defaultMark = if ($name -eq $script:config.default_profile) { ' ★' } else { '' }
        $item = [pscustomobject]@{ Name=$name; Label=('{0} [{1}]{2}' -f $name,$mark,$defaultMark) }
        $index = $profileList.Items.Add($item)
        if ($name -eq $SelectName) { $profileList.SelectedIndex = $index }
    }
    $removeButton.Enabled = ($profileList.SelectedIndex -ge 0)
    $exportButton.Enabled = ($profileList.Items.Count -gt 0)
}
function Load-Profile {
    if ($null -eq $profileList.SelectedItem) { return }
    $name = $profileList.SelectedItem.Name
    $p = $script:config.profiles[$name]
    $profileName.Text = $name
    $modelBox.SelectedItem = $p.model
    Update-Model
    $aliasBox.Text = $p.key_alias
    $modeBox.SelectedIndex = switch ($p.channel_mode) { 'fixed' { 1 } 'official' { 2 } default { 0 } }
    if (-not $modeBox.Enabled) { $modeBox.SelectedIndex = 3 }
    if ($resolutionBox.Enabled -and $p.defaults.resolution) {
        $value = ([string]$p.defaults.resolution).ToUpperInvariant()
        if ($resolutionBox.Items.Contains($value)) { $resolutionBox.SelectedItem = $value }
    }
    $selectedModel = @($catalog | Where-Object { $_.id -eq $modelBox.Text })[0]
    $qualityValue = if ($selectedModel.family -eq 'gemini-banana21') { $p.defaults.thinking_level } else { $p.defaults.quality }
    if ($qualityBox.Enabled -and $qualityValue -and $qualityBox.Items.Contains([string]$qualityValue)) { $qualityBox.SelectedItem = [string]$qualityValue }
    if ($selectedModel.family -eq 'gpt26' -and $p.defaults.complexity -and $complexityBox.Items.Contains([string]$p.defaults.complexity)) { $complexityBox.SelectedItem = [string]$p.defaults.complexity }
    $passwordBox.Clear()
    $defaultCheck.Checked = ($name -eq $script:config.default_profile)
    $note = if ($selectedModel.family -eq 'gpt26') { '分辨率控制像素尺寸，画质控制渲染细节，复杂度控制构图规划。' } elseif ($selectedModel.family -eq 'gemini-banana21') { 'high 提高生成前的思考等级，与分辨率分别控制。' } else { '默认参数用于后续生成，本次任务指定的参数优先。' }
    $status.Text = '选中：' + $name + '。' + $note
    $removeButton.Enabled = $true
    $passwordBox.Focus() | Out-Null
}
function Save-Profile {
    $name = $profileName.Text.Trim()
    $alias = $aliasBox.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 120) { throw '请填写不超过120字符的配置名称。' }
    if ([string]::IsNullOrWhiteSpace($alias) -or $alias.Length -gt 120) { throw '请填写不超过120字符的密钥绑定名称。' }
    if ($name -match '[\t\r\n]' -or $alias -match '[\t\r\n]') { throw '配置名称和绑定名称不能包含制表符或换行。' }
    if ($availableCatalog.id -notcontains $modelBox.Text) { throw '请选择 API 模型。' }
    $selectedModel = @($catalog | Where-Object { $_.id -eq $modelBox.Text })[0]
    if ($selectedModel.family -eq 'gpt25' -and $modeBox.SelectedIndex -eq 0) { throw '请确认此密钥的官渠或非官渠规则后保存。' }
    $mode = if ($selectedModel.family -eq 'gpt25' -and $modeBox.SelectedIndex -eq 2) { 'official' } else { 'fixed' }
    $selectedName = if ($profileList.SelectedItem) { $profileList.SelectedItem.Name } else { $null }
    if ($selectedName -and $selectedName -ne $name -and $script:config.profiles.Contains($name)) { throw '该配置名称已存在，请使用其他名称。' }
    $previous = if ($selectedName) { $script:config.profiles[$selectedName] } elseif ($script:config.profiles.Contains($name)) { $script:config.profiles[$name] } else { $null }
    $defaults = if ($previous -and $previous.defaults) { Copy-Map $previous.defaults } else { [ordered]@{} }
    foreach ($field in @('resolution', 'quality', 'complexity', 'thinking_level')) { $defaults.Remove($field) }
    if ($resolutionBox.Enabled -and $resolutionBox.SelectedIndex -gt 0) {
        $defaults.resolution = [string]$resolutionBox.SelectedItem
        if ($selectedModel.family -ne 'seedream') { $defaults.Remove('size') }
    }
    if ($qualityBox.Enabled -and $qualityBox.SelectedIndex -gt 0) {
        if ($selectedModel.family -eq 'gemini-banana21') { $defaults.thinking_level = [string]$qualityBox.SelectedItem }
        else { $defaults.quality = [string]$qualityBox.SelectedItem }
    }
    if ($selectedModel.family -eq 'gpt26' -and $complexityBox.SelectedIndex -gt 0) { $defaults.complexity = [string]$complexityBox.SelectedItem }
    $group = if ($previous) { $previous.api_group } else { '' }
    $p = [ordered]@{ model=$modelBox.Text; key_alias=$alias; api_group=$group; channel_mode=$mode; defaults=$defaults }
    $nextConfig = Copy-Map $script:config
    $nextVault = Copy-Map $script:vault
    $keyText = $passwordBox.Text.Trim()
    try {
        if (-not [string]::IsNullOrWhiteSpace($keyText)) {
            $nextVault.keys[$alias] = Protect-ModelCredential $keyText
        } elseif ($previous -and $previous.key_env -and -not $nextVault.keys.Contains($alias)) {
            $p.key_env = $previous.key_env
        }
        if ($selectedName -and $selectedName -ne $name) {
            $nextConfig.profiles.Remove($selectedName)
            if ($nextConfig.default_profile -eq $selectedName) { $nextConfig.default_profile = $name }
        }
        $nextConfig.profiles[$name] = $p
        if ($defaultCheck.Checked) { $nextConfig.default_profile = $name }
        Ensure-DefaultProfile $nextConfig $nextVault
        Save-Stores $nextConfig $nextVault
        $passwordBox.Clear()
        Update-Aliases
        Refresh-Profiles $name
        $hasKey = $script:vault.keys.Contains($alias) -or $p.key_env
        $status.Text = if ($hasKey) { '已保存 ' + $name + '，密钥已绑定。可继续配置其他模型，完成后关闭。' } else { '已保存配置，但尚未输入密钥；该配置暂不能生成图片。' }
    } finally { $keyText = $null }
}

function Remove-Profile {
    if (-not $profileList.SelectedItem) { return }
    $name = $profileList.SelectedItem.Name
    $nextConfig = Copy-Map $script:config
    $nextConfig.profiles.Remove($name)
    Ensure-DefaultProfile $nextConfig $script:vault
    Save-Stores $nextConfig $script:vault
    $passwordBox.Clear()
    Refresh-Profiles $script:config.default_profile
    if ($profileList.Items.Count -eq 0) { $profileName.Clear(); $aliasBox.Text = ''; $defaultCheck.Checked = $false }
    $status.Text = '已移除配置 ' + $name + '。剩余 ' + $script:config.profiles.Count + ' 项，已保存密钥仍可用于其他配置。'
}

function Import-ModelsTxt([string]$File) {
    $entries = @(ConvertFrom-ModelKeysTxt ([System.IO.File]::ReadAllText($File, [System.Text.Encoding]::UTF8)) $script:config $catalog)
    $nextConfig = Copy-Map $script:config
    $nextVault = Copy-Map $script:vault
    foreach ($entry in $entries) {
        $previous = if ($nextConfig.profiles.Contains($entry.profile)) { $nextConfig.profiles[$entry.profile] } else { $null }
        $group = if ($previous) { $previous.api_group } else { '' }
        $importedProfile = [ordered]@{ model=$entry.model; key_alias=$entry.key_alias; api_group=$group; channel_mode=$entry.channel_mode; defaults=$entry.defaults }
        if (-not [string]::IsNullOrWhiteSpace($entry.key)) { $nextVault.keys[$entry.key_alias] = Protect-ModelCredential $entry.key }
        elseif ($previous -and $previous.key_env -and -not $nextVault.keys.Contains($entry.key_alias)) { $importedProfile.key_env = $previous.key_env }
        $nextConfig.profiles[$entry.profile] = $importedProfile
        if ($entry.is_default) { $nextConfig.default_profile = $entry.profile }
    }
    Ensure-DefaultProfile $nextConfig $nextVault
    Save-Stores $nextConfig $nextVault
    Update-Aliases
    Refresh-Profiles $script:config.default_profile
    $status.Text = '已导入 ' + $entries.Count + ' 项模型配置，密钥已加密保存。'
    $entries = $null
}

function Export-ModelsTxt([string]$File) {
    $text = ConvertTo-ModelKeysTxt $script:config $script:vault
    try { Write-ProtectedText $File $text $true }
    finally { $text = $null }
    $status.Text = '已导出 ' + $script:config.profiles.Count + ' 项模型与密钥：' + $File
}

$modelBox.Add_SelectedIndexChanged({ Update-Model })
$profileList.Add_SelectedIndexChanged({ Load-Profile })
$newButton.Add_Click({
    $profileList.ClearSelected()
    $profileName.Text = ''
    $aliasBox.Text = ''
    $modelBox.SelectedIndex = 0
    Update-Model
    $passwordBox.Clear()
    $defaultCheck.Checked = $false
    $removeButton.Enabled = $false
    $status.Text = '填写新的配置名称和密钥绑定名称；选择相同模型即可新增另一个渠道。'
    $profileName.Focus() | Out-Null
})
$profileName.Add_Leave({ if ([string]::IsNullOrWhiteSpace($aliasBox.Text)) { $aliasBox.Text = $profileName.Text.Trim() } })
$aliasBox.Add_TextChanged({
    $bound = @($script:config.profiles.Values | Where-Object { $_.key_alias -eq $aliasBox.Text }).Count
    $keyLabel.Text = if ($bound -gt 1) { '此密钥绑定 ' + $bound + ' 个配置；输入新值会一起更新' } else { 'API 密钥（留空保留已有密钥）' }
})
$saveButton.Add_Click({
    try { Save-Profile }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '配置尚未保存', 'OK', 'Warning') | Out-Null }
})
$removeButton.Add_Click({
    try { Remove-Profile }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '未能移除配置', 'OK', 'Warning') | Out-Null }
})
$importButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = '导入模型与密钥 TXT'
    $dialog.Filter = '文本文件 (*.txt)|*.txt|所有文件 (*.*)|*.*'
    try {
        if ($passwordBox.Text.Length -gt 0) { throw '请先保存当前输入的密钥，再导入 TXT。' }
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { Import-ModelsTxt $dialog.FileName }
    } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '导入未完成', 'OK', 'Warning') | Out-Null }
    finally { $dialog.Dispose() }
})
$exportButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = '导出模型与密钥 TXT（包含明文密钥）'
    $dialog.Filter = '文本文件 (*.txt)|*.txt'
    $dialog.FileName = 'rolldek-model-keys.txt'
    $dialog.DefaultExt = 'txt'
    $dialog.AddExtension = $true
    try {
        if ($passwordBox.Text.Length -gt 0) { throw '请先保存当前输入的密钥，再导出 TXT。' }
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { Export-ModelsTxt $dialog.FileName }
    } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '导出未完成', 'OK', 'Warning') | Out-Null }
    finally { $dialog.Dispose() }
})
$closeButton.Add_Click({ $form.Close() })
$form.Add_FormClosing({
    if (-not [string]::IsNullOrWhiteSpace($passwordBox.Text)) {
        $answer = [System.Windows.Forms.MessageBox]::Show('当前密钥还未保存。是否返回保存？', '未保存的密钥', 'YesNo', 'Question')
        if ($answer -eq 'Yes') { $_.Cancel = $true }
    }
})
Update-Aliases
$initialProfile = if ([string]::IsNullOrWhiteSpace($SelectProfile)) { $script:config.default_profile } else { $SelectProfile }
Refresh-Profiles $initialProfile
if ($profileList.SelectedIndex -lt 0 -and $profileList.Items.Count -gt 0) { $profileList.SelectedIndex = 0 }

if ($SelfTest) {
    if (-not $passwordBox.UseSystemPasswordChar) { throw 'Password masking is disabled.' }
    $profileList.ClearSelected()
    $profileName.Text = 'isolated-test'
    $aliasBox.Text = 'isolated-test'
    $modelBox.SelectedItem = 'gemini-3-pro-image-preview'
    $resolutionBox.SelectedItem = '2K'
    $passwordBox.Text = 'synthetic-test-credential'
    $defaultCheck.Checked = $true
    Save-Profile
    if ($passwordBox.Text.Length -ne 0) { throw 'Password input was not cleared.' }
    if ((Get-Content -LiteralPath $vaultPath -Raw).Contains('synthetic-test-credential')) { throw 'Plaintext credential persisted.' }
    if ((Read-Map $ConfigPath).profiles['isolated-test'].model -ne 'gemini-3-pro-image-preview') { throw 'Profile mapping failed.' }
    if ($script:config.profiles['isolated-test'].defaults.resolution -ne '2K') { throw 'Resolution default was not saved.' }
    if ($resolutionBox.Text -ne '2K' -or $qualityBox.Enabled) { throw 'Gemini controls were not restored.' }
    $profileList.ClearSelected()
    $profileName.Text = 'defaults-test'
    $aliasBox.Text = 'isolated-test'
    $modelBox.SelectedItem = 'gpt-image-2.5-sunburst'
    $modeBox.SelectedIndex = 2
    $resolutionBox.SelectedItem = '4K'
    $qualityBox.SelectedItem = 'xhigh'
    $defaultCheck.Checked = $false
    Save-Profile
    if ($resolutionBox.Text -ne '4K' -or $qualityBox.Text -ne 'xhigh' -or $modeBox.SelectedIndex -ne 2) { throw 'Sunburst controls were not restored.' }
    $defaults = $script:config.profiles['defaults-test'].defaults
    if ($defaults.resolution -ne '4K' -or $defaults.quality -ne 'xhigh' -or $defaults.Contains('aspect_ratio')) { throw 'Sunburst defaults were not saved independently.' }
    $modelBox.SelectedItem = 'gemini-nano-banana-2.1'
    $resolutionBox.SelectedItem = '2K'
    $qualityBox.SelectedItem = 'high'
    Save-Profile
    $defaults = $script:config.profiles['defaults-test'].defaults
    if ($defaults.resolution -ne '2K' -or $defaults.thinking_level -ne 'high' -or $defaults.Contains('quality')) { throw 'Nano thinking defaults were not saved independently.' }
    $modelBox.SelectedItem = 'seedream-5.0'
    if ($resolutionBox.Items.Contains('4K') -or $qualityBox.Enabled) { throw 'Seedream exposed unsupported parameters.' }
    $modelBox.SelectedItem = 'gpt-image-2.6-sunburst'
    if (-not $resolutionBox.Enabled -or -not $qualityBox.Enabled -or $modeBox.Enabled) { throw 'GPT2.6 parameters are unavailable.' }
    $profileList.ClearSelected()
    $profileName.Text = 'gpt26-defaults'
    $aliasBox.Text = 'isolated-test'
    $resolutionBox.SelectedItem = '2K'
    $qualityBox.SelectedItem = 'xhigh'
    $complexityBox.SelectedItem = 'high'
    Save-Profile
    if ($resolutionBox.Text -ne '2K' -or $qualityBox.Text -ne 'xhigh' -or $complexityBox.Text -ne 'high') { throw 'GPT2.6 defaults were not restored.' }
    Refresh-Profiles 'defaults-test'
    if ($qualityBox.Text -ne 'high' -or $resolutionBox.Text -ne '2K') { throw 'Stored Nano defaults were not restored.' }
    $transferFile = Join-Path $configDirectory 'synthetic-model-keys.txt'
    Export-ModelsTxt $transferFile
    $nextConfig = Copy-Map $script:config
    $nextConfig.profiles.Remove('isolated-test')
    Save-Stores $nextConfig $script:vault
    Import-ModelsTxt $transferFile
    if ((Get-ModelCredential $script:config.profiles['isolated-test'] $script:vault) -cne 'synthetic-test-credential') { throw 'TXT transfer did not restore the synthetic credential.' }
    if ($script:config.default_profile -ne 'isolated-test') { throw 'TXT transfer lost the default profile.' }
    if ($script:config.profiles['isolated-test'].defaults.resolution -ne '2K' -or $script:config.profiles['defaults-test'].defaults.thinking_level -ne 'high') { throw 'TXT transfer lost the generation defaults.' }
    $native = $script:config.profiles['gpt26-defaults'].defaults
    if ($native.resolution -ne '2K' -or $native.quality -ne 'xhigh' -or $native.complexity -ne 'high') { throw 'TXT transfer lost GPT2.6 defaults.' }
    $form.Dispose()
    Write-Output 'GUI self-test passed: masked input, encrypted save, profile binding, input clearing.'
    exit 0
}
$form.Add_Shown({ $form.Activate(); $passwordBox.Focus() | Out-Null })
$form.ShowDialog() | Out-Null
$passwordBox.Clear()
$form.Dispose()
