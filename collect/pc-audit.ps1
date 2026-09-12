<#
.SYNOPSIS
    Collect a read-only snapshot of this machine and write it to stdout as JSON.

.DESCRIPTION
    This script reads. It does not write, and that is the point of it: you are being asked to
    run something from the internet on your own machine, so it is short enough to read first
    and it contains no cmdlet that can change anything. src/collector.test.ts enforces
    that by scanning this file for mutating verbs, so the promise is checked rather than made.

    Nothing is sent anywhere. The output goes to stdout; where it goes after that is yours.

    Every source is read inside its own try/catch, and a source that cannot be read is
    recorded in machine.unreadable instead of stopping the run. That distinction carries all
    the way into the report, because "found nothing" and "was not allowed to look" are
    different answers and only one of them is good news. Several sources need an elevated
    session; without one you get a shorter snapshot rather than an error.

    Written for Windows PowerShell 5.1, which is what ships with Windows. No modern operators,
    so it runs on a stock machine with nothing installed.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File collect\pc-audit.ps1 > report.json

.EXAMPLE
    # Then either hand it to the analyzer
    node bin/pc-audit.mjs report.json --profile fps
    # or drop it on the page, which does the same thing in your browser and uploads nothing.
#>
[CmdletBinding()]
param(
    # Emit indented JSON. Easier to read, and easier to check what it holds before you move it.
    [switch] $Pretty,

    # Replace your username, your home directory and any drive-letter path with placeholders.
    #
    # Use this before pasting a snapshot anywhere. Without it the output names the account you
    # are logged in as and the install path of every service on the machine, which is fine on
    # your own disk and more than you meant to publish in a bug report. The analyzer does not
    # read paths at all, so a redacted snapshot produces exactly the same findings - and
    # src/collector.test.ts checks that the redacted output carries no path under Users.
    [switch] $Redact
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Unreadable = New-Object System.Collections.ArrayList

<#
    Convert a string to one with the identifying parts taken out.

    Named ConvertTo- rather than Remove- on purpose. The read-only guard in
    src/collector.test.ts classifies cmdlets by PowerShell approved verb, and Remove- is on
    its list because Remove-Item and Remove-ItemProperty delete things - so calling this
    Remove-Identity made the guard fire on the script that defines it. The guard was right
    about the name and wrong about the intent, and the honest fix is the name: nothing here
    removes anything, it returns a different string.

    Applied to the finished snapshot rather than at each reader, so a field added later is
    covered without anybody remembering to cover it. Ordered longest-match-first: the home
    directory contains the username, so replacing the username first would leave a half-
    redacted path that still names the account.
#>
function ConvertTo-Redacted {
    param([string] $Text)
    if (-not $Redact -or [string]::IsNullOrEmpty($Text)) { return $Text }
    $out = $Text

    foreach ($pair in @(
        @{ From = $env:USERPROFILE; To = '<home>' },
        @{ From = $env:USERNAME; To = '<user>' },
        @{ From = $env:COMPUTERNAME; To = '<machine>' }
    )) {
        if (-not $pair.From) { continue }
        # This runs over serialised JSON, where every backslash has been doubled. Escaping the
        # value and then letting each backslash match one OR two makes the same pattern work
        # against `C:\Users\me` and against `C:\\Users\\me`, which is what the document
        # actually contains. Without it the home-directory rule matched nothing at all and the
        # username rule only worked where the name happened to appear as a bare word.
        $pattern = [regex]::Escape($pair.From) -replace '\\\\', '\\{1,2}'
        $out = [regex]::Replace($out, $pattern, $pair.To, 'IgnoreCase')
    }

    # Anything still carrying a user directory belongs to somebody whose name the environment
    # cannot tell us: a second profile on the machine, or a service running as another account.
    #
    # The separator is CAPTURED and put back rather than written literally. Replacing it with a
    # single backslash produced a document that was no longer valid JSON - a redaction that
    # quietly corrupts the file it is protecting is worse than no redaction, because you only
    # find out after you have sent it.
    $out = [regex]::Replace($out, '(?i)([A-Za-z]):(\\{1,2})Users\2[^\\"'']+', '$1:$2Users$2<user>')
    return $out
}

<#
    Run a reader and give back what it produced, or record why it could not.

    Every source in this script goes through here. The alternative - letting one denied
    registry key end the run - loses the fourteen sources that would have worked, and on a
    machine without administrator rights that is most runs.
#>
function Read-Source {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][scriptblock] $Reader,
        $Fallback = $null
    )
    try {
        return & $Reader
    } catch {
        [void] $script:Unreadable.Add(('{0}: {1}' -f $Name, $_.Exception.Message))
        return $Fallback
    }
}

function Test-Elevated {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

# Mode lists come back in hertz already; this only guards against the zero and the null that
# some virtual adapters report for a display that is not really there.
function Select-Hz {
    param($Values)
    $out = @()
    foreach ($value in @($Values)) {
        if ($null -ne $value -and $value -gt 0) { $out += [int] $value }
    }
    return ($out | Sort-Object -Unique)
}

$collectedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

# ---- Displays ---------------------------------------------------------------------------
# Two sources, because neither is enough alone: Win32_VideoController knows the mode in use
# and CIM_VideoControllerResolution knows what else the panel offers.
$displays = Read-Source -Name 'Displays (Win32_VideoController)' -Fallback @() -Reader {
    $controllers = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop)
    $modes = @(Get-CimInstance -ClassName CIM_VideoControllerResolution -ErrorAction SilentlyContinue)
    $result = @()
    foreach ($controller in $controllers) {
        if (-not $controller.CurrentHorizontalResolution) { continue }
        $matching = @($modes | Where-Object {
            $_.HorizontalResolution -eq $controller.CurrentHorizontalResolution -and
            $_.VerticalResolution -eq $controller.CurrentVerticalResolution
        })
        $result += [pscustomobject] @{
            name        = $controller.Name
            currentHz   = [int] $controller.CurrentRefreshRate
            availableHz = (Select-Hz ($matching | ForEach-Object { $_.RefreshRate }))
            width       = [int] $controller.CurrentHorizontalResolution
            height      = [int] $controller.CurrentVerticalResolution
            primary     = $true
        }
    }
    return $result
}

# ---- Boot -------------------------------------------------------------------------------
# Windows already timed its own boot. Event 100 carries the totals and 101-110 name the
# individual applications, services and drivers it blamed, each with a millisecond figure.
$boot = Read-Source -Name 'Boot log (Diagnostics-Performance)' -Fallback @() -Reader {
    $events = @(Get-WinEvent -FilterHashtable @{
        LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'
        Id      = 100, 101, 102, 103, 106, 109, 110
    } -MaxEvents 400 -ErrorAction Stop)

    $kindOf = @{ 101 = 'app'; 102 = 'driver'; 103 = 'service'; 106 = 'app'; 109 = 'driver'; 110 = 'service' }
    $byBoot = @{}
    foreach ($event in $events) {
        $xml = [xml] $event.ToXml()
        $data = @{}
        foreach ($item in $xml.Event.EventData.Data) { $data[$item.Name] = $item.'#text' }
        # Events from one boot share a BootTsVersion/bucket; the timestamp to the minute is a
        # good enough key and needs no assumption about which fields a given build emits.
        $key = $event.TimeCreated.ToString('yyyy-MM-ddTHH:mm')
        if (-not $byBoot.ContainsKey($key)) {
            $byBoot[$key] = [pscustomobject] @{
                at       = $event.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
                bootMs   = $null
                degraded = New-Object System.Collections.ArrayList
            }
        }
        $record = $byBoot[$key]
        if ($event.Id -eq 100) {
            if ($data.ContainsKey('BootTime')) { $record.bootMs = [int] $data['BootTime'] }
        } else {
            $name = $null
            foreach ($field in 'Name', 'FriendlyName', 'FileName', 'ServiceName') {
                if ($data.ContainsKey($field) -and $data[$field]) { $name = $data[$field]; break }
            }
            $ms = 0
            foreach ($field in 'TotalTime', 'Degradation', 'StartTime') {
                if ($data.ContainsKey($field) -and $data[$field]) { $ms = [int] $data[$field]; break }
            }
            if ($name -and $ms -gt 0) {
                [void] $record.degraded.Add([pscustomobject] @{
                    name = $name
                    kind = $kindOf[[int] $event.Id]
                    ms   = $ms
                })
            }
        }
    }
    return @($byBoot.Values | Sort-Object at -Descending | Select-Object -First 20)
}

# ---- Startup ----------------------------------------------------------------------------
# Win32_StartupCommand lists them; only Explorer knows which were switched off in Task
# Manager, and it keeps that in a binary value whose first byte carries the flag.
$startup = Read-Source -Name 'Startup items' -Fallback @() -Reader {
    $approved = @{}
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $key = Get-Item $root
        foreach ($valueName in $key.GetValueNames()) {
            $bytes = $key.GetValue($valueName)
            if ($bytes -is [byte[]] -and $bytes.Length -gt 0) {
                # An even first byte means enabled. Anything else is a user or policy switching
                # it off, which is the only place that fact is recorded.
                $approved[$valueName] = (($bytes[0] % 2) -eq 0)
            }
        }
    }
    $result = @()
    foreach ($item in @(Get-CimInstance -ClassName Win32_StartupCommand -ErrorAction Stop)) {
        $enabled = $true
        if ($approved.ContainsKey($item.Name)) { $enabled = $approved[$item.Name] }
        $result += [pscustomobject] @{
            name      = $item.Name
            command   = $item.Command
            publisher = $item.User
            enabled   = $enabled
        }
    }
    return $result
}

# ---- Services ---------------------------------------------------------------------------
$services = Read-Source -Name 'Services' -Fallback @() -Reader {
    $win32 = @(Get-CimInstance -ClassName Win32_Service -ErrorAction Stop)
    # One pass over everything, rather than asking for each service's dependents in turn:
    # RequiredServices per service is hundreds of round trips on a normal machine.
    $dependents = @{}
    foreach ($dependency in @(Get-CimInstance -ClassName Win32_DependentService -ErrorAction SilentlyContinue)) {
        $antecedent = ([string] $dependency.Antecedent)
        if ($antecedent -match 'Name = "([^"]+)"') {
            $name = $matches[1]
            if (-not $dependents.ContainsKey($name)) { $dependents[$name] = @() }
            $dependent = ([string] $dependency.Dependent)
            if ($dependent -match 'Name = "([^"]+)"') { $dependents[$name] += $matches[1] }
        }
    }
    $result = @()
    foreach ($service in $win32) {
        # Path, not signature. Verifying a signature per service is slow and needs the file to
        # still be there; living under System32 is a weaker signal, and it is only ever used
        # to rank a finding rather than to accuse one.
        $microsoft = $false
        if ($service.PathName -and $service.PathName -match '(?i)\\Windows\\(System32|SysWOW64)\\') { $microsoft = $true }
        $memoryMb = $null
        if ($service.ProcessId -and $service.ProcessId -gt 0) {
            $process = Get-Process -Id $service.ProcessId -ErrorAction SilentlyContinue
            if ($process) { $memoryMb = [math]::Round($process.WorkingSet64 / 1MB, 1) }
        }
        $names = @()
        if ($dependents.ContainsKey($service.Name)) { $names = $dependents[$service.Name] }
        $result += [pscustomobject] @{
            name       = $service.Name
            display    = $service.DisplayName
            state      = $service.State
            startMode  = $service.StartMode
            microsoft  = $microsoft
            dependents = $names
            memoryMb   = $memoryMb
        }
    }
    return $result
}

# ---- Scheduled tasks --------------------------------------------------------------------
$tasks = Read-Source -Name 'Scheduled tasks' -Fallback @() -Reader {
    $result = @()
    foreach ($task in @(Get-ScheduledTask -ErrorAction Stop)) {
        $triggers = @()
        foreach ($trigger in @($task.Triggers)) {
            if ($null -ne $trigger) { $triggers += $trigger.CimClass.CimClassName }
        }
        $result += [pscustomobject] @{
            path     = $task.TaskPath
            name     = $task.TaskName
            state    = [string] $task.State
            triggers = $triggers
            author   = $task.Author
        }
    }
    return $result
}

# ---- Memory -----------------------------------------------------------------------------
$memory = Read-Source -Name 'Memory' -Reader {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $perf = Get-CimInstance -ClassName Win32_PerfRawData_PerfOS_Memory -ErrorAction SilentlyContinue
    $committed = $null
    $limit = $null
    if ($perf) {
        $committed = [math]::Round($perf.CommittedBytes / 1MB)
        $limit = [math]::Round($perf.CommitLimit / 1MB)
    }
    return [pscustomobject] @{
        totalMb       = [math]::Round($os.TotalVisibleMemorySize / 1KB)
        availableMb   = [math]::Round($os.FreePhysicalMemory / 1KB)
        committedMb   = $committed
        commitLimitMb = $limit
    }
}

# ---- Storage ----------------------------------------------------------------------------
$storage = Read-Source -Name 'Storage' -Fallback @() -Reader {
    $systemDrive = $env:SystemDrive
    # Volume -> partition -> disk number -> physical disk.
    #
    # The short version of this read the first physical disk and handed its media type to
    # every volume. On a machine with an NVMe drive and a spinning backup it labelled both
    # whichever came back first, and the only check that reads media type is the one arguing
    # about whether defragmenting is pointless - so it got that backwards in both directions.
    $mediaByLetter = @{}
    try {
        foreach ($partition in @(Get-Partition -ErrorAction Stop)) {
            if (-not $partition.DriveLetter) { continue }
            $disk = Get-PhysicalDisk -DeviceNumber $partition.DiskNumber -ErrorAction SilentlyContinue
            if ($disk) { $mediaByLetter[[string] $partition.DriveLetter] = [string] $disk.MediaType }
        }
    } catch {
        [void] $script:Unreadable.Add(('Disk media type: {0}' -f $_.Exception.Message))
    }

    $result = @()
    foreach ($volume in @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType = 3' -ErrorAction Stop)) {
        $letter = ([string] $volume.DeviceID).Substring(0, 1)
        $media = 'Unspecified'
        if ($mediaByLetter.ContainsKey($letter)) { $media = $mediaByLetter[$letter] }
        $result += [pscustomobject] @{
            drive     = $volume.DeviceID
            mediaType = $media
            totalGb   = [math]::Round($volume.Size / 1GB, 1)
            freeGb    = [math]::Round($volume.FreeSpace / 1GB, 1)
            system    = ($volume.DeviceID -eq $systemDrive)
        }
    }
    return $result
}

# ---- GPU --------------------------------------------------------------------------------
$gpu = Read-Source -Name 'GPU' -Fallback @() -Reader {
    $result = @()
    foreach ($controller in @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop)) {
        $driverDate = $null
        if ($controller.DriverDate) {
            $driverDate = ([datetime] $controller.DriverDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        }
        $result += [pscustomobject] @{
            name          = $controller.Name
            driverVersion = $controller.DriverVersion
            driverDate    = $driverDate
            memoryMb      = $null
        }
    }
    return $result
}

# ---- Power ------------------------------------------------------------------------------
$power = Read-Source -Name 'Power plan' -Reader {
    $active = powercfg /getactivescheme
    $planName = $null
    $guid = $null
    if ($active -match 'GUID:\s*([0-9a-f-]+)\s*\(([^)]+)\)') {
        $guid = $matches[1]
        $planName = $matches[2]
    }
    $onBattery = $false
    $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue
    if ($battery) { $onBattery = ($battery.BatteryStatus -eq 1) }
    return [pscustomobject] @{
        activePlan     = $planName
        activePlanGuid = $guid
        onBattery      = $onBattery
    }
}

# ---- Graphics settings ------------------------------------------------------------------
$graphics = Read-Source -Name 'Graphics settings' -Reader {
    function Get-RegValue {
        param($Path, $Name)
        if (-not (Test-Path $Path)) { return $null }
        $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
        if ($null -eq $item) { return $null }
        return $item.$Name
    }
    $hwSch = Get-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode'
    $dvr = Get-RegValue 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled'
    $bar = Get-RegValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled'
    $out = [pscustomobject] @{ hags = $null; gameDvr = $null; gameBar = $null; vrr = $null }
    # 2 means enabled, 1 disabled. A missing value means the machine predates the setting,
    # which is not the same as it being off, so it stays null.
    if ($null -ne $hwSch) { $out.hags = ([int] $hwSch -eq 2) }
    if ($null -ne $dvr) { $out.gameDvr = ([int] $dvr -eq 1) }
    if ($null -ne $bar) { $out.gameBar = ([int] $bar -eq 1) }
    return $out
}

# ---- Defender and Update ----------------------------------------------------------------
$defender = Read-Source -Name 'Defender (Get-MpComputerStatus needs an elevated session)' -Reader {
    $status = Get-MpComputerStatus -ErrorAction Stop
    return [pscustomobject] @{
        realtimeEnabled  = [bool] $status.RealTimeProtectionEnabled
        signatureAgeDays = [int] $status.AntivirusSignatureAge
    }
}

$updates = Read-Source -Name 'Windows Update service' -Reader {
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name = 'wuauserv'" -ErrorAction Stop
    return [pscustomobject] @{
        serviceStartMode  = $service.StartMode
        lastInstalledDays = $null
    }
}

# ---- Emit -------------------------------------------------------------------------------
$snapshot = [pscustomobject] @{
    schema      = 1
    collectedAt = $collectedAt
    real        = $true
    machine     = [pscustomobject] @{
        windows    = (Read-Source -Name 'OS name' -Reader { (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption })
        build      = [string] [System.Environment]::OSVersion.Version
        elevated   = (Test-Elevated)
        unreadable = @($script:Unreadable)
    }
    displays    = $displays
    boot        = $boot
    startup     = $startup
    services    = $services
    tasks       = $tasks
    memory      = $memory
    storage     = $storage
    gpu         = $gpu
    power       = $power
    graphics    = $graphics
    defender    = $defender
    updates     = $updates
}

# Depth 6 because degraded entries sit three levels down and the default of 2 silently
# replaces them with the type name.
$json = if ($Pretty) {
    $snapshot | ConvertTo-Json -Depth 6
} else {
    $snapshot | ConvertTo-Json -Depth 6 -Compress
}

<#
    Redaction happens here, on the finished document, and that is deliberate.

    Scrubbing inside each reader would mean every field added later needing somebody to
    remember. One pass over the serialised JSON cannot be forgotten, and it covers fields that
    did not exist when the pass was written. The cost is that it is textual rather than
    structural, which is why the patterns are anchored on drive-letter paths and on the three
    names the environment can tell us, rather than trying to be clever about it.
#>
if ($Redact) { $json = ConvertTo-Redacted $json }

$json
