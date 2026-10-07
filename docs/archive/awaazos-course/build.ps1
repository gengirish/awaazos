# Assembles the course from module files into a single index.html.
# Run from inside the course directory: .\build.ps1
$ErrorActionPreference = "Stop"

if (-not (Test-Path "_base.html")) {
  Write-Error "Run this from inside the course directory (the one with _base.html)."
  exit 1
}

$moduleFiles = Get-ChildItem -Path "modules\*.html" -ErrorAction SilentlyContinue | Sort-Object Name
if ($moduleFiles.Count -eq 0) {
  Write-Error "No module files found in modules\. Did Claude finish writing them?"
  exit 1
}

$base    = Get-Content "_base.html" -Raw -Encoding UTF8
$footer  = Get-Content "_footer.html" -Raw -Encoding UTF8
$modules = $moduleFiles | ForEach-Object { Get-Content $_.FullName -Raw -Encoding UTF8 }

($base + ($modules -join "`n") + $footer) | Set-Content "index.html" -Encoding UTF8 -NoNewline
Write-Host "Built index.html -- open it in your browser."
