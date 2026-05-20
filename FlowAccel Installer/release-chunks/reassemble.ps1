# reassemble.ps1 - rebuild FlowAccel-Setup-1.0.4.exe from the .part chunks.
# Run from the release-chunks folder:  .\reassemble.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$zip = 'FlowAccel-Setup-1.0.4.zip'
$exe = 'FlowAccel-Setup-1.0.4.exe'
$exeHash = '0CAC23693A42E1DC269C2BF4FC72D899DB572AB37C93A97735393C28E780BB40'

$parts = Get-ChildItem -Filter 'FlowAccel-Setup-1.0.4.zip.*.part' | Sort-Object Name
if ($parts.Count -eq 0) { throw 'No .part chunks found in this folder.' }
Write-Host "Joining $($parts.Count) chunks into $zip ..."

$out = [System.IO.File]::Create((Join-Path $here $zip))
try {
    foreach ($p in $parts) {
        $bytes = [System.IO.File]::ReadAllBytes($p.FullName)
        $out.Write($bytes, 0, $bytes.Length)
    }
} finally { $out.Close() }

Write-Host "Extracting $exe ..."
Expand-Archive -Path $zip -DestinationPath $here -Force

$got = (Get-FileHash $exe -Algorithm SHA256).Hash
if ($got -eq $exeHash) {
    Write-Host "OK - $exe rebuilt and checksum verified." -ForegroundColor Green
    Remove-Item $zip -Force
} else {
    Write-Host "CHECKSUM MISMATCH - do not run the .exe." -ForegroundColor Red
    Write-Host "  expected: $exeHash"
    Write-Host "  got:      $got"
    exit 1
}
