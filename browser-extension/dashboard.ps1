<#
.SYNOPSIS
Displays OpenBrowser workspace and local system health.
#>

[CmdletBinding()]
param(
    [switch]$Watch,
    [ValidateRange(1, 300)]
    [int]$IntervalSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BridgeHost = if ($env:WORKSPACE_HOST) { $env:WORKSPACE_HOST } else { '127.0.0.1' }
$BridgePort = if ($env:WORKSPACE_PORT) { [int]$env:WORKSPACE_PORT } else { 5010 }
$BaseUri = "http://${BridgeHost}:${BridgePort}"

function Write-ColorOutput {
    param(
        [Parameter(Mandatory)]
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::White
    )
    Write-Host $Message -ForegroundColor $Color
}

function Get-BridgeStatus {
    try {
        $response = Invoke-RestMethod -Uri "$BaseUri/health" -Method Get -TimeoutSec 2
        return @{ Running = $true; Response = $response }
    }
    catch {
        return @{ Running = $false; Error = $_.Exception.Message }
    }
}

function Get-SystemMetrics {
    $cpuPercent = $null
    try {
        $sample = Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop
        $cpuPercent = [math]::Round($sample.CounterSamples[0].CookedValue, 2)
    }
    catch {
        $cpuPercent = 'unavailable'
    }

    $memoryAvailable = 'unavailable'
    try {
        $memorySample = Get-Counter '\Memory\Available MBytes' -ErrorAction Stop
        $memoryAvailable = [math]::Round($memorySample.CounterSamples[0].CookedValue, 0)
    }
    catch {
        # Get-Counter is not available on every PowerShell platform.
    }

    $systemDriveName = if ($env:SystemDrive) { $env:SystemDrive.TrimEnd(':') } else { 'C' }
    $drive = Get-PSDrive -Name $systemDriveName -ErrorAction SilentlyContinue

    return @{
        CPUPercent = $cpuPercent
        MemoryAvailableMB = $memoryAvailable
        DiskUsedGB = if ($drive) { [math]::Round($drive.Used / 1GB, 2) } else { 'unavailable' }
        DiskFreeGB = if ($drive) { [math]::Round($drive.Free / 1GB, 2) } else { 'unavailable' }
    }
}

function Write-Dashboard {
    Clear-Host
    $bridge = Get-BridgeStatus
    $system = Get-SystemMetrics

    Write-ColorOutput '╔═══════════════════════════════════════════════════════╗' Cyan
    Write-ColorOutput '║           OpenBrowser Workspace Dashboard            ║' Cyan
    Write-ColorOutput '╚═══════════════════════════════════════════════════════╝' Cyan
    Write-Host
    Write-Host ('{0,-22} : {1}' -f 'Companion endpoint', $BaseUri)
    Write-Host ('{0,-22} : {1}' -f 'Bridge status', $(if ($bridge.Running) { 'online' } else { 'offline' }))

    if ($bridge.Running) {
        Write-Host ('{0,-22} : {1}' -f 'Version', $bridge.Response.version)
        Write-Host ('{0,-22} : {1}' -f 'Uptime', "$([math]::Round($bridge.Response.uptime, 0)) seconds")
        Write-Host ('{0,-22} : {1}' -f 'Database', $bridge.Response.database)
        Write-Host ('{0,-22} : {1}' -f 'Main bridge', $bridge.Response.bridgeUrl)
        if ($bridge.Response.activeProject) {
            Write-Host ('{0,-22} : {1}' -f 'Active project', $bridge.Response.activeProject.root)
        }
    }
    else {
        Write-ColorOutput "Health error: $($bridge.Error)" DarkYellow
    }

    Write-Host
    Write-ColorOutput 'System metrics' Yellow
    Write-Host ('{0,-22} : {1}' -f 'CPU usage', "$($system.CPUPercent)%")
    Write-Host ('{0,-22} : {1}' -f 'Available memory', "$($system.MemoryAvailableMB) MB")
    Write-Host ('{0,-22} : {1}' -f 'Disk used', "$($system.DiskUsedGB) GB")
    Write-Host ('{0,-22} : {1}' -f 'Disk free', "$($system.DiskFreeGB) GB")
    Write-Host
    Write-ColorOutput 'Commands' Yellow
    Write-Host '  ./openbrowser.ps1 start'
    Write-Host '  ./openbrowser.ps1 register -ProjectPath <path>'
    Write-Host '  ./openbrowser.ps1 index'
    Write-Host '  ./openbrowser.ps1 analyze'
    if ($Watch) {
        Write-Host
        Write-ColorOutput "Refreshing every $IntervalSeconds seconds. Press Ctrl+C to stop." DarkGray
    }
}

do {
    Write-Dashboard
    if ($Watch) {
        Start-Sleep -Seconds $IntervalSeconds
    }
} while ($Watch)
