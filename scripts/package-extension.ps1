$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$versionName = if ($manifest.version_name) { [string]$manifest.version_name } else { "GuJumpgate$($manifest.version)" }
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$distDir = Join-Path $root 'dist'
$zipPath = Join-Path $distDir "$versionName-$timestamp-extension.zip"

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Get-ChildItem -LiteralPath $distDir -Filter "$versionName-*-extension.zip" -File |
  Remove-Item -Force

$excludedDirs = @(
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'docs',
  'node_modules',
  'tests',
  '.runtime',
  '.omx',
  '.worktrees',
  'release-artifacts'
)
$excludedFiles = @(
  'config.json',
  '.npm-test.log'
)

function Test-IsExcludedPath {
  param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)

  $relative = $File.FullName.Substring($root.Path.Length).TrimStart('\', '/')
  $parts = $relative -split '[\\/]'
  foreach ($dir in $excludedDirs) {
    if ($parts -contains $dir) {
      return $true
    }
  }
  if ($excludedFiles -contains $File.Name) {
    return $true
  }
  if ($File.Extension -eq '.pyc') {
    return $true
  }
  return $false
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { -not (Test-IsExcludedPath $_) }
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Path.Length).TrimStart('\', '/').Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $file.FullName,
      $relative,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
}

$requiredEntries = @(
  'manifest.json',
  'background.js',
  'sidepanel/sidepanel.html',
  'sidepanel/sidepanel.js',
  'sidepanel/hosted-sms-pool-manager.js',
  'shared/accounts/managed-alias-utils.js',
  'shared/mail/hotmail-utils.js',
  'shared/mail/mail-provider-utils.js',
  'shared/payment/paypal-utils.js',
  'shared/payment/gopay-utils.js'
)
$forbiddenPrefixes = @(
  '.git/',
  '.idea/',
  '.vscode/',
  'dist/',
  'docs/',
  'node_modules/',
  'tests/'
)

$checkArchive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entryNames = $checkArchive.Entries | ForEach-Object { $_.FullName }
  foreach ($entry in $requiredEntries) {
    if ($entryNames -notcontains $entry) {
      throw "Package validation failed: missing $entry"
    }
  }
  foreach ($entryName in $entryNames) {
    foreach ($prefix in $forbiddenPrefixes) {
      if ($entryName.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Package validation failed: forbidden entry $entryName"
      }
    }
  }
  $sizeMb = [Math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
  Write-Host "Packaged $($entryNames.Count) files -> $zipPath ($sizeMb MB)"
} finally {
  $checkArchive.Dispose()
}
