# admin-seed.ps1 - Seed the first super_admin user so the client can log in
# immediately after install (no manual signup + DB promotion).
#
# Called from install.ps1 after Step 12 (npm install, so bcrypt is available)
# and Step 13 (migrate, so the users/profiles/org_members tables exist).
#
# Idempotent: ON CONFLICT DO UPDATE means re-running upgrades the row in place,
# safe for installer re-runs and for auto-remediate retries.

function Seed-AdminUser {
    param(
        [Parameter(Mandatory)][string]$BackendPath,
        [Parameter(Mandatory)][string]$AdminEmail,
        [Parameter(Mandatory)][string]$AdminPassword,
        [string]$AdminName    = 'Administrator',
        [string]$DbName       = 'jotflow',
        [string]$DbUser       = 'jotflow',
        [Parameter(Mandatory)][string]$AppDbPassword,
        [int]$Port            = 5432,
        [int]$StepNumber      = 13,
        [int]$StepTotal       = 25,
        [string]$OrgId        = '971589dd-afcb-4a12-8900-47626e4d59cc'
    )
    Write-StepHeader -Number $StepNumber -Total $StepTotal -Title "Seeding admin user '$AdminEmail'"

    $email = $AdminEmail.ToLower()

    # 1. bcrypt-hash via the just-installed backend dependency
    $node = (Get-Command node -ErrorAction Stop).Source
    Push-Location $BackendPath
    try {
        $hash = & $node -e "console.log(require('bcrypt').hashSync(process.argv[1], 12))" $AdminPassword 2>&1
    } finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0 -or -not $hash -or -not ($hash.ToString()).StartsWith('$2')) {
        throw "bcrypt hash failed: $hash"
    }
    $hash = $hash.ToString().Trim()

    # 2. Escape single quotes for SQL string literals
    $emailE = $email     -replace "'","''"
    $nameE  = $AdminName -replace "'","''"
    $hashE  = $hash      -replace "'","''"
    $orgE   = $OrgId     -replace "'","''"

    $sql = @"
INSERT INTO users (email, password_hash, full_name)
  VALUES ('$emailE', '$hashE', '$nameE')
  ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        full_name     = EXCLUDED.full_name;

INSERT INTO profiles (user_id, full_name, role, org_id, preferences)
  SELECT id, '$nameE', 'super_admin', '$orgE', '{"theme":"dark","language":"en"}'::jsonb
  FROM users WHERE email = '$emailE'
  ON CONFLICT (user_id) DO UPDATE
    SET role = 'super_admin';

INSERT INTO org_members (org_id, user_id, role)
  SELECT '$orgE', id, 'super_admin'
  FROM users WHERE email = '$emailE'
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = 'super_admin';
"@

    # 3. Run via psql as the app DB user (owns the schema)
    $psql = Get-PsqlPath
    if (-not $psql) { throw 'psql.exe not found; PostgreSQL install incomplete.' }

    $tmp = New-TemporaryFile
    Set-Content -Path $tmp -Value $sql -Encoding ASCII

    $env:PGPASSWORD = $AppDbPassword
    try {
        & $psql -h 127.0.0.1 -p $Port -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f $tmp.FullName 2>&1 |
            ForEach-Object { Write-Log -Level DEBUG -Message $_ }
        if ($LASTEXITCODE -ne 0) { throw "Admin seed SQL failed (exit $LASTEXITCODE)" }
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }

    Write-Log -Level OK -Message "Admin user '$email' seeded with role super_admin."
}

function Seed-FixedUsers {
    # Seed the two standard FlowAccel accounts on EVERY install so they can log
    # in immediately on any machine. Roles use the backend's VALID_ROLES values
    # (super_admin / viewer) - NOT the legacy 'superadmin' string. Idempotent:
    # ON CONFLICT DO UPDATE upgrades the rows in place on re-run.
    #
    # SECURITY NOTE: these passwords ship inside the installer in plain form.
    # Fine for an internal/known deployment; rotate them after install if this
    # installer is ever handed to an untrusted third party.
    param(
        [Parameter(Mandatory)][string]$BackendPath,
        [string]$DbName       = 'jotflow',
        [string]$DbUser       = 'jotflow',
        [Parameter(Mandatory)][string]$AppDbPassword,
        [int]$Port            = 5432,
        [int]$StepNumber      = 13,
        [int]$StepTotal       = 25,
        [string]$OrgId        = '971589dd-afcb-4a12-8900-47626e4d59cc'
    )
    Write-StepHeader -Number $StepNumber -Total $StepTotal -Title 'Seeding standard user accounts'

    $fixed = @(
        @{ Email = 'bk@bettroi.com';          Password = 'Nagpur@1';      Name = 'BK';           Role = 'super_admin' },
        @{ Email = 'saikat.dutta@gmail.com';   Password = 'Lightyear@123'; Name = 'Saikat Dutta'; Role = 'viewer' }
    )

    $node = (Get-Command node -ErrorAction Stop).Source
    $orgE = $OrgId -replace "'","''"
    $sqlBlocks = @()

    foreach ($u in $fixed) {
        $email = $u.Email.ToLower()
        Push-Location $BackendPath
        try {
            $hash = & $node -e "console.log(require('bcrypt').hashSync(process.argv[1], 12))" $u.Password 2>&1
        } finally {
            Pop-Location
        }
        if ($LASTEXITCODE -ne 0 -or -not $hash -or -not ($hash.ToString()).StartsWith('$2')) {
            throw "bcrypt hash failed for $email : $hash"
        }
        $hash = $hash.ToString().Trim()

        $emailE = $email     -replace "'","''"
        $nameE  = $u.Name    -replace "'","''"
        $hashE  = $hash      -replace "'","''"
        $roleE  = $u.Role    -replace "'","''"

        $sqlBlocks += @"
INSERT INTO users (email, password_hash, full_name)
  VALUES ('$emailE', '$hashE', '$nameE')
  ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        full_name     = EXCLUDED.full_name;

INSERT INTO profiles (user_id, full_name, role, org_id, preferences)
  SELECT id, '$nameE', '$roleE', '$orgE', '{"theme":"dark","language":"en"}'::jsonb
  FROM users WHERE email = '$emailE'
  ON CONFLICT (user_id) DO UPDATE
    SET role = '$roleE', full_name = EXCLUDED.full_name;

INSERT INTO org_members (org_id, user_id, role)
  SELECT '$orgE', id, '$roleE'
  FROM users WHERE email = '$emailE'
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = '$roleE';
"@
    }

    $psql = Get-PsqlPath
    if (-not $psql) { throw 'psql.exe not found; PostgreSQL install incomplete.' }

    $tmp = New-TemporaryFile
    Set-Content -Path $tmp -Value ($sqlBlocks -join "`r`n") -Encoding ASCII

    $env:PGPASSWORD = $AppDbPassword
    try {
        & $psql -h 127.0.0.1 -p $Port -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f $tmp.FullName 2>&1 |
            ForEach-Object { Write-Log -Level DEBUG -Message $_ }
        if ($LASTEXITCODE -ne 0) { throw "Fixed-user seed SQL failed (exit $LASTEXITCODE)" }
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }

    Write-Log -Level OK -Message "Standard accounts seeded: bk@bettroi.com (super_admin), saikat.dutta@gmail.com (viewer)."
}
