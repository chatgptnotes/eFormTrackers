$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-ChildItem -Path $here -File |
    Where-Object { $_.Name -notin 'SHA256SUMS.txt','README.txt','fetch-payloads.ps1','gen-sums.ps1' } |
    ForEach-Object { '{0}  {1}' -f ((Get-FileHash $_.FullName -Algorithm SHA256).Hash), $_.Name } |
    Set-Content -Path (Join-Path $here 'SHA256SUMS.txt') -Encoding ASCII
Get-Content (Join-Path $here 'SHA256SUMS.txt')
