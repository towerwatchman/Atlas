@echo off
setlocal

set "OUTPUT=project_backup.zip"
if exist "%OUTPUT%" del "%OUTPUT%"

powershell -NoProfile -Command ^
  "$exclude = @('dist','node_modules', 'data');" ^
  "$root = Get-Location;" ^
  "$files = Get-ChildItem -Path $root -Recurse -File | Where-Object {" ^
  "  $rel = $_.FullName.Substring($root.Path.Length).TrimStart('\');" ^
  "  $parts = $rel -split '\\';" ^
  "  -not ($parts | Where-Object { $exclude -contains $_ })" ^
  "};" ^
  "if (Test-Path '%OUTPUT%') { Remove-Item '%OUTPUT%' }" ^
  "foreach ($f in $files) {" ^
  "  $rel = $f.FullName.Substring($root.Path.Length).TrimStart('\');" ^
  "  Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null;" ^
  "}" ^
  "$zip = [System.IO.Compression.ZipFile]::Open((Join-Path $root '%OUTPUT%'), 'Create');" ^
  "foreach ($f in $files) {" ^
  "  $rel = $f.FullName.Substring($root.Path.Length).TrimStart('\');" ^
  "  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel) | Out-Null;" ^
  "}" ^
  "$zip.Dispose();" ^
  "Write-Host 'Created %OUTPUT% with' $files.Count 'files.'"

echo Done.
pause