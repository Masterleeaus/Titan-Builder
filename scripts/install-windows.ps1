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
    $tokenBytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
    $token = [Convert]::ToBase64String($tokenBytes)
    @(
        'PORT=5000'
        "BRIDGE_TOKEN=$token"
        'PROMPT_INJECTION_CHAR_LIMIT=40000'
        'OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0'
    ) | Set-Content -Encoding UTF8 $configPath
    Write-Host "Created $configPath with a random bridge token."
} else {
    Write-Host "Preserved existing $configPath"
}

Write-Step 'Registering the global CLI command'
& pnpm setup
& pnpm link --global

$extensionPath = Join-Path (Get-Location) 'browser-extension'
Write-Host "`nInstallation completed." -ForegroundColor Green
Write-Host "1. Open chrome://extensions"
Write-Host "2. Enable Developer mode"
Write-Host "3. Load unpacked: $extensionPath"
Write-Host "4. Open a new PowerShell window and run: openbrowser --help"
Write-Host "5. Copy the BRIDGE_TOKEN from $configPath into the extension settings"
