<#
.SYNOPSIS
Secure management commands for the OpenBrowser workspace companion.
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'register', 'search', 'analyze', 'index', 'install-hook')]
    [string]$Command = 'status',

    [Parameter(Position = 1)]
    [string]$Value,

    [string]$ProjectPath = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$WorkspaceRoot = $PSScriptRoot
$BridgeHost = if ($env:WORKSPACE_HOST) { $env:WORKSPACE_HOST } else { '127.0.0.1' }
$BridgePort = if ($env:WORKSPACE_PORT) { [int]$env:WORKSPACE_PORT } else { 5010 }
$BaseUri = "http://${BridgeHost}:${BridgePort}"
$PidFile = Join-Path $WorkspaceRoot '.workspace-bridge.pid'
$LogFile = Join-Path $WorkspaceRoot 'workspace-bridge.log'
$ErrorLogFile = Join-Path $WorkspaceRoot 'workspace-bridge.error.log'

function Write-ColorOutput {
    param(
        [Parameter(Mandatory)]
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::White
    )
    Write-Host $Message -ForegroundColor $Color
}

function Import-WorkspaceEnvironment {
    $envFile = Join-Path $WorkspaceRoot '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
            continue
        }

        $parts = $trimmed.Split('=', 2)
        $name = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($name -and -not [Environment]::GetEnvironmentVariable($name, 'Process')) {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

function Get-WorkspaceHeaders {
    if (-not $env:WORKSPACE_TOKEN) {
        throw 'WORKSPACE_TOKEN is not set. Copy .env.example to .env and create a token of at least 24 characters.'
    }
    return @{ Authorization = "Bearer $($env:WORKSPACE_TOKEN)" }
}

function Invoke-WorkspaceApi {
    param(
        [Parameter(Mandatory)]
        [ValidateSet('GET', 'POST', 'DELETE')]
        [string]$Method,
        [Parameter(Mandatory)]
        [string]$Route,
        [object]$Body
    )

    $parameters = @{
        Uri = "$BaseUri$Route"
        Method = $Method
        Headers = Get-WorkspaceHeaders
        TimeoutSec = 120
    }

    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }

    Invoke-RestMethod @parameters
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

function Get-SavedProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return $null
    }

    $savedPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($savedPid -notmatch '^\d+$') {
        Remove-Item -LiteralPath $PidFile -Force
        return $null
    }

    $process = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
    if (-not $process) {
        Remove-Item -LiteralPath $PidFile -Force
        return $null
    }
    return $process
}

function Start-Bridge {
    $status = Get-BridgeStatus
    if ($status.Running) {
        Write-ColorOutput "Workspace companion is already online at $BaseUri" Yellow
        return
    }

    $existing = Get-SavedProcess
    if ($existing) {
        throw "PID file points to running process $($existing.Id), but health check failed. Stop it before starting another instance."
    }

    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw 'pnpm is required. Install or activate pnpm 11.2.2 before starting the companion.'
    }

    Get-WorkspaceHeaders | Out-Null
    $process = Start-Process `
        -FilePath 'pnpm' `
        -ArgumentList @('run', 'dev') `
        -WorkingDirectory $WorkspaceRoot `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $LogFile `
        -RedirectStandardError $ErrorLogFile

    Set-Content -LiteralPath $PidFile -Value $process.Id -NoNewline
    Start-Sleep -Seconds 2

    $status = Get-BridgeStatus
    if (-not $status.Running) {
        throw "Companion failed to start. Inspect $LogFile and $ErrorLogFile. The script did not terminate any unrelated process using port $BridgePort."
    }

    Write-ColorOutput "Workspace companion started with PID $($process.Id)" Green
}

function Stop-Bridge {
    $process = Get-SavedProcess
    if (-not $process) {
        Write-ColorOutput 'No managed workspace companion process is running.' Yellow
        return
    }

    Stop-Process -Id $process.Id -Force
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-ColorOutput "Stopped managed workspace companion process $($process.Id)" Green
}

function Get-ToolVersion {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [string[]]$Arguments = @('--version')
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        return 'not installed'
    }

    try {
        return (& $command.Source @Arguments 2>$null | Select-Object -First 1)
    }
    catch {
        return 'version unavailable'
    }
}

function Show-Dashboard {
    $status = Get-BridgeStatus
    Write-ColorOutput "`nOpenBrowser Workspace" Cyan
    Write-ColorOutput ('─' * 58) DarkGray
    Write-Host ('{0,-20} : {1}' -f 'Status', $(if ($status.Running) { 'online' } else { 'offline' }))
    Write-Host ('{0,-20} : {1}' -f 'Endpoint', $BaseUri)
    Write-Host ('{0,-20} : {1}' -f 'Workspace', $WorkspaceRoot)
    Write-Host ('{0,-20} : {1}' -f 'Managed PID', $((Get-SavedProcess)?.Id ?? 'none'))
    Write-Host ('{0,-20} : {1}' -f 'Node', (Get-ToolVersion 'node'))
    Write-Host ('{0,-20} : {1}' -f 'pnpm', (Get-ToolVersion 'pnpm'))
    Write-Host ('{0,-20} : {1}' -f 'Python', (Get-ToolVersion 'python'))
    Write-Host ('{0,-20} : {1}' -f 'ripgrep', (Get-ToolVersion 'rg'))

    if ($status.Running) {
        Write-Host ('{0,-20} : {1}' -f 'Version', $status.Response.version)
        Write-Host ('{0,-20} : {1}' -f 'Database', $status.Response.database)
        Write-Host ('{0,-20} : {1}' -f 'Uptime seconds', [math]::Round($status.Response.uptime, 0))
        if ($status.Response.activeProject) {
            Write-Host ('{0,-20} : {1}' -f 'Active project', $status.Response.activeProject.root)
        }
    }
    else {
        Write-ColorOutput "Health error: $($status.Error)" DarkYellow
    }
}

function Register-Project {
    $resolved = (Resolve-Path -LiteralPath $ProjectPath).Path
    $response = Invoke-WorkspaceApi -Method POST -Route '/projects/register-current' -Body @{ root = $resolved }
    Write-ColorOutput "Registered project: $($response.project.name)" Green
    $response.project | ConvertTo-Json -Depth 10
}

function Search-Code {
    if (-not $Value) {
        throw 'Provide a search pattern: .\openbrowser.ps1 search "pattern"'
    }
    $response = Invoke-WorkspaceApi -Method POST -Route '/project/search' -Body @{
        pattern = $Value
        path = '.'
        regex = $false
    }
    $response.results | ConvertTo-Json -Depth 20
}

function Analyze-Project {
    $response = Invoke-WorkspaceApi -Method POST -Route '/project/analyze' -Body @{}
    $response | ConvertTo-Json -Depth 30
}

function Index-Project {
    $response = Invoke-WorkspaceApi -Method POST -Route '/project/index' -Body @{}
    Write-ColorOutput "Indexed $($response.indexed) files; skipped $($response.skipped)." Green
    $response | ConvertTo-Json -Depth 10
}

function Install-PreCommitHook {
    $gitDirectory = Join-Path $ProjectPath '.git'
    if (-not (Test-Path -LiteralPath $gitDirectory -PathType Container)) {
        throw "$ProjectPath is not a Git working tree with a .git directory."
    }

    $source = Join-Path $WorkspaceRoot 'hooks/pre-commit'
    $destinationDirectory = Join-Path $gitDirectory 'hooks'
    $destination = Join-Path $destinationDirectory 'pre-commit'
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null

    if (Test-Path -LiteralPath $destination) {
        $backup = "$destination.backup.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
        Copy-Item -LiteralPath $destination -Destination $backup
        Write-ColorOutput "Existing hook backed up to $backup" Yellow
    }

    Copy-Item -LiteralPath $source -Destination $destination -Force
    Write-ColorOutput "Installed OpenBrowser pre-commit hook at $destination" Green
}

Import-WorkspaceEnvironment

switch ($Command) {
    'start' { Start-Bridge }
    'stop' { Stop-Bridge }
    'restart' { Stop-Bridge; Start-Bridge }
    'status' { Show-Dashboard }
    'register' { Register-Project }
    'search' { Search-Code }
    'analyze' { Analyze-Project }
    'index' { Index-Project }
    'install-hook' { Install-PreCommitHook }
}
