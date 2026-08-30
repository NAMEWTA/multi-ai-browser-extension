[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "MultiAIWorkspace"),
  [switch]$IncludePrerelease,
  [switch]$SkipOpen
)

$ErrorActionPreference = "Stop"
$repository = "NAMEWTA/multi-ai-browser-extension"
$headers = @{
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "multi-ai-workspace-installer"
}
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("multi-ai-workspace-" + [guid]::NewGuid())

try {
  if ($IncludePrerelease) {
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases?per_page=20" -Headers $headers
    $release = $releases |
      Where-Object { $_.draft -eq $false } |
      Sort-Object { [datetime]$_.published_at } -Descending |
      Select-Object -First 1
  } else {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers $headers
  }
  if (-not $release) {
    throw "No matching GitHub Release was found."
  }
  $version = $release.tag_name -replace '^v', ''
  $archiveName = "multi-ai-workspace-$version-chrome.zip"
  $checksumName = "multi-ai-workspace-$version-SHA256SUMS.txt"
  $archiveAsset = $release.assets | Where-Object { $_.name -eq $archiveName } | Select-Object -First 1
  $checksumAsset = $release.assets | Where-Object { $_.name -eq $checksumName } | Select-Object -First 1

  if (-not $archiveAsset -or -not $checksumAsset) {
    throw "Release $($release.tag_name) does not contain the expected Chrome package and checksum."
  }

  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $archivePath = Join-Path $tempRoot $archiveName
  $checksumPath = Join-Path $tempRoot $checksumName
  Invoke-WebRequest -Uri $archiveAsset.browser_download_url -Headers $headers -OutFile $archivePath
  Invoke-WebRequest -Uri $checksumAsset.browser_download_url -Headers $headers -OutFile $checksumPath

  $checksumLine = Get-Content -LiteralPath $checksumPath |
    Where-Object { $_ -match ([regex]::Escape($archiveName) + '$') } |
    Select-Object -First 1
  if (-not $checksumLine) {
    throw "Checksum entry for $archiveName was not found."
  }

  $expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash
  if ($actualHash -ne $expectedHash) {
    throw "SHA-256 verification failed for $archiveName."
  }

  $installPath = Join-Path $InstallRoot $version
  New-Item -ItemType Directory -Force -Path $installPath | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $installPath -Force

  try {
    Set-Clipboard -Value $installPath
  } catch {
    Write-Verbose "Could not copy the installation path to the clipboard."
  }

  $chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )
  $chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($chrome -and -not $SkipOpen) {
    Start-Process -FilePath $chrome -ArgumentList "chrome://extensions"
  }

  Write-Host "Multi AI Workspace $version is ready at:" -ForegroundColor Green
  Write-Host $installPath
  Write-Host "The path has been copied to the clipboard. In Chrome, enable Developer mode, choose Load unpacked, and select this folder."
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
