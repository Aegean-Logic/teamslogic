# SPDX-FileCopyrightText: 2026 Aegean Logic
# SPDX-License-Identifier: AGPL-3.0-or-later
<#
.SYNOPSIS
  Build, sign and package TeamsLogic for Windows as an MSI.

.DESCRIPTION
  Produces, in $env:DIST (default: dist/release):
    teamslogic-<version>-windows-<arch>.msi   per-machine installer (WiX v5)

  The same layout and options as GridLogic's, WordLogic's and SlideLogic's MSIs, so Aegean Office
  Setup (installer/windows/build.ps1 in the head repo) chains it with theirs. Upstream's
  electron-wix-msi maker (npm run package:windows:x64:msi) still works but needs WiX v3; this
  uses WiX v5 like the rest of Aegean Office.

  Steps: npm ci (unless node_modules is there), electron-forge package (npm run build:windows:<arch>),
  sign TeamsLogic.exe, wix build, sign the MSI. Signing is delegated to sign.ps1 (skipped with a
  warning when no signing secrets are set).

  Needs: Node 24 and npm 11, and WiX v5 with its firewall extension:
    dotnet tool install --global wix --version 5.0.2
    wix extension add -g WixToolset.Firewall.wixext/5.0.2

.EXAMPLE
  pwsh packaging/windows/package.ps1
  pwsh packaging/windows/package.ps1 -SkipBuild      # reuse out/TeamsLogic-win32-x64
#>
param(
  [ValidateSet('x64', 'arm64')] [string] $Arch = 'x64',
  [switch] $SkipBuild
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Invoke-Native([string] $What, [scriptblock] $Block) {
  Write-Output "==> $What"
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

# The version lives in package.json (upstream's). MSI ProductVersion is numeric (major.minor.build).
$Version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
$MsiVersion = ($Version -split '-')[0]
$Dist = if ($env:DIST) { $env:DIST } else { Join-Path $Root 'dist\release' }
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
Write-Output "TeamsLogic $Version for Windows $Arch"

Push-Location $Root
try {
  if (-not $SkipBuild) {
    if (-not (Test-Path (Join-Path $Root 'node_modules'))) { Invoke-Native 'npm ci' { npm ci } }
    Invoke-Native "electron-forge package ($Arch)" { npm run "build:windows:$Arch" }
  }
} finally { Pop-Location }

$AppDir = Join-Path $Root "out\TeamsLogic-win32-$Arch"
$Exe = Join-Path $AppDir 'TeamsLogic.exe'
if (-not (Test-Path $Exe)) { throw "no packaged app at $AppDir (run without -SkipBuild)" }

# Check the PE header before packaging: Machine (COFF header) must match -Arch, and the app must be
# a Windows GUI program (subsystem 2), so no console window opens with it.
$bytes = [System.IO.File]::ReadAllBytes($Exe)
$pe = [BitConverter]::ToInt32($bytes, 0x3C)
$machine = [BitConverter]::ToUInt16($bytes, $pe + 4)
$subsystem = [BitConverter]::ToUInt16($bytes, $pe + 0x5C)
$expected = switch ($Arch) { 'x64' { 0x8664 } 'arm64' { 0xAA64 } }
if ($machine -ne $expected) { throw "TeamsLogic.exe is for machine 0x$('{0:X}' -f $machine), expected 0x$('{0:X}' -f $expected) ($Arch)" }
if ($subsystem -ne 2) { throw "TeamsLogic.exe has PE subsystem $subsystem, expected 2" }
Write-Output "ok TeamsLogic.exe: $Arch, PE subsystem $subsystem"

& (Join-Path $PSScriptRoot 'sign.ps1') $Exe

$Msi = Join-Path $Dist "teamslogic-$Version-windows-$Arch.msi"
Invoke-Native 'wix build' {
  wix build (Join-Path $PSScriptRoot 'teamslogic.wxs') -arch $Arch -ext WixToolset.Firewall.wixext `
    -d "Version=$MsiVersion" -d "AppDir=$AppDir" -d "IconPath=$(Join-Path $Root 'img\icons\icon.ico')" `
    -o $Msi
}
# wix writes its debug symbols (.wixpdb) next to the MSI; keep them out of the release assets.
Remove-Item -Force -ErrorAction SilentlyContinue ([IO.Path]::ChangeExtension($Msi, '.wixpdb'))
& (Join-Path $PSScriptRoot 'sign.ps1') $Msi

Get-Item $Msi | Format-Table Name, Length
