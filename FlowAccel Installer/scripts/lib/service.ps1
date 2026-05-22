# service.ps1 - Steps 19-20, 22: NSSM + Windows Service for backend.

function Install-NSSM {
    param(
        [Parameter(Mandatory)][string]$ZipPath,
        [Parameter(Mandatory)][string]$DestDir
    )
    Write-StepHeader -Number 19 -Total 25 -Title 'Installing NSSM (service wrapper)'
    $nssmExe = Join-Path $DestDir 'nssm.exe'
    if (Test-Path $nssmExe) {
        Write-Log -Level OK -Message 'NSSM already extracted; skipping.'
        return $nssmExe
    }
    if (-not (Test-Path $ZipPath)) { throw "NSSM zip not found: $ZipPath" }
    if (-not (Test-Path $DestDir)) { New-Item -ItemType Directory -Force -Path $DestDir | Out-Null }

    $tmp = Join-Path $env:TEMP "nssm-extract-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $tmp -Force

    # nssm-2.24.zip contains  nssm-2.24/win64/nssm.exe
    $found = Get-ChildItem -Path $tmp -Recurse -Filter 'nssm.exe' |
        Where-Object { $_.FullName -match 'win64' } |
        Select-Object -First 1
    if (-not $found) { throw "nssm.exe not found in $ZipPath" }
    Copy-Item $found.FullName $nssmExe -Force
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log -Level OK -Message "NSSM installed at $nssmExe"
    return $nssmExe
}

function Register-BackendService {
    param(
        [Parameter(Mandatory)][string]$NssmExe,
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$NodeExe,
        [Parameter(Mandatory)][string]$ServerJs,
        [Parameter(Mandatory)][string]$AppDir,
        [Parameter(Mandatory)][string]$LogDir
    )
    Write-StepHeader -Number 20 -Total 25 -Title "Registering Windows service '$ServiceName'"
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Log -Level INFO -Message "Service '$ServiceName' already exists; reconfiguring."
        & $NssmExe stop $ServiceName 2>$null | Out-Null
    } else {
        & $NssmExe install $ServiceName $NodeExe $ServerJs | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "nssm install failed (exit $LASTEXITCODE)" }
    }

    & $NssmExe set $ServiceName AppDirectory   $AppDir              | Out-Null
    & $NssmExe set $ServiceName AppStdout      (Join-Path $LogDir 'service-stdout.log') | Out-Null
    & $NssmExe set $ServiceName AppStderr      (Join-Path $LogDir 'service-stderr.log') | Out-Null
    & $NssmExe set $ServiceName AppRotateFiles 1                    | Out-Null
    & $NssmExe set $ServiceName AppRotateBytes 10485760             | Out-Null
    & $NssmExe set $ServiceName Start          SERVICE_AUTO_START   | Out-Null
    & $NssmExe set $ServiceName ObjectName     LocalSystem          | Out-Null
    & $NssmExe set $ServiceName AppExit        Default Restart      | Out-Null
    & $NssmExe set $ServiceName AppRestartDelay 5000                | Out-Null
    & $NssmExe set $ServiceName DisplayName    'FlowAccel Backend (Node)' | Out-Null
    & $NssmExe set $ServiceName Description    'FlowAccel Node.js backend (loopback :3001, fronted by IIS).' | Out-Null

    Write-Log -Level OK -Message "Service '$ServiceName' registered and set to autostart."
}

function Start-BackendService {
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [int]$Port = 3001,
        [int]$TimeoutSec = 60
    )
    Write-StepHeader -Number 22 -Total 25 -Title "Starting backend service '$ServiceName'"

    # Pre-start probe: kill any orphan node listening on the port.
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        foreach ($conn in $listener) {
            try {
                $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
                if ($p -and $p.ProcessName -eq 'node') {
                    Write-Log -Level WARN -Message "Killing orphan node.exe (PID $($p.Id)) on port $Port."
                    Stop-Process -Id $p.Id -Force
                }
            } catch {}
        }
    }

    $svc = Get-Service -Name $ServiceName -ErrorAction Stop
    if ($svc.Status -ne 'Running') {
        Start-Service -Name $ServiceName -ErrorAction Stop
    }
    $svc.WaitForStatus('Running','00:00:30')

    # Health probe
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) {
                Write-Log -Level OK -Message 'Backend health endpoint returned 200.'
                return
            }
        } catch { Start-Sleep -Seconds 1 }
    }
    throw "Backend service '$ServiceName' did not become healthy within $TimeoutSec seconds."
}
