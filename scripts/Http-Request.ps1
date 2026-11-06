param()
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $inputText = [Console]::In.ReadToEnd()
    $payload = $inputText | ConvertFrom-Json
    $inputText = $null
    $uri = [Uri]$payload.url
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo) { throw 'HTTPS required.' }
    $request = [System.Net.HttpWebRequest]::Create($uri)
    $request.Method = $payload.method
    $request.Timeout = 1800000
    $request.ReadWriteTimeout = 1800000
    $request.AllowAutoRedirect = [bool]$payload.allow_redirect
    $request.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    foreach ($property in $payload.headers.PSObject.Properties) {
        $name = $property.Name
        if ($name -ieq 'Authorization' -or $name -ieq 'x-goog-api-key') {
            if ($uri.Host -notin @('rolldek.com','www.rolldek.com') -or $request.AllowAutoRedirect) { throw 'Credential destination invalid.' }
        }
        if ($name -ieq 'Content-Type') { $request.ContentType = [string]$property.Value }
        else { $request.Headers[$name] = [string]$property.Value }
    }
    if ($null -ne $payload.body_base64) {
        $bytes = [Convert]::FromBase64String($payload.body_base64)
        $request.ContentLength = $bytes.Length
        $stream = $request.GetRequestStream()
        try { $stream.Write($bytes,0,$bytes.Length) }
        finally { $stream.Dispose(); [Array]::Clear($bytes,0,$bytes.Length) }
    }
    try { $response = $request.GetResponse() }
    catch [System.Net.WebException] {
        if ($null -eq $_.Exception.Response) { throw }
        $response = $_.Exception.Response
    }
    try {
        $responseStream = $response.GetResponseStream()
        $memory = New-Object System.IO.MemoryStream
        try { $responseStream.CopyTo($memory); $body = [Convert]::ToBase64String($memory.ToArray()) }
        finally { $responseStream.Dispose(); $memory.Dispose() }
        $headers = @{}
        foreach ($name in $response.Headers.AllKeys) { $headers[$name] = $response.Headers[$name] }
        @{status=[int]$response.StatusCode; headers=$headers; body_base64=$body} | ConvertTo-Json -Depth 5 -Compress
    } finally { $response.Dispose() }
} catch {
    # No URL, headers, body, or key is included in diagnostic output.
    [Console]::Error.WriteLine('Windows HTTP request failed. Check the system proxy and network connection.')
    exit 1
} finally { $payload = $null }
