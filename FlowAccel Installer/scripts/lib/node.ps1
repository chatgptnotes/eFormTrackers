# node.ps1 - Step 7: Install Node.js 18 LTS (silent).

function Test-NodeInstalled {
    param([int]$MinMajor = 18)
    try {
        $v = & node --version 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $v) { return $false }
        $v = $v.TrimStart('v')
        $maj = [int]($v.Split('.')[0])
        return ($maj -ge $MinMajor)
    } catch { return $false }
}

function Install-NodeJS {
    param([Parameter(Mandatory)][string]$MsiPath)
    Write-StepHeader -Number 7 -Total 25 -Title 'Installing Node.js 18 LTS'

    if (Test-NodeInstalled -MinMajor 18) {
        $v = & node --version 2>$null
        Write-Log -Level OK -Message "Node.js $v already installed; skipping."
        return
    }

    if (-not (Test-Path $MsiPath)) { throw "Node.js MSI not found: $MsiPath" }
    $log = Join-Path $env:TEMP "flowaccel-node-$([guid]::NewGuid()).log"
    Write-Log -Level INFO -Message 'Running node MSI silently (this takes 30-60 seconds)...'
    $args = @("/i","`"$MsiPath`"","/qn","/norestart","ADDLOCAL=ALL","/l*v","`"$log`"")
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
        throw "Node.js install failed with exit code $($p.ExitCode). See $log"
    }

    # Refresh PATH for current process so subsequent steps can find node/npm.
    $machine = [System.Environment]::GetEnvironmentVariable('Path','Machine')
    $user    = [System.Environment]::GetEnvironmentVariable('Path','User')
    $env:Path = "$machine;$user"

    if (-not (Test-NodeInstalled -MinMajor 18)) {
        throw 'Node.js install completed but `node --version` still fails. Check PATH.'
    }
    Write-Log -Level OK -Message "Node.js $((& node --version)) installed."
}

function Invoke-NpmInstall {
    param(
        [Parameter(Mandatory)][string]$BackendPath,
        [int]$MaxAttempts = 3
    )
    Write-StepHeader -Number 12 -Total 25 -Title 'Installing backend npm dependencies'
    if (-not (Test-Path (Join-Path $BackendPath 'package.json'))) {
        throw "package.json not found in $BackendPath"
    }

    # OFFLINE-FIRST (the single most important reliability fix).
    # If a production node_modules was bundled with the installer (or left by a
    # previous run), use it as-is and skip the network entirely. This is what
    # stops the installer from dying at "Step 12 of 25" on servers that have no
    # internet, sit behind a proxy, or have aggressive antivirus scanning the
    # ~30,000 files npm would otherwise download. We check the three packages
    # the installer itself depends on downstream: express (server), pg
    # (migration), bcryptjs (admin seed).
    $expressDir = Join-Path $BackendPath 'node_modules\express'
    $pgDir      = Join-Path $BackendPath 'node_modules\pg'
    $bcryptjsDir = Join-Path $BackendPath 'node_modules\bcryptjs'
    if ((Test-Path $expressDir) -and (Test-Path $pgDir) -and (Test-Path $bcryptjsDir)) {
        Write-Log -Level OK -Message 'Bundled node_modules present (express, pg, bcryptjs); skipping npm install (offline-safe).'
        return
    }
    Write-Log -Level WARN -Message 'node_modules not bundled - falling back to ONLINE npm install (needs internet to registry.npmjs.org).'

    Push-Location $BackendPath
    try {
        $ok = $false
        for ($attempt = 1; ($attempt -le $MaxAttempts) -and (-not $ok); $attempt++) {
            Write-Log -Level INFO -Message "npm install attempt $attempt of $MaxAttempts (npm install --production --no-audit --no-fund)..."
            & npm install --production --no-audit --no-fund --loglevel=error 2>&1 |
                ForEach-Object { Write-Log -Level DEBUG -Message $_ }
            if (($LASTEXITCODE -eq 0) -and (Test-Path $expressDir)) {
                $ok = $true
            } else {
                Write-Log -Level WARN -Message "npm install attempt $attempt failed (exit $LASTEXITCODE). Retrying in 5s..."
                Start-Sleep -Seconds 5
            }
        }
        if (-not $ok) {
            throw "npm install failed after $MaxAttempts attempts. For an offline-safe build, bundle backend\node_modules into the installer payload (see build-installer instructions)."
        }
    } finally {
        Pop-Location
    }
    Write-Log -Level OK -Message 'Backend dependencies installed (online).'
}
