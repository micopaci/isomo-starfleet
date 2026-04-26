#Requires -Version 5.1
param(
    [string]$DataDir = "C:\ProgramData\Starfleet",
    [string]$ConfigPath = "C:\ProgramData\Starfleet\agent.config.json"
)

$ErrorActionPreference = "Stop"

$QueueDir = Join-Path $DataDir "queue"
$LogFile = Join-Path $DataDir "agent.log"
$DeviceFile = Join-Path $DataDir "device.json"
$InstallSourceFile = Join-Path $DataDir "install_source.json"
$LastHeartbeatFile = Join-Path $DataDir "last_heartbeat.txt"
$UsageBaselineFile = Join-Path $DataDir "usage_baseline.json"
$SchemaVersion = "1.1"
$AgentVersion = "1.2.0"
$RunId = [guid]::NewGuid().ToString()
$SampleWindowSec = 300
$UsageAdapterPolicy = "wifi_default_route"
$script:LastSendError = $null
$script:DisableAgentHealthEndpoint = $false

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -ItemType Directory -Force | Out-Null
    }
}

function Write-Log {
    param(
        [string]$Level = "INFO",
        [string]$Message
    )

    Ensure-Directory $DataDir
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 5MB)) {
        Move-Item -Path $LogFile -Destination "$LogFile.1" -Force
    }

    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return $null
    }
    $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }
    return $raw | ConvertFrom-Json
}

function Get-InstallSourceLabel {
    try {
        $installSource = Read-JsonFile $InstallSourceFile
        if ($null -ne $installSource -and -not [string]::IsNullOrWhiteSpace([string]$installSource.source)) {
            return [string]$installSource.source
        }
    } catch {}

    return "manual_or_legacy"
}

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Value
    )
    $Value | ConvertTo-Json -Depth 12 | Set-Content -Path $Path -Encoding UTF8
}

function New-PayloadMeta {
    param([string]$CollectedAtUtc)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    return @{
        schema_version = $SchemaVersion
        agent_version = $AgentVersion
        run_id = $RunId
        payload_id = ([guid]::NewGuid().ToString())
        collected_at_utc = $CollectedAtUtc
        sent_at_utc = $ts
    }
}

function Add-PayloadMeta {
    param(
        [hashtable]$Payload,
        [string]$CollectedAtUtc
    )
    $meta = New-PayloadMeta -CollectedAtUtc $CollectedAtUtc
    foreach ($k in $meta.Keys) {
        $Payload[$k] = $meta[$k]
    }
    return $Payload
}

function Get-Config {
    $cfg = Read-JsonFile $ConfigPath
    if ($null -eq $cfg) {
        throw "Missing config file: $ConfigPath"
    }
    if ([string]::IsNullOrWhiteSpace($cfg.ApiBase)) {
        throw "Config ApiBase is required"
    }
    if ([string]::IsNullOrWhiteSpace($cfg.ApiToken)) {
        throw "Config ApiToken is required"
    }

    $apiBase = [string]$cfg.ApiBase
    $apiBase = $apiBase.TrimEnd("/")

    $siteId = 0
    if ($null -ne $cfg.SiteId) {
        $siteId = [int]$cfg.SiteId
    }

    $pingHost = "1.1.1.1"
    if (-not [string]::IsNullOrWhiteSpace($cfg.PingHost)) {
        $pingHost = [string]$cfg.PingHost
    }

    $grpcurlPath = Join-Path $DataDir "grpcurl.exe"
    if (-not [string]::IsNullOrWhiteSpace($cfg.GrpcurlPath)) {
        $grpcurlPath = [string]$cfg.GrpcurlPath
    }

    $maxSiteRadiusKm = 2.0
    if ($null -ne $cfg.MaxSiteRadiusKm) {
        $maxSiteRadiusKm = [double]$cfg.MaxSiteRadiusKm
    }

    $queueFlushLimit = 20
    if ($null -ne $cfg.QueueFlushLimit) {
        $queueFlushLimit = [int]$cfg.QueueFlushLimit
    }

    return [pscustomobject]@{
        ApiBase = $apiBase
        ApiToken = [string]$cfg.ApiToken
        SiteId = $siteId
        PingHost = $pingHost
        GrpcurlPath = $grpcurlPath
        MaxSiteRadiusKm = $maxSiteRadiusKm
        QueueFlushLimit = $queueFlushLimit
    }
}

function Save-AgentConfig {
    param([object]$Config)

    $value = @{
        ApiBase = $Config.ApiBase
        ApiToken = $Config.ApiToken
        SiteId = [int]$Config.SiteId
        PingHost = $Config.PingHost
        GrpcurlPath = $Config.GrpcurlPath
        MaxSiteRadiusKm = $Config.MaxSiteRadiusKm
        QueueFlushLimit = $Config.QueueFlushLimit
    }
    Write-JsonFile -Path $ConfigPath -Value $value
}

function Update-InstallSourceSite {
    param([int]$SiteId)

    try {
        $installSource = Read-JsonFile $InstallSourceFile
        if ($null -eq $installSource) {
            return
        }
        $installSource | Add-Member -NotePropertyName resolved_site_id -NotePropertyValue $SiteId -Force
        $installSource | Add-Member -NotePropertyName resolved_at_utc -NotePropertyValue ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")) -Force
        Write-JsonFile -Path $InstallSourceFile -Value $installSource
    } catch {
        Write-Log "WARN" "Unable to update install_source.json with resolved site: $($_.Exception.Message)"
    }
}

function Get-AuthHeaders {
    param([object]$Config)
    return @{
        Authorization = "Bearer $($Config.ApiToken)"
        "Content-Type" = "application/json"
        Accept = "application/json"
    }
}

function Get-HttpErrorDetails {
    param([object]$ErrorRecord)

    $statusCode = $null
    $responseText = $null

    try {
        if ($ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.StatusCode) {
            $statusCode = [int]$ErrorRecord.Exception.Response.StatusCode
        }
    } catch {}

    try {
        if ($ErrorRecord.Exception.Response) {
            $stream = $ErrorRecord.Exception.Response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                try {
                    $responseText = $reader.ReadToEnd()
                } finally {
                    $reader.Close()
                }
            }
        }
    } catch {}

    $message = [string]$ErrorRecord.Exception.Message
    if (-not [string]::IsNullOrWhiteSpace($responseText)) {
        $bodyMessage = $responseText
        try {
            $body = $responseText | ConvertFrom-Json -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace([string]$body.detail)) {
                $bodyMessage = [string]$body.detail
            } elseif (-not [string]::IsNullOrWhiteSpace([string]$body.error)) {
                $bodyMessage = [string]$body.error
            }
        } catch {}
        $message = "$message; server said: $bodyMessage"
    }

    if ($statusCode -eq 401) {
        $message = "$message; check that Intune installed a current site-scoped agent token signed by this backend"
    }

    return [pscustomobject]@{
        StatusCode = $statusCode
        Message = $message
    }
}

function Get-NestedValue {
    param(
        [object]$Object,
        [string[]]$Path
    )

    $current = $Object
    foreach ($part in $Path) {
        if ($null -eq $current) {
            return $null
        }
        $prop = $current.PSObject.Properties[$part]
        if ($null -eq $prop) {
            return $null
        }
        $current = $prop.Value
    }
    return $current
}

function Find-FirstNumber {
    param(
        [object]$Object,
        [string[]]$Names
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IEnumerable] -and -not ($Object -is [string])) {
        foreach ($item in $Object) {
            $found = Find-FirstNumber -Object $item -Names $Names
            if ($null -ne $found) {
                return $found
            }
        }
        return $null
    }

    foreach ($prop in $Object.PSObject.Properties) {
        foreach ($name in $Names) {
            if ($prop.Name -ieq $name) {
                $number = 0.0
                if ([double]::TryParse([string]$prop.Value, [ref]$number)) {
                    return $number
                }
            }
        }
    }

    foreach ($prop in $Object.PSObject.Properties) {
        if ($null -ne $prop.Value -and -not ($prop.Value -is [string])) {
            $found = Find-FirstNumber -Object $prop.Value -Names $Names
            if ($null -ne $found) {
                return $found
            }
        }
    }

    return $null
}

function Find-FirstString {
    param(
        [object]$Object,
        [string[]]$Names
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IEnumerable] -and -not ($Object -is [string])) {
        foreach ($item in $Object) {
            $found = Find-FirstString -Object $item -Names $Names
            if (-not [string]::IsNullOrWhiteSpace($found)) {
                return $found
            }
        }
        return $null
    }

    foreach ($prop in $Object.PSObject.Properties) {
        foreach ($name in $Names) {
            if ($prop.Name -ieq $name -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
                return ([string]$prop.Value).Trim()
            }
        }
    }

    foreach ($prop in $Object.PSObject.Properties) {
        if ($null -ne $prop.Value -and -not ($prop.Value -is [string])) {
            $found = Find-FirstString -Object $prop.Value -Names $Names
            if (-not [string]::IsNullOrWhiteSpace($found)) {
                return $found
            }
        }
    }

    return $null
}

function Find-StarlinkUtIdInBytes {
    param([byte[]]$Bytes)

    if ($null -eq $Bytes -or $Bytes.Length -eq 0) {
        return $null
    }

    try {
        $text = [System.Text.Encoding]::ASCII.GetString($Bytes)
        $match = [regex]::Match($text, '(?i)ut[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}')
        if ($match.Success) {
            return $match.Value.ToLowerInvariant()
        }
    } catch {}

    return $null
}

function Normalize-StarlinkId {
    param([object]$Value)

    $id = ([string]$Value).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($id)) {
        return $null
    }

    if ($id -match '^ut([0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8})$') {
        return $Matches[1]
    }

    if ($id -match '^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$') {
        return $id
    }

    return $null
}

function Convert-FractionToPct {
    param([object]$Value)
    if ($null -eq $Value) {
        return $null
    }
    $n = [double]$Value
    if ($n -le 1) {
        return [math]::Round($n * 100, 2)
    }
    return [math]::Round($n, 2)
}

function Convert-BpsToMbps {
    param([object]$Value)
    if ($null -eq $Value) {
        return $null
    }
    return [math]::Round(([double]$Value / 1000000), 2)
}

function Get-JsonObjectCandidatesFromText {
    param([string]$Text)

    $candidates = @()
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $candidates
    }

    $depth = 0
    $start = -1
    $inString = $false
    $escaped = $false

    for ($i = 0; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]

        if ($inString) {
            if ($escaped) {
                $escaped = $false
                continue
            }
            if ($ch -eq '\') {
                $escaped = $true
                continue
            }
            if ($ch -eq '"') {
                $inString = $false
                continue
            }
            continue
        }

        if ($ch -eq '"') {
            $inString = $true
            continue
        }

        if ($ch -eq '{') {
            if ($depth -eq 0) {
                $start = $i
            }
            $depth++
            continue
        }

        if ($ch -eq '}') {
            if ($depth -le 0) {
                continue
            }
            $depth--
            if ($depth -eq 0 -and $start -ge 0) {
                $slice = $Text.Substring($start, $i - $start + 1)
                try {
                    $obj = $slice | ConvertFrom-Json -ErrorAction Stop
                    $candidates += ,$obj
                } catch {}
                $start = -1
            }
        }
    }

    return $candidates
}

function Get-StarlinkCandidateScore {
    param([object]$Object)

    if ($null -eq $Object) {
        return -1
    }

    $score = 0
    foreach ($key in @("location", "alerts", "dishGetStatus", "dishGetHistory", "getStatus", "getLocation", "deviceInfo")) {
        if ($null -ne $Object.PSObject.Properties[$key]) {
            $score += 2
        }
    }

    if ($null -ne (Find-FirstNumber -Object $Object -Names @("latitude", "lat"))) {
        $score += 4
    }
    if ($null -ne (Find-FirstNumber -Object $Object -Names @("longitude", "lon", "lng"))) {
        $score += 4
    }
    if ($null -ne (Find-FirstNumber -Object $Object -Names @("downlinkThroughputBps", "uplinkThroughputBps", "popPingLatencyMs"))) {
        $score += 3
    }
    if ($null -ne (Find-FirstNumber -Object $Object -Names @("fractionObstructed", "obstructionPct", "popPingDropRate"))) {
        $score += 2
    }

    return $score
}

function Select-StarlinkJsonCandidate {
    param([object[]]$Candidates)

    $best = $null
    $bestScore = -1
    foreach ($candidate in @($Candidates)) {
        $score = Get-StarlinkCandidateScore -Object $candidate
        if ($score -gt $bestScore) {
            $best = $candidate
            $bestScore = $score
        }
    }

    if ($bestScore -ge 4) {
        return $best
    }
    return $null
}

function Try-ParseJsonFromText {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }

    # 1) Direct JSON
    try {
        return ($Text | ConvertFrom-Json -ErrorAction Stop)
    } catch {}

    # 2) Scan for valid JSON object slices within mixed payloads (HTML/JS/text)
    $candidates = Get-JsonObjectCandidatesFromText -Text $Text
    if ($candidates.Count -gt 0) {
        $best = Select-StarlinkJsonCandidate -Candidates $candidates
        if ($null -ne $best) {
            return $best
        }
        if ($candidates.Count -eq 1) {
            return $candidates[0]
        }
    }

    # 3) Legacy largest object attempt (kept as a final fallback)
    $start = $Text.IndexOf('{')
    $end = $Text.LastIndexOf('}')
    if ($start -ge 0 -and $end -gt $start) {
        $jsonSlice = $Text.Substring($start, $end - $start + 1)
        try {
            return ($jsonSlice | ConvertFrom-Json -ErrorAction Stop)
        } catch {}
    }
    return $null
}

function Get-ByteSlice {
    param(
        [byte[]]$Bytes,
        [int]$Offset,
        [int]$Length
    )

    if ($Length -le 0) {
        return (New-Object byte[] 0)
    }
    if ($Offset -lt 0 -or ($Offset + $Length) -gt $Bytes.Length) {
        throw "Invalid byte slice offset/length."
    }

    $slice = New-Object byte[] $Length
    [Array]::Copy($Bytes, $Offset, $slice, 0, $Length)
    return $slice
}

function Read-ProtoVarint {
    param(
        [byte[]]$Bytes,
        [ref]$Index
    )

    $value = [UInt64]0
    $shift = 0
    while ($Index.Value -lt $Bytes.Length) {
        $b = [UInt64]$Bytes[$Index.Value]
        $Index.Value++
        $value = $value -bor (($b -band 0x7F) -shl $shift)
        if (($b -band 0x80) -eq 0) {
            return $value
        }
        $shift += 7
        if ($shift -gt 63) {
            throw "Invalid protobuf varint."
        }
    }
    throw "Unexpected end of protobuf varint."
}

function Skip-ProtoField {
    param(
        [byte[]]$Bytes,
        [int]$WireType,
        [ref]$Index
    )

    switch ($WireType) {
        0 {
            [void](Read-ProtoVarint -Bytes $Bytes -Index $Index)
            return $true
        }
        1 {
            if (($Index.Value + 8) -gt $Bytes.Length) {
                return $false
            }
            $Index.Value += 8
            return $true
        }
        2 {
            $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $Index)
            if ($len -lt 0 -or ($Index.Value + $len) -gt $Bytes.Length) {
                return $false
            }
            $Index.Value += $len
            return $true
        }
        5 {
            if (($Index.Value + 4) -gt $Bytes.Length) {
                return $false
            }
            $Index.Value += 4
            return $true
        }
        default {
            return $false
        }
    }
}

function Parse-StarlinkLocationProto {
    param([byte[]]$Bytes)

    $idx = 0
    $cursor = [ref]$idx

    $enabled = $null
    $latitude = $null
    $longitude = $null
    $altitudeMeters = $null
    $uncertaintyMetersValid = $null
    $uncertaintyMeters = $null
    $gpsTimeS = $null

    while ($cursor.Value -lt $Bytes.Length) {
        $key = [UInt64](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
        $field = [int]($key -shr 3)
        $wire = [int]($key -band 0x07)

        switch ($field) {
            1 {
                if ($wire -eq 0) {
                    $enabled = ((Read-ProtoVarint -Bytes $Bytes -Index $cursor) -ne 0)
                    continue
                }
            }
            2 {
                if ($wire -eq 1) {
                    if (($cursor.Value + 8) -gt $Bytes.Length) { break }
                    $latitude = [BitConverter]::ToDouble($Bytes, $cursor.Value)
                    $cursor.Value += 8
                    continue
                }
            }
            3 {
                if ($wire -eq 1) {
                    if (($cursor.Value + 8) -gt $Bytes.Length) { break }
                    $longitude = [BitConverter]::ToDouble($Bytes, $cursor.Value)
                    $cursor.Value += 8
                    continue
                }
            }
            4 {
                if ($wire -eq 1) {
                    if (($cursor.Value + 8) -gt $Bytes.Length) { break }
                    $altitudeMeters = [BitConverter]::ToDouble($Bytes, $cursor.Value)
                    $cursor.Value += 8
                    continue
                }
            }
            5 {
                if ($wire -eq 0) {
                    $uncertaintyMetersValid = ((Read-ProtoVarint -Bytes $Bytes -Index $cursor) -ne 0)
                    continue
                }
            }
            6 {
                if ($wire -eq 1) {
                    if (($cursor.Value + 8) -gt $Bytes.Length) { break }
                    $uncertaintyMeters = [BitConverter]::ToDouble($Bytes, $cursor.Value)
                    $cursor.Value += 8
                    continue
                }
            }
            7 {
                if ($wire -eq 1) {
                    if (($cursor.Value + 8) -gt $Bytes.Length) { break }
                    $gpsTimeS = [BitConverter]::ToDouble($Bytes, $cursor.Value)
                    $cursor.Value += 8
                    continue
                }
            }
        }

        if (-not (Skip-ProtoField -Bytes $Bytes -WireType $wire -Index $cursor)) {
            break
        }
    }

    return [pscustomobject]@{
        enabled = $enabled
        latitude = $latitude
        longitude = $longitude
        altitudeMeters = $altitudeMeters
        uncertaintyMetersValid = $uncertaintyMetersValid
        uncertaintyMeters = $uncertaintyMeters
        gpsTimeS = $gpsTimeS
    }
}

function Parse-StarlinkAlertsProto {
    param([byte[]]$Bytes)

    $idx = 0
    $cursor = [ref]$idx
    $alerts = @{
        dishIsHeating = $false
        dishThermalThrottle = $false
        dishThermalShutdown = $false
        powerSupplyThermalThrottle = $false
        motorsStuck = $false
        mastNotNearVertical = $false
        slowEthernetSpeeds = $false
        softwareInstallPending = $false
        movingTooFastForPolicy = $false
        obstructed = $false
    }

    while ($cursor.Value -lt $Bytes.Length) {
        $key = [UInt64](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
        $field = [int]($key -shr 3)
        $wire = [int]($key -band 0x07)
        if ($wire -eq 0 -and $field -ge 1 -and $field -le 10) {
            $value = ((Read-ProtoVarint -Bytes $Bytes -Index $cursor) -ne 0)
            switch ($field) {
                1 { $alerts["dishIsHeating"] = $value; continue }
                2 { $alerts["dishThermalThrottle"] = $value; continue }
                3 { $alerts["dishThermalShutdown"] = $value; continue }
                4 { $alerts["powerSupplyThermalThrottle"] = $value; continue }
                5 { $alerts["motorsStuck"] = $value; continue }
                6 { $alerts["mastNotNearVertical"] = $value; continue }
                7 { $alerts["slowEthernetSpeeds"] = $value; continue }
                8 { $alerts["softwareInstallPending"] = $value; continue }
                9 { $alerts["movingTooFastForPolicy"] = $value; continue }
                10 { $alerts["obstructed"] = $value; continue }
            }
        }

        if (-not (Skip-ProtoField -Bytes $Bytes -WireType $wire -Index $cursor)) {
            break
        }
    }

    return [pscustomobject]$alerts
}

function Parse-StarlinkAlignmentStatsProto {
    param([byte[]]$Bytes)

    $idx = 0
    $cursor = [ref]$idx

    $boresightAzimuthDeg = $null
    $boresightElevationDeg = $null
    $desiredBoresightAzimuthDeg = $null
    $desiredBoresightElevationDeg = $null

    while ($cursor.Value -lt $Bytes.Length) {
        $key = [UInt64](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
        $field = [int]($key -shr 3)
        $wire = [int]($key -band 0x07)

        if ($wire -eq 5 -and $field -ge 1 -and $field -le 4) {
            if (($cursor.Value + 4) -gt $Bytes.Length) {
                break
            }
            $value = [BitConverter]::ToSingle($Bytes, $cursor.Value)
            $cursor.Value += 4
            switch ($field) {
                1 { $boresightAzimuthDeg = $value; continue }
                2 { $boresightElevationDeg = $value; continue }
                3 { $desiredBoresightAzimuthDeg = $value; continue }
                4 { $desiredBoresightElevationDeg = $value; continue }
            }
        }

        if (-not (Skip-ProtoField -Bytes $Bytes -WireType $wire -Index $cursor)) {
            break
        }
    }

    return [pscustomobject]@{
        boresightAzimuthDeg = $boresightAzimuthDeg
        boresightElevationDeg = $boresightElevationDeg
        desiredBoresightAzimuthDeg = $desiredBoresightAzimuthDeg
        desiredBoresightElevationDeg = $desiredBoresightElevationDeg
    }
}

function Parse-StarlinkDishDiagnosticsProto {
    param([byte[]]$Bytes)

    $idx = 0
    $cursor = [ref]$idx

    $id = $null
    $hardwareVersion = $null
    $softwareVersion = $null
    $utcOffsetS = $null
    $hardwareSelfTest = $null
    $hardwareSelfTestCodesList = @()
    $alerts = $null
    $disablementCode = $null
    $location = $null
    $alignmentStats = $null
    $stowed = $null

    while ($cursor.Value -lt $Bytes.Length) {
        $key = [UInt64](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
        $field = [int]($key -shr 3)
        $wire = [int]($key -band 0x07)

        switch ($field) {
            1 {
                if ($wire -eq 2) {
                    $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) { return $null }
                    $id = [System.Text.Encoding]::UTF8.GetString($Bytes, $cursor.Value, $len)
                    $cursor.Value += $len
                    continue
                }
            }
            2 {
                if ($wire -eq 2) {
                    $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) { return $null }
                    $hardwareVersion = [System.Text.Encoding]::UTF8.GetString($Bytes, $cursor.Value, $len)
                    $cursor.Value += $len
                    continue
                }
            }
            3 {
                if ($wire -eq 2) {
                    $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) { return $null }
                    $softwareVersion = [System.Text.Encoding]::UTF8.GetString($Bytes, $cursor.Value, $len)
                    $cursor.Value += $len
                    continue
                }
            }
            4 {
                if ($wire -eq 0) {
                    $utcOffsetS = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    continue
                }
            }
            5 {
                if ($wire -eq 2) {
                    $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) { return $null }
                    $slice = Get-ByteSlice -Bytes $Bytes -Offset $cursor.Value -Length $len
                    $cursor.Value += $len
                    $alerts = Parse-StarlinkAlertsProto -Bytes $slice
                    continue
                }
            }
            6 {
                if ($wire -eq 0) {
                    $disablementCode = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    continue
                }
            }
            7 {
                if ($wire -eq 0) {
                    $hardwareSelfTest = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    continue
                }
            }
            8 {
                if ($wire -eq 2) {
                    $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) { return $null }
                    $slice = Get-ByteSlice -Bytes $Bytes -Offset $cursor.Value -Length $len
                    $cursor.Value += $len
                    $location = Parse-StarlinkLocationProto -Bytes $slice
                    continue
                }
            }
            9 {
                if ($wire -eq 2) {
                    $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) { return $null }
                    $slice = Get-ByteSlice -Bytes $Bytes -Offset $cursor.Value -Length $len
                    $cursor.Value += $len
                    $alignmentStats = Parse-StarlinkAlignmentStatsProto -Bytes $slice
                    continue
                }
            }
            10 {
                if ($wire -eq 0) {
                    $stowed = ((Read-ProtoVarint -Bytes $Bytes -Index $cursor) -ne 0)
                    continue
                }
            }
            11 {
                if ($wire -eq 0) {
                    $hardwareSelfTestCodesList += [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    continue
                }
                if ($wire -eq 2) {
                    $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) { return $null }
                    $end = $cursor.Value + $len
                    while ($cursor.Value -lt $end) {
                        $hardwareSelfTestCodesList += [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
                    }
                    continue
                }
            }
        }

        if (-not (Skip-ProtoField -Bytes $Bytes -WireType $wire -Index $cursor)) {
            break
        }
    }

    return [pscustomobject]@{
        id = $id
        hardwareVersion = $hardwareVersion
        softwareVersion = $softwareVersion
        utcOffsetS = $utcOffsetS
        hardwareSelfTest = $hardwareSelfTest
        hardwareSelfTestCodesList = $hardwareSelfTestCodesList
        alerts = $alerts
        disablementCode = $disablementCode
        location = $location
        alignmentStats = $alignmentStats
        stowed = $stowed
    }
}

function Parse-StarlinkDeviceResponseProto {
    param([byte[]]$Bytes)

    $idx = 0
    $cursor = [ref]$idx
    $dish = $null

    while ($cursor.Value -lt $Bytes.Length) {
        $key = [UInt64](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
        $field = [int]($key -shr 3)
        $wire = [int]($key -band 0x07)

        if ($field -eq 6001 -and $wire -eq 2) {
            $len = [int](Read-ProtoVarint -Bytes $Bytes -Index $cursor)
            if ($len -lt 0 -or ($cursor.Value + $len) -gt $Bytes.Length) {
                return $null
            }
            $slice = Get-ByteSlice -Bytes $Bytes -Offset $cursor.Value -Length $len
            $cursor.Value += $len
            $dish = Parse-StarlinkDishDiagnosticsProto -Bytes $slice
            continue
        }

        if (-not (Skip-ProtoField -Bytes $Bytes -WireType $wire -Index $cursor)) {
            break
        }
    }

    if ($null -eq $dish) {
        return $null
    }

    return [pscustomobject]@{
        dishGetDiagnostics = $dish
    }
}

function Get-GrpcWebDataFrames {
    param([byte[]]$Bytes)

    $frames = @()
    if ($null -eq $Bytes -or $Bytes.Length -lt 5) {
        return $frames
    }

    $idx = 0
    while (($idx + 5) -le $Bytes.Length) {
        $flags = [byte]$Bytes[$idx]
        $idx++

        $lenU = ([uint32]$Bytes[$idx] -shl 24) -bor ([uint32]$Bytes[$idx + 1] -shl 16) -bor ([uint32]$Bytes[$idx + 2] -shl 8) -bor ([uint32]$Bytes[$idx + 3])
        $len = [int]$lenU
        $idx += 4

        if ($len -lt 0 -or ($idx + $len) -gt $Bytes.Length) {
            break
        }

        if (($flags -band 0x80) -eq 0) {
            $payload = Get-ByteSlice -Bytes $Bytes -Offset $idx -Length $len
            $frames += ,$payload
        }
        $idx += $len
    }

    return $frames
}

function New-StarlinkGetDiagnosticsGrpcWebRequestFrame {
    # Known-good frame for ToDevice{ request{ get_diagnostics{} } }.
    return [byte[]](0x00, 0x00, 0x00, 0x00, 0x04, 0x82, 0xF7, 0x02, 0x00)
}

function Parse-StarlinkDishDiagnosticsByKnownOffsets {
    param([byte[]]$Bytes)

    if ($null -eq $Bytes -or $Bytes.Length -lt 113) {
        return $null
    }

    try {
        # Empirical fallback offsets observed from Starlink grpc-web binary payload.
        $lat = [double][System.BitConverter]::ToDouble($Bytes, 96)
        $lon = [double][System.BitConverter]::ToDouble($Bytes, 105)

        if ($lat -lt -90 -or $lat -gt 90 -or $lon -lt -180 -or $lon -gt 180) {
            return $null
        }

        $az = $null
        $el = $null
        if ($Bytes.Length -ge 153) {
            $az = [double][System.BitConverter]::ToSingle($Bytes, 144)
            $el = [double][System.BitConverter]::ToSingle($Bytes, 149)
        }

        return [pscustomobject]@{
            id = $null
            hardwareVersion = $null
            softwareVersion = $null
            utcOffsetS = $null
            hardwareSelfTest = $null
            hardwareSelfTestCodesList = @()
            alerts = $null
            disablementCode = $null
            location = [pscustomobject]@{
                enabled = $true
                latitude = $lat
                longitude = $lon
                altitudeMeters = $null
                uncertaintyMetersValid = $null
                uncertaintyMeters = $null
                gpsTimeS = $null
            }
            alignmentStats = [pscustomobject]@{
                boresightAzimuthDeg = $az
                boresightElevationDeg = $el
                desiredBoresightAzimuthDeg = $null
                desiredBoresightElevationDeg = $null
            }
            stowed = $null
        }
    } catch {
        return $null
    }
}

function Convert-StarlinkWebResponseToBytes {
    param([object]$Response)

    if ($null -eq $Response) {
        return $null
    }

    $rawBytes = $Response.Content
    if ($rawBytes -is [byte[]]) {
        return $rawBytes
    }

    if ($rawBytes -is [string]) {
        return [System.Text.Encoding]::GetEncoding(28591).GetBytes($rawBytes)
    }

    try {
        return [byte[]]$rawBytes
    } catch {
        return $null
    }
}

function Invoke-StarlinkGrpcWebHandleWithInvokeWebRequest {
    param(
        [byte[]]$RequestFrame,
        [string]$ProbeName = "get_diagnostics"
    )

    $urls = @(
        "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle",
        "http://dishy.starlink.com:9201/SpaceX.API.Device.Device/Handle"
    )

    $lastError = $null

    foreach ($url in $urls) {
        try {
            $response = Invoke-WebRequest -Uri $url `
                -Method Post `
                -Body $RequestFrame `
                -ContentType "application/grpc-web+proto" `
                -Headers @{
                    "X-Grpc-Web" = "1"
                    "Accept" = "application/grpc-web+proto"
                } `
                -UseBasicParsing `
                -TimeoutSec 8

            $bytes = Convert-StarlinkWebResponseToBytes -Response $response
            if ($null -ne $bytes -and $bytes.Length -ge 5) {
                Write-Log "INFO" "gRPC-web $ProbeName received $($bytes.Length) byte(s) from $url."
                return $bytes
            }
        } catch {
            $lastError = $_.Exception.Message
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($lastError)) {
        Write-Log "WARN" "gRPC-web Invoke-WebRequest $ProbeName failed: $lastError"
    }
    return $null
}

function Invoke-StarlinkGrpcWebHandle {
    param(
        [byte[]]$RequestFrame,
        [string]$ProbeName = "get_diagnostics"
    )

    $urls = @(
        "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle",
        "http://dishy.starlink.com:9201/SpaceX.API.Device.Device/Handle",
        "http://192.168.100.1:9200/SpaceX.API.Device.Device/Handle"
    )

    $lastError = $null

    foreach ($url in $urls) {
        try {
            $request = [System.Net.HttpWebRequest]::Create($url)
            $request.Method = "POST"
            $request.Timeout = 8000
            $request.ReadWriteTimeout = 8000
            $request.ContentType = "application/grpc-web+proto"
            $request.Accept = "application/grpc-web+proto"
            $request.UserAgent = "grpc-web-javascript/0.1"
            $request.Headers.Add("X-Grpc-Web", "1")
            $request.ContentLength = $RequestFrame.Length

            $reqStream = $request.GetRequestStream()
            try {
                $reqStream.Write($RequestFrame, 0, $RequestFrame.Length)
            } finally {
                $reqStream.Close()
            }

            $response = $request.GetResponse()
            try {
                $respStream = $response.GetResponseStream()
                $ms = New-Object System.IO.MemoryStream
                try {
                    $buf = New-Object byte[] 4096
                    while (($read = $respStream.Read($buf, 0, $buf.Length)) -gt 0) {
                        $ms.Write($buf, 0, $read)
                    }
                } finally {
                    if ($null -ne $respStream) {
                        $respStream.Close()
                    }
                }

                $bytes = $ms.ToArray()
                if ($bytes.Length -ge 5) {
                    return $bytes
                }
            } finally {
                $response.Close()
            }
        } catch {
            $lastError = $_.Exception.Message
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($lastError)) {
        Write-Log "WARN" "gRPC-web fallback $ProbeName failed: $lastError"
    }
    return $null
}

function Invoke-StarlinkHttpHandle {
    param(
        [string[]]$RequestBodies,
        [string]$ProbeName = "probe"
    )

    $urls = @(
        "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle",
        "http://dishy.starlink.com:9201/SpaceX.API.Device.Device/Handle",
        "http://192.168.100.1:9200/SpaceX.API.Device.Device/Handle"
    )

    $lastError = $null

    foreach ($url in $urls) {
        foreach ($body in @($RequestBodies)) {
            if ([string]::IsNullOrWhiteSpace($body)) {
                continue
            }

            try {
                $res = Invoke-WebRequest -Uri $url -Method POST -UseBasicParsing -TimeoutSec 8 `
                    -ContentType "application/json" -Body $body
                $obj = Try-ParseJsonFromText -Text ($res.Content | Out-String)
                if ($null -ne $obj) {
                    return $obj
                }
            } catch {
                $lastError = $_.Exception.Message
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($lastError)) {
        Write-Log "WARN" "HTTP fallback $ProbeName probes failed on 9201/9200: $lastError"
    }

    return $null
}

function Get-CurlCommand {
    $cmd = Get-Command "curl.exe" -ErrorAction SilentlyContinue
    if ($null -ne $cmd) {
        return $cmd.Source
    }
    return $null
}

function Invoke-StarlinkHttpHandleWithCurl {
    param(
        [string[]]$RequestBodies,
        [string]$ProbeName = "probe"
    )

    $curl = Get-CurlCommand
    if ([string]::IsNullOrWhiteSpace($curl)) {
        return $null
    }

    $urls = @(
        "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle",
        "http://dishy.starlink.com:9201/SpaceX.API.Device.Device/Handle",
        "http://192.168.100.1:9200/SpaceX.API.Device.Device/Handle"
    )
    $modes = @("--http2-prior-knowledge", "--http1.1", "--http0.9")
    $lastError = $null

    foreach ($url in $urls) {
        foreach ($body in @($RequestBodies)) {
            if ([string]::IsNullOrWhiteSpace($body)) {
                continue
            }

            foreach ($mode in $modes) {
                try {
                    $raw = & $curl "--silent" "--show-error" "--max-time" "8" $mode `
                        "-H" "Content-Type: application/json" `
                        "-H" "Accept: application/json" `
                        "--data" $body `
                        $url 2>$null
                    if (-not [string]::IsNullOrWhiteSpace($raw)) {
                        $obj = Try-ParseJsonFromText -Text ($raw | Out-String)
                        if ($null -ne $obj) {
                            return $obj
                        }
                    }
                } catch {
                    $lastError = $_.Exception.Message
                }
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($lastError)) {
        Write-Log "WARN" "HTTP fallback $ProbeName curl probes failed: $lastError"
    }
    return $null
}

function Get-StarlinkHttpStatus {
    $requestFrame = New-StarlinkGetDiagnosticsGrpcWebRequestFrame
    $grpcWebRaw = Invoke-StarlinkGrpcWebHandleWithInvokeWebRequest -RequestFrame $requestFrame -ProbeName "get_diagnostics"
    if ($null -eq $grpcWebRaw) {
        $grpcWebRaw = Invoke-StarlinkGrpcWebHandle -RequestFrame $requestFrame -ProbeName "get_diagnostics"
    }
    if ($null -ne $grpcWebRaw) {
        $rawStarlinkId = Find-StarlinkUtIdInBytes -Bytes $grpcWebRaw
        $offsetParsed = Parse-StarlinkDishDiagnosticsByKnownOffsets -Bytes $grpcWebRaw
        if ($null -ne $offsetParsed) {
            if (-not [string]::IsNullOrWhiteSpace($rawStarlinkId)) {
                $offsetParsed.id = $rawStarlinkId
            }
            $framesForIdentity = Get-GrpcWebDataFrames -Bytes $grpcWebRaw
            foreach ($frame in @($framesForIdentity)) {
                try {
                    $parsedForIdentity = Parse-StarlinkDeviceResponseProto -Bytes $frame
                    if ($null -ne $parsedForIdentity -and
                        $null -ne $parsedForIdentity.dishGetDiagnostics -and
                        -not [string]::IsNullOrWhiteSpace([string]$parsedForIdentity.dishGetDiagnostics.id)) {
                        $offsetParsed.id = [string]$parsedForIdentity.dishGetDiagnostics.id
                        break
                    }
                } catch {}
            }
            $idNote = ""
            if (-not [string]::IsNullOrWhiteSpace([string]$offsetParsed.id)) {
                $idNote = ", starlink_id=$($offsetParsed.id)"
            }
            Write-Log "INFO" "gRPC-web fallback decoded GPS lat=$([math]::Round([double]$offsetParsed.location.latitude, 5)), lon=$([math]::Round([double]$offsetParsed.location.longitude, 5))$idNote from known byte offsets."
            return $offsetParsed
        }

        $frames = Get-GrpcWebDataFrames -Bytes $grpcWebRaw
        foreach ($frame in @($frames)) {
            try {
                $parsed = Parse-StarlinkDeviceResponseProto -Bytes $frame
                if ($null -ne $parsed -and $null -ne $parsed.dishGetDiagnostics) {
                    if ([string]::IsNullOrWhiteSpace([string]$parsed.dishGetDiagnostics.id) -and
                        -not [string]::IsNullOrWhiteSpace($rawStarlinkId)) {
                        $parsed.dishGetDiagnostics.id = $rawStarlinkId
                    }
                    Write-Log "INFO" "gRPC-web fallback decoded diagnostics from protobuf frame."
                    return $parsed.dishGetDiagnostics
                }
            } catch {
                Write-Log "WARN" "gRPC-web protobuf frame decode failed: $($_.Exception.Message)"
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($rawStarlinkId)) {
            Write-Log "INFO" "gRPC-web fallback decoded Starlink ID $rawStarlinkId without GPS."
            return [pscustomobject]@{
                id = $rawStarlinkId
                hardwareVersion = $null
                softwareVersion = $null
                utcOffsetS = $null
                hardwareSelfTest = $null
                hardwareSelfTestCodesList = @()
                alerts = $null
                disablementCode = $null
                location = $null
                alignmentStats = $null
                stowed = $null
            }
        }
        Write-Log "WARN" "gRPC-web fallback returned no dish diagnostics payload."
    }

    $statusBodies = @(
        '{"get_status":{}}',
        '{"getStatus":{}}',
        '{"dishGetStatus":{}}',
        '{"request":{"get_status":{}}}'
    )
    $locationBodies = @(
        '{"get_location":{}}',
        '{"getLocation":{}}',
        '{"dishGetLocation":{}}',
        '{"request":{"get_location":{}}}'
    )

    $statusObj = Invoke-StarlinkHttpHandleWithCurl -RequestBodies $statusBodies -ProbeName "status"
    $locationObj = Invoke-StarlinkHttpHandleWithCurl -RequestBodies $locationBodies -ProbeName "location"
    if ($null -ne $statusObj -or $null -ne $locationObj) {
        return [pscustomobject]@{
            status = $statusObj
            location = $locationObj
        }
    }

    $statusObj = Invoke-StarlinkHttpHandle -RequestBodies $statusBodies -ProbeName "status"
    $locationObj = Invoke-StarlinkHttpHandle -RequestBodies $locationBodies -ProbeName "location"
    if ($null -ne $statusObj -or $null -ne $locationObj) {
        return [pscustomobject]@{
            status = $statusObj
            location = $locationObj
        }
    }

    $urls = @(
        "http://192.168.100.1/api/status",
        "http://dishy.starlink.com/api/status",
        "http://192.168.100.1/api/device/status",
        "http://dishy.starlink.com/api/device/status",
        "http://192.168.100.1/",
        "http://192.168.100.1/status",
        "http://192.168.100.1/support/diagnostics",
        "http://dishy.starlink.com/"
    )

    $lastError = $null
    foreach ($url in $urls) {
        try {
            $res = Invoke-WebRequest -Uri $url -Method GET -UseBasicParsing -TimeoutSec 8
            $obj = Try-ParseJsonFromText -Text ($res.Content | Out-String)
            if ($null -ne $obj) {
                return $obj
            }
        } catch {
            $lastError = $_.Exception.Message
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($lastError)) {
        Write-Log "WARN" "HTTP fallback HTML probes failed: $lastError"
    }

    return $null
}

function Get-DeviceSerial {
    $bios = $null
    try {
        $bios = (Get-CimInstance Win32_BIOS).SerialNumber
    } catch {}
    $serial = ""
    if ($null -ne $bios) {
        $serial = ([string]$bios).Trim()
    }

    if ([string]::IsNullOrWhiteSpace($serial) -or $serial -like "Parallels-*") {
        try {
            $uuid = (Get-CimInstance Win32_ComputerSystemProduct).UUID
            if (-not [string]::IsNullOrWhiteSpace($uuid)) {
                $serial = ([string]$uuid).Trim()
            }
        } catch {}
    }

    if ([string]::IsNullOrWhiteSpace($serial)) {
        $serial = $env:COMPUTERNAME
    }
    return $serial
}

function Get-DeviceIdentity {
    param([int]$ConfiguredSiteId)

    $cached = Read-JsonFile $DeviceFile
    $deviceSN = $null
    if ($null -ne $cached -and -not [string]::IsNullOrWhiteSpace($cached.device_sn)) {
        $deviceSN = [string]$cached.device_sn
    } else {
        $deviceSN = Get-DeviceSerial
    }

    $siteId = $ConfiguredSiteId
    if (($siteId -le 0) -and ($null -ne $cached) -and ($null -ne $cached.site_id)) {
        $siteId = [int]$cached.site_id
    }

    return [pscustomobject]@{
        DeviceSN = $deviceSN
        SiteId = $siteId
    }
}

function Save-DeviceIdentity {
    param(
        [string]$DeviceSN,
        [int]$SiteId
    )

    Write-JsonFile -Path $DeviceFile -Value @{
        device_sn = $DeviceSN
        site_id = $SiteId
        updated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
}

function Get-GrpcurlCommand {
    param([string]$ConfiguredPath)

    $cmd = Get-Command "grpcurl" -ErrorAction SilentlyContinue
    if ($null -ne $cmd) {
        return $cmd.Source
    }
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath) -and (Test-Path $ConfiguredPath)) {
        return $ConfiguredPath
    }
    return $null
}

function Invoke-StarlinkGrpc {
    param(
        [string]$GrpcurlCommand,
        [string]$JsonBody
    )

    if ([string]::IsNullOrWhiteSpace($GrpcurlCommand)) {
        return $null
    }

    try {
        $raw = & $GrpcurlCommand "-plaintext" "-d" $JsonBody "192.168.100.1:9200" "SpaceX.API.Device.Device/Handle" 2>$null
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $null
        }
        return ($raw | Out-String) | ConvertFrom-Json
    } catch {
        Write-Log "WARN" "Starlink gRPC request failed: $($_.Exception.Message)"
        return $null
    }
}

function Get-StarlinkSnapshot {
    param([object]$Config)

    $grpc = Get-GrpcurlCommand -ConfiguredPath $Config.GrpcurlPath
    if ([string]::IsNullOrWhiteSpace($grpc)) {
        Write-Log "WARN" "grpcurl not found; attempting built-in gRPC-web fallback at 192.168.100.1."
        $httpRaw = Get-StarlinkHttpStatus
        if ($null -ne $httpRaw) {
            $lat = Find-FirstNumber -Object $httpRaw -Names @("latitude", "lat")
            $lon = Find-FirstNumber -Object $httpRaw -Names @("longitude", "lon", "lng")
            $downBps = Find-FirstNumber -Object $httpRaw -Names @("downlinkThroughputBps", "downlink_throughput_bps")
            $upBps = Find-FirstNumber -Object $httpRaw -Names @("uplinkThroughputBps", "uplink_throughput_bps")
            $popLatency = Find-FirstNumber -Object $httpRaw -Names @("popPingLatencyMs", "pop_ping_latency_ms", "popLatencyMs", "pop_latency_ms")
            $snr = Find-FirstNumber -Object $httpRaw -Names @("snr", "downlinkSnr", "downlink_snr")
            $drop = Find-FirstNumber -Object $httpRaw -Names @("popPingDropRate", "pop_ping_drop_rate", "pingDropRate", "ping_drop_rate")
            $obstruction = Find-FirstNumber -Object $httpRaw -Names @("fractionObstructed", "fraction_obstructed", "obstructionPct", "obstruction_pct")
            $starlinkId = Find-FirstString -Object $httpRaw -Names @("starlink_id", "starlinkId", "device_id", "deviceId", "id")
            $azimuth = Find-FirstNumber -Object $httpRaw -Names @("boresightAzimuthDeg", "boresight_azimuth_deg", "azimuth", "azimuthDeg")
            $elevation = Find-FirstNumber -Object $httpRaw -Names @("boresightElevationDeg", "boresight_elevation_deg", "elevation", "elevationDeg")

            return [pscustomobject]@{
                Lat = $lat
                Lon = $lon
                StarlinkId = $starlinkId
                StarlinkUuid = Normalize-StarlinkId $starlinkId
                PopLatencyMs = $popLatency
                Snr = $snr
                ObstructionPct = Convert-FractionToPct $obstruction
                PingDropPct = Convert-FractionToPct $drop
                DownloadMbps = Convert-BpsToMbps $downBps
                UploadMbps = Convert-BpsToMbps $upBps
                AzimuthDeg = $azimuth
                ElevationDeg = $elevation
            }
        }

        Write-Log "WARN" "HTTP fallback on 192.168.100.1 unavailable; Starlink dish metrics skipped."
        return [pscustomobject]@{
            Lat = $null
            Lon = $null
            StarlinkId = $null
            StarlinkUuid = $null
            PopLatencyMs = $null
            Snr = $null
            ObstructionPct = $null
            PingDropPct = $null
            DownloadMbps = $null
            UploadMbps = $null
            AzimuthDeg = $null
            ElevationDeg = $null
        }
    }

    $locRaw = Invoke-StarlinkGrpc -GrpcurlCommand $grpc -JsonBody '{"get_location":{}}'
    $statusRaw = Invoke-StarlinkGrpc -GrpcurlCommand $grpc -JsonBody '{"get_status":{}}'

    $lat = Get-NestedValue -Object $locRaw -Path @("getLocation", "lla", "lat")
    $lon = Get-NestedValue -Object $locRaw -Path @("getLocation", "lla", "lon")

    $popLatency = Find-FirstNumber -Object $statusRaw -Names @("popPingLatencyMs", "pop_ping_latency_ms", "popLatencyMs", "pop_latency_ms")
    $snr = Find-FirstNumber -Object $statusRaw -Names @("snr", "downlinkSnr", "downlink_snr")
    $drop = Find-FirstNumber -Object $statusRaw -Names @("popPingDropRate", "pop_ping_drop_rate", "pingDropRate", "ping_drop_rate")
    $obstruction = Find-FirstNumber -Object $statusRaw -Names @("fractionObstructed", "fraction_obstructed", "obstructionPct", "obstruction_pct")
    $downBps = Find-FirstNumber -Object $statusRaw -Names @("downlinkThroughputBps", "downlink_throughput_bps")
    $upBps = Find-FirstNumber -Object $statusRaw -Names @("uplinkThroughputBps", "uplink_throughput_bps")
    $starlinkId = Find-FirstString -Object @($locRaw, $statusRaw) -Names @("starlink_id", "starlinkId", "device_id", "deviceId", "id")
    $azimuth = Find-FirstNumber -Object $statusRaw -Names @("boresightAzimuthDeg", "boresight_azimuth_deg", "azimuth", "azimuthDeg")
    $elevation = Find-FirstNumber -Object $statusRaw -Names @("boresightElevationDeg", "boresight_elevation_deg", "elevation", "elevationDeg")

    return [pscustomobject]@{
        Lat = $lat
        Lon = $lon
        StarlinkId = $starlinkId
        StarlinkUuid = Normalize-StarlinkId $starlinkId
        PopLatencyMs = $popLatency
        Snr = $snr
        ObstructionPct = Convert-FractionToPct $obstruction
        PingDropPct = Convert-FractionToPct $drop
        DownloadMbps = Convert-BpsToMbps $downBps
        UploadMbps = Convert-BpsToMbps $upBps
        AzimuthDeg = $azimuth
        ElevationDeg = $elevation
    }
}

function Get-DistanceKm {
    param(
        [double]$Lat1,
        [double]$Lon1,
        [double]$Lat2,
        [double]$Lon2
    )

    $r = 6371.0
    $dLat = [Math]::PI / 180 * ($Lat2 - $Lat1)
    $dLon = [Math]::PI / 180 * ($Lon2 - $Lon1)
    $a = [Math]::Sin($dLat / 2) * [Math]::Sin($dLat / 2) +
        [Math]::Cos([Math]::PI / 180 * $Lat1) *
        [Math]::Cos([Math]::PI / 180 * $Lat2) *
        [Math]::Sin($dLon / 2) * [Math]::Sin($dLon / 2)
    return $r * (2 * [Math]::Atan2([Math]::Sqrt($a), [Math]::Sqrt(1 - $a)))
}

function Resolve-SiteFromGps {
    param(
        [object]$Config,
        [object]$Snapshot
    )

    if ($null -eq $Snapshot.Lat -or $null -eq $Snapshot.Lon) {
        return $null
    }

    try {
        $headers = Get-AuthHeaders -Config $Config
        $sites = Invoke-RestMethod -Uri "$($Config.ApiBase)/api/sites" -Headers $headers -TimeoutSec 30
        $bestSiteId = $null
        $bestDistance = [double]::MaxValue

        foreach ($site in $sites) {
            if ($null -eq $site.lat -or $null -eq $site.lng) {
                continue
            }
            $dist = Get-DistanceKm -Lat1 ([double]$Snapshot.Lat) -Lon1 ([double]$Snapshot.Lon) -Lat2 ([double]$site.lat) -Lon2 ([double]$site.lng)
            if ($dist -lt $bestDistance) {
                $bestDistance = $dist
                $bestSiteId = [int]$site.id
            }
        }

        if ($null -ne $bestSiteId -and $bestDistance -le $Config.MaxSiteRadiusKm) {
            Write-Log "INFO" "GPS resolved site $bestSiteId at $([math]::Round($bestDistance, 3)) km."
            return $bestSiteId
        }
    } catch {
        Write-Log "WARN" "GPS site discovery failed: $($_.Exception.Message)"
    }

    return $null
}

function Request-BootstrapToken {
    param(
        [object]$Config,
        [string]$DeviceSN,
        [object]$Health,
        [object]$Snapshot
    )

    try {
        $headers = Get-AuthHeaders -Config $Config
        $payload = @{
            device_sn = $DeviceSN
            hostname = $env:COMPUTERNAME
            os = $Health.Os
            model = $Health.Model
            manufacturer = $Health.Manufacturer
            lat = $Snapshot.Lat
            lon = $Snapshot.Lon
            starlink_id = $Snapshot.StarlinkId
            starlink_uuid = $Snapshot.StarlinkUuid
        }
        $body = $payload | ConvertTo-Json -Depth 12 -Compress
        $res = Invoke-RestMethod -Uri "$($Config.ApiBase)/ingest/bootstrap-token" -Method POST -Headers $headers -Body $body -TimeoutSec 30

        if ([string]::IsNullOrWhiteSpace([string]$res.token) -or $null -eq $res.site_id -or [int]$res.site_id -le 0) {
            Write-Log "WARN" "Bootstrap token exchange did not return a usable site token."
            return $null
        }

        Write-Log "INFO" "Bootstrap resolved site $($res.site_id) via $($res.source); saving site-scoped agent token."
        return [pscustomobject]@{
            Token = [string]$res.token
            SiteId = [int]$res.site_id
        }
    } catch {
        $details = Get-HttpErrorDetails -ErrorRecord $_
        Write-Log "WARN" "Bootstrap token exchange failed: $($details.Message)"
        return $null
    }
}

function Queue-Payload {
    param(
        [string]$Endpoint,
        [object]$Payload
    )

    Ensure-Directory $QueueDir
    $item = @{
        endpoint = $Endpoint
        payload = $Payload
        queued_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    $name = "{0}_{1}.json" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssfff"), ([guid]::NewGuid().ToString("N"))
    Write-JsonFile -Path (Join-Path $QueueDir $name) -Value $item

    $queued = Get-ChildItem -Path $QueueDir -Filter "*.json" -ErrorAction SilentlyContinue | Sort-Object CreationTime
    if ($queued.Count -gt 3000) {
        $removeCount = $queued.Count - 3000
        $queued | Select-Object -First $removeCount | Remove-Item -Force -ErrorAction SilentlyContinue
    }
}

function Send-Ingest {
    param(
        [object]$Config,
        [string]$Endpoint,
        [object]$Payload,
        [bool]$QueueOnFailure = $true
    )

    try {
        $headers = Get-AuthHeaders -Config $Config
        $body = $Payload | ConvertTo-Json -Depth 12 -Compress
        Invoke-RestMethod -Uri "$($Config.ApiBase)/ingest/$Endpoint" -Method POST -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
        $script:LastSendError = $null
        return $true
    } catch {
        $errorDetails = Get-HttpErrorDetails -ErrorRecord $_
        $statusCode = $errorDetails.StatusCode

        # Backward compatibility: older backend may not expose /ingest/agent-health yet.
        if ($Endpoint -eq "agent-health" -and $statusCode -eq 404) {
            if (-not $script:DisableAgentHealthEndpoint) {
                Write-Log "INFO" "/ingest/agent-health not available on backend; disabling this endpoint for current run."
            }
            $script:DisableAgentHealthEndpoint = $true
            $script:LastSendError = $null
            return $true
        }

        Write-Log "WARN" "POST /ingest/$Endpoint failed: $($errorDetails.Message)"
        $script:LastSendError = [string]$errorDetails.Message
        if ($QueueOnFailure -and -not ($Endpoint -eq "agent-health" -and $script:DisableAgentHealthEndpoint)) {
            Queue-Payload -Endpoint $Endpoint -Payload $Payload
        }
        return $false
    }
}

function Flush-Queue {
    param([object]$Config)

    Ensure-Directory $QueueDir
    $files = Get-ChildItem -Path $QueueDir -Filter "*.json" -ErrorAction SilentlyContinue |
        Sort-Object CreationTime |
        Select-Object -First $Config.QueueFlushLimit

    foreach ($file in $files) {
        try {
            $item = Read-JsonFile $file.FullName
            if ($null -eq $item -or [string]::IsNullOrWhiteSpace($item.endpoint)) {
                Remove-Item -Path $file.FullName -Force
                continue
            }
            $ok = Send-Ingest -Config $Config -Endpoint ([string]$item.endpoint) -Payload $item.payload -QueueOnFailure $false
            if ($ok) {
                Remove-Item -Path $file.FullName -Force
            } else {
                break
            }
        } catch {
            Write-Log "WARN" "Queue flush failed for $($file.Name): $($_.Exception.Message)"
            break
        }
    }
}

function Get-SystemHealth {
    $os = Get-CimInstance Win32_OperatingSystem
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1

    $diskFreeGb = $null
    $diskTotalGb = $null
    $diskUsagePct = $null
    if ($null -ne $disk -and $disk.Size -gt 0) {
        $diskFreeGb = [math]::Round($disk.FreeSpace / 1GB, 2)
        $diskTotalGb = [math]::Round($disk.Size / 1GB, 2)
        $diskUsagePct = [math]::Round((($disk.Size - $disk.FreeSpace) / $disk.Size) * 100, 0)
    }

    $batteryPct = $null
    if ($null -ne $battery) {
        $batteryPct = $battery.EstimatedChargeRemaining
    }

    return [pscustomobject]@{
        Os = $os.Caption
        Model = (Get-CimInstance Win32_ComputerSystem).Model
        Manufacturer = (Get-CimInstance Win32_ComputerSystem).Manufacturer
        BatteryPct = $batteryPct
        BatteryHealthPct = $null
        DiskFreeGb = $diskFreeGb
        DiskTotalGb = $diskTotalGb
        DiskUsagePct = $diskUsagePct
        RamUsedMb = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1024, 0)
        RamTotalMb = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
    }
}

function Get-LatencyStats {
    param([string]$PingHost)

    try {
        $times = @(Test-Connection -ComputerName $PingHost -Count 10 -ErrorAction Stop | ForEach-Object { [double]$_.ResponseTime })
        if ($times.Count -eq 0) {
            return $null
        }
        $sorted = @($times | Sort-Object)
        $p50Index = [math]::Max(0, [math]::Ceiling($sorted.Count * 0.50) - 1)
        $p95Index = [math]::Max(0, [math]::Ceiling($sorted.Count * 0.95) - 1)
        return [pscustomobject]@{
            P50 = [math]::Round($sorted[$p50Index], 2)
            P95 = [math]::Round($sorted[$p95Index], 2)
        }
    } catch {
        Write-Log "WARN" "Latency probe failed: $($_.Exception.Message)"
        return $null
    }
}

function Get-WifiAdaptersUp {
    try {
        $adapters = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object {
            $_.Status -eq 'Up' -and (
                $_.Name -match 'Wi-?Fi|Wireless' -or
                $_.InterfaceDescription -match 'Wi-?Fi|Wireless|802\\.11'
            )
        })
        if ($adapters.Count -gt 0) { return $adapters }

        # Fallback: include any active adapter with an active IPv4 default route.
        $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Sort-Object RouteMetric |
            Select-Object -First 1
        if ($null -ne $route) {
            $ifIdx = [int]$route.InterfaceIndex
            $fallback = Get-NetAdapter -InterfaceIndex $ifIdx -ErrorAction SilentlyContinue
            if ($null -ne $fallback -and $fallback.Status -eq 'Up') {
                return @($fallback)
            }
        }
    } catch {
        Write-Log "WARN" "Unable to enumerate Wi-Fi adapters: $($_.Exception.Message)"
    }
    return @()
}

function Get-QueueStats {
    Ensure-Directory $QueueDir
    $files = @(Get-ChildItem -Path $QueueDir -Filter "*.json" -ErrorAction SilentlyContinue)
    $depth = $files.Count
    if ($depth -eq 0) {
        return [pscustomobject]@{
            QueueDepth = 0
            OldestQueueAgeSec = 0
        }
    }

    $oldest = ($files | Sort-Object CreationTime | Select-Object -First 1).CreationTimeUtc
    $ageSec = [int][Math]::Max(0, [Math]::Round(((Get-Date).ToUniversalTime() - $oldest).TotalSeconds))
    return [pscustomobject]@{
        QueueDepth = $depth
        OldestQueueAgeSec = $ageSec
    }
}

function Get-UsageDelta {
    try {
        $adapters = Get-WifiAdaptersUp
        if ($adapters.Count -eq 0) {
            return [pscustomobject]@{
                Date = (Get-Date).ToString("yyyy-MM-dd")
                BytesDown = 0
                BytesUp = 0
                CounterResetDetected = $false
                AdapterCountIncluded = 0
                SkipWrite = $true
            }
        }

        $statsByName = @{}
        foreach ($adapter in $adapters) {
            $st = Get-NetAdapterStatistics -Name $adapter.Name -ErrorAction SilentlyContinue
            if ($null -ne $st) {
                $statsByName[$adapter.Name] = @{
                    received_bytes = [int64]$st.ReceivedBytes
                    sent_bytes = [int64]$st.SentBytes
                }
            }
        }

        $today = (Get-Date).ToString("yyyy-MM-dd")
        $baseline = Read-JsonFile $UsageBaselineFile
        Write-JsonFile -Path $UsageBaselineFile -Value @{
            date = $today
            adapter_policy = $UsageAdapterPolicy
            adapters = $statsByName
            updated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        }

        if ($null -eq $baseline -or $baseline.date -ne $today -or $null -eq $baseline.adapters) {
            return $null
        }

        $down = [int64]0
        $up = [int64]0
        $counterReset = $false

        foreach ($name in $statsByName.Keys) {
            $curr = $statsByName[$name]
            $base = $baseline.adapters.$name
            if ($null -eq $base) {
                continue
            }
            $dDown = [int64]$curr.received_bytes - [int64]$base.received_bytes
            $dUp = [int64]$curr.sent_bytes - [int64]$base.sent_bytes
            if ($dDown -lt 0 -or $dUp -lt 0) {
                $counterReset = $true
                continue
            }
            $down += $dDown
            $up += $dUp
        }

        return [pscustomobject]@{
            Date = $today
            BytesDown = $down
            BytesUp = $up
            CounterResetDetected = $counterReset
            AdapterCountIncluded = $statsByName.Keys.Count
            SkipWrite = $counterReset
        }
    } catch {
        Write-Log "WARN" "Usage delta failed: $($_.Exception.Message)"
        return $null
    }
}

try {
    Ensure-Directory $DataDir
    Ensure-Directory $QueueDir

    $config = Get-Config
    Write-Log "INFO" "Agent starting version $AgentVersion run_id=$RunId install_source=$(Get-InstallSourceLabel) api_base=$($config.ApiBase) configured_site=$($config.SiteId)."
    $identity = Get-DeviceIdentity -ConfiguredSiteId $config.SiteId
    $health = Get-SystemHealth
    $snapshot = Get-StarlinkSnapshot -Config $config

    $siteId = $identity.SiteId
    if ($siteId -le 0) {
        $resolvedSiteId = Resolve-SiteFromGps -Config $config -Snapshot $snapshot
        if ($null -ne $resolvedSiteId) {
            $siteId = [int]$resolvedSiteId
        }
    }
    if ($siteId -le 0 -and $config.SiteId -gt 0) {
        $siteId = [int]$config.SiteId
    }

    if ($config.SiteId -le 0) {
        $bootstrap = Request-BootstrapToken -Config $config -DeviceSN $identity.DeviceSN -Health $health -Snapshot $snapshot
        if ($null -ne $bootstrap) {
            $config.ApiToken = $bootstrap.Token
            $config.SiteId = $bootstrap.SiteId
            $siteId = $bootstrap.SiteId
            Save-AgentConfig -Config $config
            Update-InstallSourceSite -SiteId $siteId
        } elseif ($siteId -gt 0) {
            Write-Log "WARN" "Using discovery site 0 for this run because site-scoped token exchange did not complete."
            $siteId = 0
        }
    }

    if ($siteId -le 0) {
        Write-Log "WARN" "Unable to determine site_id yet; reporting laptop under discovery site 0."
        $siteId = 0
    }
    Save-DeviceIdentity -DeviceSN $identity.DeviceSN -SiteId $siteId

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Flush-Queue -Config $config

    if ($null -ne $snapshot.Lat -or $null -ne $snapshot.StarlinkId -or $null -ne $snapshot.PopLatencyMs -or $null -ne $snapshot.DownloadMbps) {
        $hintSiteId = $identity.SiteId
        if ($hintSiteId -le 0) {
            $hintSiteId = $siteId
        }

        $signalPayload = @{
            device_sn = $identity.DeviceSN
            site_id = $hintSiteId
            timestamp_utc = $timestamp
            pop_latency_ms = $snapshot.PopLatencyMs
            snr = $snapshot.Snr
            obstruction_pct = $snapshot.ObstructionPct
            ping_drop_pct = $snapshot.PingDropPct
            download_mbps = $snapshot.DownloadMbps
            upload_mbps = $snapshot.UploadMbps
            lat = $snapshot.Lat
            lon = $snapshot.Lon
            starlink_id = $snapshot.StarlinkId
            starlink_uuid = $snapshot.StarlinkUuid
            azimuth_deg = $snapshot.AzimuthDeg
            elevation_deg = $snapshot.ElevationDeg
        }
        $signalPayload = Add-PayloadMeta -Payload $signalPayload -CollectedAtUtc $timestamp
        Send-Ingest -Config $config -Endpoint "signal" -Payload $signalPayload | Out-Null
    }

    $heartbeat = @{
        device_sn = $identity.DeviceSN
        site_id = $siteId
        timestamp_utc = $timestamp
        hostname = $env:COMPUTERNAME
        os = $health.Os
        model = $health.Model
        manufacturer = $health.Manufacturer
    }
    $heartbeat = Add-PayloadMeta -Payload $heartbeat -CollectedAtUtc $timestamp
    $heartbeatOk = Send-Ingest -Config $config -Endpoint "heartbeat" -Payload $heartbeat
    if ($heartbeatOk) {
        Set-Content -Path $LastHeartbeatFile -Value $timestamp -Encoding UTF8
    }

    $healthPayload = @{
        device_sn = $identity.DeviceSN
        site_id = $siteId
        timestamp_utc = $timestamp
        battery_pct = $health.BatteryPct
        battery_health_pct = $health.BatteryHealthPct
        disk_free_gb = $health.DiskFreeGb
        disk_total_gb = $health.DiskTotalGb
        disk_usage_pct = $health.DiskUsagePct
        ram_used_mb = $health.RamUsedMb
        ram_total_mb = $health.RamTotalMb
    }
    $healthPayload = Add-PayloadMeta -Payload $healthPayload -CollectedAtUtc $timestamp
    Send-Ingest -Config $config -Endpoint "health" -Payload $healthPayload | Out-Null

    $latency = Get-LatencyStats -PingHost $config.PingHost
    if ($null -ne $latency) {
        $latencyPayload = @{
            device_sn = $identity.DeviceSN
            site_id = $siteId
            timestamp_utc = $timestamp
            p50_ms = $latency.P50
            p95_ms = $latency.P95
        }
        $latencyPayload = Add-PayloadMeta -Payload $latencyPayload -CollectedAtUtc $timestamp
        Send-Ingest -Config $config -Endpoint "latency" -Payload $latencyPayload | Out-Null
    }

    $usage = Get-UsageDelta
    if ($null -ne $usage) {
        if (-not $usage.SkipWrite) {
            $usagePayload = @{
                device_sn = $identity.DeviceSN
                site_id = $siteId
                date = $usage.Date
                bytes_down_delta = $usage.BytesDown
                bytes_up_delta = $usage.BytesUp
                adapter_policy = $UsageAdapterPolicy
                adapter_count_included = $usage.AdapterCountIncluded
                counter_reset_detected = $usage.CounterResetDetected
                sample_window_sec = $SampleWindowSec
            }
            $usagePayload = Add-PayloadMeta -Payload $usagePayload -CollectedAtUtc $timestamp
            Send-Ingest -Config $config -Endpoint "usage" -Payload $usagePayload | Out-Null
        } else {
            Write-Log "WARN" "Skipping usage write due to counter reset or adapter mismatch."
        }
    }

    $q = Get-QueueStats
    $lastSuccess = $null
    if (Test-Path $LastHeartbeatFile) {
        $lastSuccess = (Get-Content -Path $LastHeartbeatFile -Raw).Trim()
    }
    if (-not $script:DisableAgentHealthEndpoint) {
        $agentHealthPayload = @{
            device_sn = $identity.DeviceSN
            site_id = $siteId
            timestamp_utc = $timestamp
            queue_depth = $q.QueueDepth
            oldest_queue_age_sec = $q.OldestQueueAgeSec
            wifi_adapter_count = (Get-WifiAdaptersUp).Count
            agent_version = $AgentVersion
            run_id = $RunId
            last_error = $script:LastSendError
            last_success_at = $lastSuccess
        }
        $agentHealthPayload = Add-PayloadMeta -Payload $agentHealthPayload -CollectedAtUtc $timestamp
        Send-Ingest -Config $config -Endpoint "agent-health" -Payload $agentHealthPayload | Out-Null
    }

    Write-Log "INFO" "Cycle complete for device $($identity.DeviceSN) at site $siteId."
    exit 0
} catch {
    Write-Log "ERROR" $_.Exception.Message
    exit 1
}
