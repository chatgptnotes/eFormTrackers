# postgres.ps1 - Steps 8-9: PostgreSQL install + DB bootstrap.

function Test-PostgresInstalled {
    # Match any installed PostgreSQL service (v14/15/16/17), not just v15, so an
    # existing PostgreSQL is reused instead of conflicting on port 5432.
    $svc = Get-Service -Name 'postgresql-x64-*' -ErrorAction SilentlyContinue
    return [bool]$svc
}

function Get-PsqlPath {
    $candidates = @(
        'C:\Program Files\PostgreSQL\17\bin\psql.exe',
        'C:\Program Files\PostgreSQL\16\bin\psql.exe',
        'C:\Program Files\PostgreSQL\15\bin\psql.exe',
        'C:\Program Files\PostgreSQL\14\bin\psql.exe'
    )
    foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
    return $null
}

function Install-PostgreSQL {
    param(
        [Parameter(Mandatory)][string]$InstallerExe,
        [Parameter(Mandatory)][string]$SuperPassword,
        [string]$DataDir = 'C:\Program Files\PostgreSQL\15\data',
        [int]$Port = 5432
    )
    Write-StepHeader -Number 8 -Total 25 -Title 'Installing PostgreSQL 15 (this takes 3-5 minutes)'

    if (Test-PostgresInstalled) {
        Write-Log -Level OK -Message 'PostgreSQL service already installed; skipping.'
        return
    }
    if (-not (Test-Path $InstallerExe)) { throw "PostgreSQL installer not found: $InstallerExe" }

    $args = @(
        '--mode','unattended',
        '--unattendedmodeui','none',
        '--superpassword', $SuperPassword,
        '--servicename','postgresql-x64-15',
        '--serviceaccount','postgres',
        '--servicepassword', $SuperPassword,
        '--serverport', "$Port",
        '--datadir', "`"$DataDir`""
    )
    Write-Log -Level INFO -Message 'Running PostgreSQL unattended installer...'
    $p = Start-Process -FilePath $InstallerExe -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "PostgreSQL install failed with exit code $($p.ExitCode)." }

    # Wait for service to come online
    $svc = Get-Service postgresql-x64-15 -ErrorAction Stop
    if ($svc.Status -ne 'Running') { Start-Service postgresql-x64-15 }
    $svc.WaitForStatus('Running','00:01:00')
    Write-Log -Level OK -Message 'PostgreSQL 15 installed and running.'
}

function Initialize-AppDatabase {
    param(
        [Parameter(Mandatory)][string]$SuperPassword,
        [Parameter(Mandatory)][string]$AppDbPassword,
        [string]$DbName = 'jotflow',
        [string]$DbUser = 'jotflow',
        [int]$Port = 5432
    )
    Write-StepHeader -Number 9 -Total 25 -Title "Creating application database '$DbName'"
    $psql = Get-PsqlPath
    if (-not $psql) { throw 'psql.exe not found; PostgreSQL install incomplete.' }

    $env:PGPASSWORD = $SuperPassword
    try {
        $existing = & $psql -h 127.0.0.1 -p $Port -U postgres -tA -c "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null
        if ($existing -eq '1') {
            Write-Log -Level OK -Message "Database '$DbName' already exists; skipping create."
        } else {
            $sql = @"
CREATE USER $DbUser WITH PASSWORD '$AppDbPassword';
CREATE DATABASE $DbName OWNER $DbUser;
GRANT ALL PRIVILEGES ON DATABASE $DbName TO $DbUser;
"@
            $tmp = New-TemporaryFile
            Set-Content -Path $tmp -Value $sql -Encoding ASCII
            & $psql -h 127.0.0.1 -p $Port -U postgres -f $tmp.FullName 2>&1 |
                ForEach-Object { Write-Log -Level DEBUG -Message $_ }
            if ($LASTEXITCODE -ne 0) { throw "DB bootstrap failed (exit $LASTEXITCODE)" }
            Remove-Item $tmp -Force
            Write-Log -Level OK -Message "Database '$DbName' and user '$DbUser' created."
        }
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
}

function Invoke-DbMigration {
    param(
        [Parameter(Mandatory)][string]$BackendPath
    )
    Write-StepHeader -Number 13 -Total 25 -Title 'Applying database schema'
    $migrate = Join-Path $BackendPath 'db\migrate.js'
    if (-not (Test-Path $migrate)) { throw "migrate.js not found at $migrate" }
    Push-Location $BackendPath
    try {
        & node 'db\migrate.js' 2>&1 | ForEach-Object { Write-Log -Level DEBUG -Message $_ }
        if ($LASTEXITCODE -ne 0) { throw "DB migration failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    Write-Log -Level OK -Message 'Database schema applied.'
}
