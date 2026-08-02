[CmdletBinding()]
param(
    [switch]$EnableBackgroundService
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$CompanionRoot = Join-Path $RepositoryRoot 'browser-extension'

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name, [string]$Remediation = '') {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        if ($Remediation) {
            throw "Required command '$Name' was not found in PATH. $Remediation"
        }
        throw "Required command '$Name' was not found in PATH."
    }
}

function Assert-LastCommand([string]$Description) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Resolve-Python {
    $PythonCandidates = @('python', 'python3', 'py.exe')
    $MinMajor = 3
    $MinMinor = 12

    foreach ($candidate in $PythonCandidates) {
        $pythonPath = $null
        try {
            if ($candidate -eq 'py.exe') {
                # Windows py launcher: try py -3 to get Python 3
                $pythonPath = Get-Command 'py' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
                if ($pythonPath) {
                    $versionOutput = (& py -3 --version 2>&1) | Out-String
                }
            } else {
                $pythonPath = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
                if ($pythonPath) {
                    $versionOutput = (& $candidate --version 2>&1) | Out-String
                }
            }

            if (-not $pythonPath -or -not $versionOutput) {
                continue
            }

            # Parse version output: "Python 3.12.1" or "Python 3.11.0"
            $versionMatch = [regex]::Match($versionOutput, 'Python\s+(\d+)\.(\d+)')
            if (-not $versionMatch.Success) {
                continue
            }

            $major = [int]$versionMatch.Groups[1].Value
            $minor = [int]$versionMatch.Groups[2].Value

            if ($major -gt $MinMajor -or ($major -eq $MinMajor -and $minor -ge $MinMinor)) {
                Write-Host "Found Python $major.$minor at $pythonPath"
                return $pythonPath
            }
        } catch {
            # Silently continue to next candidate
        }
    }

    # No suitable Python found
    throw @"
Python 3.12 or later was not found in PATH.

Please install Python 3.12 or later from https://python.org/downloads/ and ensure:
1. You select "Add Python to PATH" during installation
2. You install Python 3.12 or a newer version
3. After installation, restart this script

You can verify your Python installation by running:
  python --version
  python3 --version
  py -3 --version
"@
}

Write-Step 'Checking Node.js'
Require-Command 'node'
$nodeVersion = (& node --version).Trim().TrimStart('v')
Assert-LastCommand 'Reading the Node.js version'
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
    throw "OpenBrowser with pnpm 11 requires Node.js 22 or later. Found v$nodeVersion."
}
Write-Host "Node.js v$nodeVersion"

Write-Step 'Resolving and validating Python 3.12+ for the browser-extension companion'
$pythonExecutable = Resolve-Python
Write-Host "Using Python: $pythonExecutable"

Write-Step 'Activating pnpm 11.2.2 through Corepack'
Require-Command 'corepack'
& corepack enable
Assert-LastCommand 'Enabling Corepack'
& corepack prepare pnpm@11.2.2 --activate
Assert-LastCommand 'Activating pnpm 11.2.2'
Require-Command 'pnpm'
$pnpmVersion = (& pnpm --version).Trim()
Assert-LastCommand 'Reading the pnpm version'
Write-Host "pnpm $pnpmVersion"

Write-Step 'Installing and verifying the root OpenBrowser runtime'
Push-Location $RepositoryRoot
try {
    & pnpm install --frozen-lockfile
    Assert-LastCommand 'Installing root dependencies'
    & pnpm run verify
    Assert-LastCommand 'Verifying the root runtime'
} finally {
    Pop-Location
}

Write-Step 'Installing and verifying the browser-extension companion'
if (-not (Test-Path (Join-Path $CompanionRoot 'package.json'))) {
    throw "The browser-extension companion was not found at $CompanionRoot. Use a complete Titan Builder checkout."
}
Push-Location $CompanionRoot
try {
    & pnpm install --frozen-lockfile
    Assert-LastCommand 'Installing browser-extension companion dependencies'
    & pnpm run verify
    Assert-LastCommand 'Verifying the browser-extension companion'
} finally {
    Pop-Location
}

Write-Step 'Creating secure user configuration when missing'
$configDirectory = Join-Path $HOME '.openbrowser'
$configPath = Join-Path $configDirectory '.env'
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
if (-not (Test-Path $configPath)) {
    @(
        'PORT=5000'
        'PROMPT_INJECTION_CHAR_LIMIT=40000'
        'BRIDGE_EXTENSION_ORIGINS='
        'OPENBROWSER_INSECURE_DEV=0'
        'OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0'
    ) | Set-Content -Encoding UTF8 $configPath
}

$configText = Get-Content -Raw $configPath
$generatedControlToken = $false
$generatedBrowserToken = $false
if ($configText -notmatch '(?m)^BRIDGE_TOKEN=.{32,}$') {
    $tokenBytes = New-Object byte[] 48
    $controlRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $controlRng.GetBytes($tokenBytes)
    } finally {
        $controlRng.Dispose()
    }
    $controlToken = [Convert]::ToBase64String($tokenBytes)
    Add-Content -Encoding UTF8 $configPath "BRIDGE_TOKEN=$controlToken"
    $generatedControlToken = $true
}
if ($configText -notmatch '(?m)^BRIDGE_BROWSER_TOKEN=.{32,}$') {
    $browserTokenBytes = New-Object byte[] 48
    $browserRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $browserRng.GetBytes($browserTokenBytes)
    } finally {
        $browserRng.Dispose()
    }
    $browserToken = [Convert]::ToBase64String($browserTokenBytes)
    Add-Content -Encoding UTF8 $configPath "BRIDGE_BROWSER_TOKEN=$browserToken"
    $generatedBrowserToken = $true
}
if ($configText -notmatch '(?m)^BRIDGE_EXTENSION_ORIGINS=') {
    Add-Content -Encoding UTF8 $configPath 'BRIDGE_EXTENSION_ORIGINS='
}
if ($configText -notmatch '(?m)^OPENBROWSER_INSECURE_DEV=') {
    Add-Content -Encoding UTF8 $configPath 'OPENBROWSER_INSECURE_DEV=0'
}
if ($configText -notmatch '(?m)^OPENBROWSER_ALLOW_UNSAFE_COMMANDS=') {
    Add-Content -Encoding UTF8 $configPath 'OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0'
}

if ($generatedControlToken -or $generatedBrowserToken) {
    Write-Host "Created missing secure bridge credentials in $configPath"
} else {
    Write-Host "Preserved existing secure credentials in $configPath"
}

Write-Step 'Registering the global CLI command'
Push-Location $RepositoryRoot
try {
    & pnpm setup
    Assert-LastCommand 'Configuring the pnpm global command directory'
    & pnpm link --global
    Assert-LastCommand 'Linking the OpenBrowser CLI globally'
} finally {
    Pop-Location
}

$pnpmGlobalBin = (& pnpm bin --global).Trim()
Assert-LastCommand 'Resolving the pnpm global command directory'
if ($pnpmGlobalBin -and (($env:Path -split ';') -notcontains $pnpmGlobalBin)) {
    $env:Path = "$pnpmGlobalBin;$env:Path"
}
Require-Command 'openbrowser' 'Open a new PowerShell window if pnpm updated PATH, then run openbrowser doctor.'

Write-Step 'Running the installation doctor'
& openbrowser doctor
Assert-LastCommand 'OpenBrowser installation diagnostics'

if ($EnableBackgroundService) {
    Write-Step 'Enabling the opt-in background bridge service'
    & openbrowser service start
    Assert-LastCommand 'Starting the OpenBrowser background service'

    $taskName = 'OpenBrowser Local Agent'
    $openBrowserPath = (Get-Command openbrowser -ErrorAction Stop).Source
    $escapedOpenBrowserPath = $openBrowserPath.Replace("'", "''")
    $taskArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"& '$escapedOpenBrowserPath' service start`""
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArguments
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts the local OpenBrowser bridge for the current user.' -Force | Out-Null
    Write-Host "Registered current-user Scheduled Task: $taskName"
} else {
    Write-Host 'Background startup was not enabled. Run this installer with -EnableBackgroundService to opt in.'
}

Write-Host "`nInstallation completed." -ForegroundColor Green
Write-Host '1. Open chrome://extensions'
Write-Host '2. Enable Developer mode'
Write-Host "3. Load unpacked: $CompanionRoot"
Write-Host '4. Open a new PowerShell window and run: openbrowser doctor'
Write-Host "5. Copy BRIDGE_BROWSER_TOKEN from $configPath into the extension settings"
Write-Host '6. Start the bridge with: openbrowser service start'
Write-Host '7. Follow docs/browser-first-smoke-checklist.md for Ask and Agent validation'
