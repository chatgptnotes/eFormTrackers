# auto-remediate.ps1 - Deterministic, rule-based playbook of one-shot cures
# keyed off failure IDs emitted by verify.ps1.
#
# NO LLM. Each cure runs at most once per Invoke-AutoRemediate call. The caller
# is expected to re-run Invoke-Verification after this returns; if a failure
# persists, it escalates to the JSON report.
#
# Public surface:
#   Invoke-AutoRemediate -VerifyResult <hashtable> -Config <hashtable> `
#                        -InstallDir <string> [-StepNumber 25] [-StepTotal 25]
#
# Returns: @{ CuresAttempted = @(); CuresSucceeded = @(); CuresFailed = @() }

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

function Test-FailDetailContains {
    param(
        [Parameter(Mandatory)][array]$Results,
        [Parameter(Mandatory)][string]$IdPattern,
        [Parameter(Mandatory)][string]$Needle
    )
    foreach ($r in $Results) {
        if ($r.status -ne 'FAIL') { continue }
        if ($r.id -notlike $IdPattern) { continue }
        if ($r.detail -and ($r.detail -match [regex]::Escape($Needle))) { return $true }
    }
    return $false
}

function Test-AnyFailedId {
    param(
        [Parameter(Mandatory)][System.Collections.Generic.HashSet[string]]$FailedIds,
        [Parameter(Mandatory)][string[]]$Ids
    )
    foreach ($i in $Ids) { if ($FailedIds.Contains($i)) { return $true } }
    return $false
}

function Test-AnyFailedIdLike {
    param(
        [Parameter(Mandatory)][System.Collections.Generic.HashSet[string]]$FailedIds,
        [Parameter(Mandatory)][string]$Pattern
    )
    foreach ($i in $FailedIds) { if ($i -like $Pattern) { return $true } }
    return $false
}

# ----------------------------------------------------------------------------
# Cure bodies (one function per cure id)
# ----------------------------------------------------------------------------

function Invoke-CureDwsDisable {
    param([hashtable]$Config, [string]$InstallDir)
    Import-Module WebAdministration -ErrorAction SilentlyContinue
    Stop-Website 'Default Web Site' -ErrorAction SilentlyContinue
    Set-ItemProperty 'IIS:\Sites\Default Web Site' -Name serverAutoStart -Value $false -ErrorAction SilentlyContinue
    iisreset /restart | Out-Null
}

function Invoke-CureIisPerms {
    param([hashtable]$Config, [string]$InstallDir)
    $dist = Join-Path $InstallDir 'dist'
    if (-not (Test-Path $dist)) { throw "dist path not found: $dist" }
    icacls $dist /grant 'IIS_IUSRS:(OI)(CI)RX' /T /C | Out-Null
    Import-Module WebAdministration -ErrorAction SilentlyContinue
    Restart-WebItem "IIS:\Sites\$($Config.SiteName)" -ErrorAction SilentlyContinue
}

function Invoke-CureBackendRestart {
    param([hashtable]$Config, [string]$InstallDir)
    Restart-Service $Config.ServiceName -ErrorAction Stop
    Start-Sleep -Seconds 5
}

function Invoke-CureWebConfigReapply {
    param([hashtable]$Config, [string]$InstallDir)
    $src = Join-Path $InstallDir 'web.config'
    $dst = Join-Path $InstallDir 'dist\web.config'
    if (-not (Test-Path $src)) {
        Write-Log -Level WARN -Message "cure.webconfig.reapply: no source web.config at $src; skipping copy."
    } else {
        Copy-Item -Path $src -Destination $dst -Force
        Write-Log -Level INFO -Message "cure.webconfig.reapply: copied web.config to dist."
    }
    Import-Module WebAdministration -ErrorAction SilentlyContinue
    Restart-WebItem "IIS:\Sites\$($Config.SiteName)" -ErrorAction SilentlyContinue
}

function Invoke-CureArrEnable {
    param([hashtable]$Config, [string]$InstallDir)
    $appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
    if (-not (Test-Path $appcmd)) { throw "appcmd.exe not found at $appcmd" }
    & $appcmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost | Out-Null
    iisreset /restart | Out-Null
}

function Invoke-CureIisStart {
    param([hashtable]$Config, [string]$InstallDir)
    Import-Module WebAdministration -ErrorAction SilentlyContinue
    Start-WebAppPool -Name $Config.AppPoolName -ErrorAction SilentlyContinue
    Start-Website -Name $Config.SiteName -ErrorAction SilentlyContinue
}

function Invoke-CureAdminReseed {
    param([hashtable]$Config, [string]$InstallDir)
    $backend = Join-Path $InstallDir 'backend'
    if (-not (Test-Path $backend)) { throw "Backend path not found: $backend" }

    $email    = if ($Config.ContainsKey('AdminEmail'))    { $Config.AdminEmail }    else { $null }
    $password = if ($Config.ContainsKey('AdminPassword')) { $Config.AdminPassword } else { $null }
    $name     = if ($Config.ContainsKey('AdminName') -and $Config.AdminName) { $Config.AdminName } else { 'Administrator' }
    $dbName   = if ($Config.ContainsKey('DbName')        -and $Config.DbName)        { $Config.DbName }        else { 'jotflow' }
    $dbUser   = if ($Config.ContainsKey('DbUser')        -and $Config.DbUser)        { $Config.DbUser }        else { 'jotflow' }
    $appPw    = if ($Config.ContainsKey('AppDbPassword')) { $Config.AppDbPassword } else { $null }
    $pgPort   = if ($Config.ContainsKey('PgPort')        -and $Config.PgPort)        { [int]$Config.PgPort }   else { 5432 }

    if (-not $email)    { throw 'cure.admin.reseed: Config.AdminEmail missing' }
    if (-not $password) { throw 'cure.admin.reseed: Config.AdminPassword missing' }
    if (-not $appPw)    { throw 'cure.admin.reseed: Config.AppDbPassword missing' }

    Seed-AdminUser -BackendPath $backend `
        -AdminEmail $email `
        -AdminPassword $password `
        -AdminName $name `
        -DbName $dbName `
        -DbUser $dbUser `
        -AppDbPassword $appPw `
        -Port $pgPort
}

function Invoke-CureMigrateRerun {
    param([hashtable]$Config, [string]$InstallDir)
    $backend = Join-Path $InstallDir 'backend'
    $migrate = Join-Path $backend 'db\migrate.js'
    if (-not (Test-Path $migrate)) { throw "migrate.js not found at $migrate" }
    Push-Location $backend
    try {
        & node 'db\migrate.js' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "migrate.js exit $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

# ----------------------------------------------------------------------------
# Dispatcher
# ----------------------------------------------------------------------------

function Invoke-AutoRemediate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$VerifyResult,
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)][string]$InstallDir,
        [int]$StepNumber = 25,
        [int]$StepTotal  = 25
    )

    Write-StepHeader -Number $StepNumber -Total $StepTotal -Title 'Auto-remediating known failure modes'

    # Dedicated log file (also goes through Write-Log -> main log).
    $cureLog = Join-Path $InstallDir ("logs\auto-remediate-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
    $cureLogDir = Split-Path -Parent $cureLog
    if (-not (Test-Path $cureLogDir)) { New-Item -ItemType Directory -Force -Path $cureLogDir | Out-Null }
    "=== auto-remediate started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" |
        Out-File -FilePath $cureLog -Encoding utf8 -Append

    $append = {
        param($Msg)
        $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
        $line | Out-File -FilePath $cureLog -Encoding utf8 -Append
    }

    $results = @($VerifyResult.Results)
    $failed  = @($results | Where-Object { $_.status -eq 'FAIL' })

    $failedIds = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($r in $failed) { [void]$failedIds.Add($r.id) }

    Write-Log -Level INFO -Message ("Auto-remediate scanning {0} failure(s)." -f $failed.Count)
    & $append ("Failed IDs: " + (($failedIds | Sort-Object) -join ', '))

    $attempted = New-Object System.Collections.ArrayList
    $succeeded = New-Object System.Collections.ArrayList
    $failedC   = New-Object System.Collections.ArrayList

    # --- Build dispatch table (cureId, trigger predicate, body) ---
    $cures = @(
        @{
            Id      = 'cure.dws.disable'
            Trigger = {
                (Test-AnyFailedId -FailedIds $failedIds -Ids @('landing.http.bare','landing.http.port')) -and
                (Test-FailDetailContains -Results $failed -IdPattern 'landing.http.*' -Needle 'IIS Welcome')
            }
            Body    = { Invoke-CureDwsDisable -Config $Config -InstallDir $InstallDir }
        },
        @{
            Id      = 'cure.iis.perms'
            Trigger = {
                (Test-AnyFailedIdLike -FailedIds $failedIds -Pattern 'landing.*') -and
                (Test-FailDetailContains -Results $failed -IdPattern 'landing.*' -Needle '403')
            }
            Body    = { Invoke-CureIisPerms -Config $Config -InstallDir $InstallDir }
        },
        @{
            Id      = 'cure.backend.restart'
            Trigger = {
                ($failedIds.Contains('backend.health')) -or
                ((Test-AnyFailedIdLike -FailedIds $failedIds -Pattern 'landing.*') -and
                 (Test-FailDetailContains -Results $failed -IdPattern 'landing.*' -Needle '502'))
            }
            Body    = { Invoke-CureBackendRestart -Config $Config -InstallDir $InstallDir }
        },
        @{
            Id      = 'cure.webconfig.reapply'
            Trigger = { $failedIds.Contains('landing.asset') }
            Body    = { Invoke-CureWebConfigReapply -Config $Config -InstallDir $InstallDir }
        },
        @{
            Id      = 'cure.arr.enable'
            Trigger = { $failedIds.Contains('arr.enabled') }
            Body    = { Invoke-CureArrEnable -Config $Config -InstallDir $InstallDir }
        },
        @{
            Id      = 'cure.iis.start'
            Trigger = { (Test-AnyFailedId -FailedIds $failedIds -Ids @('iis.site.started','iis.apppool.started')) }
            Body    = { Invoke-CureIisStart -Config $Config -InstallDir $InstallDir }
        },
        @{
            Id      = 'cure.admin.reseed'
            Trigger = { (Test-AnyFailedId -FailedIds $failedIds -Ids @('auth.login','auth.session','db.admin.row')) }
            Body    = { Invoke-CureAdminReseed -Config $Config -InstallDir $InstallDir }
        },
        @{
            Id      = 'cure.migrate.rerun'
            Trigger = { $failedIds.Contains('pg.schema') }
            Body    = { Invoke-CureMigrateRerun -Config $Config -InstallDir $InstallDir }
        }
    )

    $ran = New-Object 'System.Collections.Generic.HashSet[string]'

    foreach ($cure in $cures) {
        $cureId = $cure.Id
        if ($ran.Contains($cureId)) { continue }

        $shouldRun = $false
        try { $shouldRun = [bool](& $cure.Trigger) } catch {
            Write-Log -Level ERROR -Message "Cure trigger evaluation failed for $cureId : $($_.Exception.Message)"
            & $append "TRIGGER-ERROR ${cureId}: $($_.Exception.Message)"
            continue
        }
        if (-not $shouldRun) { continue }

        [void]$ran.Add($cureId)
        [void]$attempted.Add($cureId)
        Write-Log -Level INFO -Message "Attempting cure: $cureId"
        & $append "ATTEMPT $cureId"

        try {
            & $cure.Body
            [void]$succeeded.Add($cureId)
            Write-Log -Level OK -Message "Cure $cureId succeeded."
            & $append "SUCCESS $cureId"
        } catch {
            [void]$failedC.Add($cureId)
            Write-Log -Level ERROR -Message "Cure $cureId failed: $($_.Exception.Message)"
            & $append "FAILURE ${cureId}: $($_.Exception.Message)"
        }
    }

    # --- Escalations: log-only, no action ---
    if ($failedIds.Contains('pg.reachable')) {
        Write-Log -Level ERROR -Message 'Postgres unreachable - ESCALATE: check postgresql-x64-15 service and network.'
        & $append 'ESCALATE pg.reachable: Postgres unreachable - check postgresql-x64-15 service and network.'
    }

    $known = @(
        'landing.http.bare','landing.http.port','landing.asset',
        'backend.health','arr.enabled',
        'iis.site.started','iis.apppool.started',
        'auth.login','auth.session','db.admin.row','pg.schema','pg.reachable'
    )
    foreach ($id in $failedIds) {
        $matched = $false
        foreach ($k in $known) { if ($id -like $k) { $matched = $true; break } }
        if (-not $matched) {
            Write-Log -Level WARN -Message "No cure mapped for id=$id - ESCALATE."
            & $append "ESCALATE unknown: $id"
        }
    }

    if ($attempted.Count -eq 0) {
        Write-Log -Level INFO -Message 'Auto-remediate: no cures matched the current failure set.'
    } else {
        Write-Log -Level INFO -Message ("Auto-remediate done. Attempted={0} Succeeded={1} Failed={2}" -f `
            $attempted.Count, $succeeded.Count, $failedC.Count)
    }

    return @{
        CuresAttempted = @($attempted)
        CuresSucceeded = @($succeeded)
        CuresFailed    = @($failedC)
    }
}
