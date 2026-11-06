param([Parameter(Mandatory=$true)][string]$ConfigPath, [string]$SelectProfile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$guiScript = Join-Path $PSScriptRoot 'Configure-Keys.ps1'
$sessionId = (Get-Process -Id $PID).SessionId
$windowTitle = 'RollDek 模型与密钥管理'
$guiProcess = $null
$reused = $false
foreach ($candidate in @(Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $sessionId -and $_.MainWindowTitle -eq $windowTitle })) {
    $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $candidate.Id)
    if ($processInfo.CommandLine -and $processInfo.CommandLine.Contains($guiScript) -and $processInfo.CommandLine.Contains($ConfigPath)) {
        $guiProcess = $candidate
        $reused = $true
        break
    }
}
if (-not $guiProcess) {
    if ($ConfigPath.Contains('"') -or $guiScript.Contains('"') -or ($SelectProfile -and $SelectProfile.Contains('"'))) { throw '配置路径或名称包含无效引号。' }
    $launchArguments = @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"' + $guiScript + '"'),'-ConfigPath',('"' + $ConfigPath + '"'))
    if ($SelectProfile) { $launchArguments += @('-SelectProfile',('"' + $SelectProfile + '"')) }
    $guiProcess = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $launchArguments -PassThru
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $guiProcess.Refresh()
        if ($guiProcess.HasExited -or $guiProcess.MainWindowHandle -ne 0) { break }
        Start-Sleep -Milliseconds 200
    }
    if ($guiProcess.HasExited -or $guiProcess.MainWindowHandle -eq 0 -or $guiProcess.MainWindowTitle -ne $windowTitle) { throw '配置窗口未能显示，请检查本机窗口启动状态。' }
}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RollDekConfigWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int cx, int cy, uint flags); }'
$handle = $guiProcess.MainWindowHandle
[RollDekConfigWindow]::ShowWindowAsync($handle, 9) | Out-Null
[RollDekConfigWindow]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 67) | Out-Null
[RollDekConfigWindow]::SetForegroundWindow($handle) | Out-Null
[RollDekConfigWindow]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 67) | Out-Null
$visible = [RollDekConfigWindow]::IsWindowVisible($handle)
if (-not $visible) { throw '配置进程已启动，但窗口不可见。' }
[pscustomobject]@{ window_visible = $visible; process_id = $guiProcess.Id; window_title = $windowTitle; reused = $reused } | ConvertTo-Json -Compress
