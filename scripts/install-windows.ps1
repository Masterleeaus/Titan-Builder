[CmdletBinding()]
param(
    [switch]$EnableBackgroundService
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

Write-Step 'Checking Node.js'
Require-Command 'node'
$nodeVersion = (& node --version).Trim().TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
    throw "OpenBrowser with pnpm 11 requires Node.js 22 or later. Found v$nodeVersion."
}
Write-Host "Node.js v$nodeVersion"

Write-Step 'Activating pnpm 11.2.2 through Corepack'
Require-Command 'corepack'
& corepack enable
& corepack prepare pnpm@11.2.2 --activate
Require-Command 'pnpm'
Write-Host "pnpm $(& pnpm --version)"

Write-Step 'Installing locked dependencies'
& pnpm install --frozen-lockfile

Write-Step 'Running type checks, tests, build, CLI smoke test, and extension checks'
& pnpm run verify

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
    [Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
    $controlToken = [Convert]::ToBase64String($tokenBytes)
    Add-Content -Encoding UTF8 $configPath "BRIDGE_TOKEN=$controlToken"
    $generatedControlToken = $true
}
if ($configText -notmatch '(?m)^BRIDGE_BROWSER_TOKEN=.{32,}$') {
    $browserTokenBytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($browserTokenBytes)
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

if ($generatedControlToken -or $generatedBrowserToken) {
    Write-Host "Created missing secure bridge credentials in $configPath"
} else {
    Write-Host "Preserved existing secure credentials in $configPath"
}

Write-Step 'Registering the global CLI command'
& pnpm setup
& pnpm link --global

if ($EnableBackgroundService) {
    Write-Step 'Enabling the opt-in background bridge service'
    & openbrowser service start
    $startupDirectory = [Environment]::GetFolderPath('Startup')
    $startupCommand = Join-Path $startupDirectory 'OpenBrowser-Service.cmd'
    @(
        '@echo off'
        'openbrowser service start >nul 2>&1'
    ) | Set-Content -Encoding ASCII $startupCommand
    Write-Host "Created user-login startup command: $startupCommand"
} else {
    Write-Host "Background startup was not enabled. Run this installer with -EnableBackgroundService to opt in."
}

$extensionPath = Join-Path (Get-Location) 'browser-extension'
Write-Host "`nInstallation completed." -ForegroundColor Green
Write-Host "1. Open chrome://extensions"
Write-Host "2. Enable Developer mode"
Write-Host "3. Load unpacked: $extensionPath"
Write-Host "4. Open a new PowerShell window and run: openbrowser --help"
Write-Host "5. Copy BRIDGE_BROWSER_TOKEN from $configPath into the extension settings"
Write-Host "6. Manage the background bridge with: openbrowser service status|start|stop|logs"
