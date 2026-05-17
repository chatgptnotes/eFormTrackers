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
        [Parameter(Mandatory)][string]$BackendPath
    )
    Write-StepHeader -Number 12 -Total 25 -Title 'Installing backend npm dependencies'
    if (-not (Test-Path (Join-Path $BackendPath 'package.json'))) {
        throw "package.json not found in $BackendPath"
    }
    $expressDir = Join-Path $BackendPath 'node_modules\express'
    $lock = Join-Path $BackendPath 'package-lock.json'
    if ((Test-Path $expressDir) -and (Test-Path $lock)) {
        Write-Log -Level OK -Message 'node_modules already present; skipping npm install.'
        return
    }
    Push-Location $BackendPath
    try {
        Write-Log -Level INFO -Message 'Running: npm install --production --no-audit --no-fund'
        & npm install --production --no-audit --no-fund 2>&1 | ForEach-Object { Write-Log -Level DEBUG -Message $_ }
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    Write-Log -Level OK -Message 'Backend dependencies installed.'
}
