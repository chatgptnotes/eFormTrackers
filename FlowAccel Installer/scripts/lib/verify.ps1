# verify.ps1 - Step 24: End-to-end health checks with strict fingerprinting.
#
# Exports:
#   Invoke-LandingPageProbe -Url <string> [-TimeoutSec <int>]
#   Invoke-Verification (see signature below)
#
# Result contract (per check): @{ id; tier; name; status; detail; remediationHint }
# IDs are stable - auto-remediate.ps1 keys off them.

function Initialize-CertBypass {
    if ($PSVersionTable.PSVersion.Major -ge 6) { return }
    try {
        Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllVerify : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@ -ErrorAction SilentlyContinue
        [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllVerify
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    } catch {
        # Ignore - type may already exist from prior dot-source.
    }
}

function Invoke-LandingPageProbe {
    param(
        [Parameter(Mandatory)][string]$Url,
        [int]$TimeoutSec = 8
    )
    $result = @{
        Url                 = $Url
        StatusCode          = $null
        Body                = $null
        LooksLikeFlowAccel  = $false
        LooksLikeIIS        = $false
        Error               = $null
    }

    Initialize-CertBypass

    try {
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -SkipCertificateCheck
        } else {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        }
        $result.StatusCode = [int]$r.StatusCode
        $body = [string]$r.Content
        $result.Body = $body

        $result.LooksLikeFlowAccel = ($body -match '<title>[^<]*FlowAccel') -or
            ($body -match 'id="root"' -and $body -match '/assets/index-[A-Za-z0-9_-]+\.js')
        $result.LooksLikeIIS = ($body -match 'iisstart\.png') -or
            ($body -match 'Welcome\s+IIS') -or
            ($body -match 'Internet Information Services')
    } catch {
        $result.Error = $_.Exception.Message
    }

    return $result
}

function New-CheckResult {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][int]$Tier,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][ValidateSet('PASS','FAIL','SKIP')][string]$Status,
        [string]$Detail = '',
        [string]$RemediationHint = ''
    )
    return @{
        id              = $Id
        tier            = $Tier
        name            = $Name
        status          = $Status
        detail          = $Detail
        remediationHint = $RemediationHint
    }
}

function Write-CheckResult {
    param([Parameter(Mandatory)][hashtable]$Result)
    $msg = "[$($Result.id)] $($Result.name) - $($Result.detail)"
    switch ($Result.status) {
        'PASS' { Write-Log -Level OK    -Message $msg }
        'FAIL' { Write-Log -Level ERROR -Message $msg; if ($Result.remediationHint) { Write-Log -Level WARN -Message "  hint: $($Result.remediationHint)" } }
        'SKIP' { Write-Log -Level WARN  -Message "$msg (skipped)" }
    }
}

function Invoke-Verification {
    param(
        [Parameter(Mandatory)][string]$ServerIP,
        [int]$HttpPort      = 80,
        [int]$BackendPort   = 3001,
        [int]$PgPort        = 5432,
        [string]$ServiceName= 'FlowAccelBackend',
        [string]$DbName     = 'jotflow',
        [string]$DbUser     = 'jotflow',
        [string]$AppDbPassword,
        [string]$AdminEmail,
        [string]$AdminPassword,
        [string]$JsonReportDir
    )

    Write-StepHeader -Number 24 -Total 25 -Title 'End-to-end verification'
    Initialize-CertBypass

    $results = New-Object System.Collections.ArrayList
    $psql = Get-PsqlPath

    # -------------------------------------------------------------------
    # Tier 1 - infrastructure smoke
    # -------------------------------------------------------------------

    # 1. service.running
    try {
        $svc = Get-Service -Name $ServiceName -ErrorAction Stop
        if ($svc.Status -eq 'Running') {
            [void]$results.Add((New-CheckResult -Id 'service.running' -Tier 1 -Name "Service '$ServiceName' running" -Status PASS -Detail 'Running'))
        } else {
            [void]$results.Add((New-CheckResult -Id 'service.running' -Tier 1 -Name "Service '$ServiceName' running" -Status FAIL -Detail "Status=$($svc.Status)" -RemediationHint "Start-Service $ServiceName; check Event Viewer for crash reason."))
        }
    } catch {
        [void]$results.Add((New-CheckResult -Id 'service.running' -Tier 1 -Name "Service '$ServiceName' running" -Status FAIL -Detail $_.Exception.Message -RemediationHint "Service not installed - re-run nssm install step."))
    }

    # 2. pg.reachable
    if ([string]::IsNullOrEmpty($AppDbPassword)) {
        [void]$results.Add((New-CheckResult -Id 'pg.reachable' -Tier 1 -Name 'PostgreSQL SELECT 1' -Status SKIP -Detail 'AppDbPassword not provided'))
    } elseif (-not $psql) {
        [void]$results.Add((New-CheckResult -Id 'pg.reachable' -Tier 1 -Name 'PostgreSQL SELECT 1' -Status FAIL -Detail 'psql.exe not found' -RemediationHint 'PostgreSQL install incomplete - re-run Step 8.'))
    } else {
        try {
            $env:PGPASSWORD = $AppDbPassword
            $out = & $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -tA -c "SELECT 1" 2>&1
            if ($LASTEXITCODE -eq 0) {
                [void]$results.Add((New-CheckResult -Id 'pg.reachable' -Tier 1 -Name 'PostgreSQL SELECT 1' -Status PASS -Detail 'psql returned 0'))
            } else {
                [void]$results.Add((New-CheckResult -Id 'pg.reachable' -Tier 1 -Name 'PostgreSQL SELECT 1' -Status FAIL -Detail "psql exit=${LASTEXITCODE}: $out" -RemediationHint "Check pg_hba.conf, app DB password, and that user '$DbUser' exists."))
            }
        } catch {
            [void]$results.Add((New-CheckResult -Id 'pg.reachable' -Tier 1 -Name 'PostgreSQL SELECT 1' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'psql invocation failed.'))
        } finally {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        }
    }

    # 3. pg.schema
    if ([string]::IsNullOrEmpty($AppDbPassword) -or -not $psql) {
        [void]$results.Add((New-CheckResult -Id 'pg.schema' -Tier 1 -Name 'Core tables present' -Status SKIP -Detail 'Cannot check without psql/password'))
    } else {
        try {
            $env:PGPASSWORD = $AppDbPassword
            $sql = "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','profiles','org_members')"
            $out = (& $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -tA -c $sql 2>&1) | Out-String
            $count = ($out -replace '\s','')
            if ($LASTEXITCODE -eq 0 -and $count -eq '3') {
                [void]$results.Add((New-CheckResult -Id 'pg.schema' -Tier 1 -Name 'Core tables present' -Status PASS -Detail '3 of 3 tables (users, profiles, org_members)'))
            } else {
                [void]$results.Add((New-CheckResult -Id 'pg.schema' -Tier 1 -Name 'Core tables present' -Status FAIL -Detail "Expected 3, got '$count' (exit=$LASTEXITCODE)" -RemediationHint 'Re-run db\migrate.js (Step 13).'))
            }
        } catch {
            [void]$results.Add((New-CheckResult -Id 'pg.schema' -Tier 1 -Name 'Core tables present' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'Re-run db\migrate.js (Step 13).'))
        } finally {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        }
    }

    # 4. backend.health
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/api/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) {
            [void]$results.Add((New-CheckResult -Id 'backend.health' -Tier 1 -Name 'Backend /api/health' -Status PASS -Detail '200 OK'))
        } else {
            [void]$results.Add((New-CheckResult -Id 'backend.health' -Tier 1 -Name 'Backend /api/health' -Status FAIL -Detail "HTTP $($r.StatusCode)" -RemediationHint 'Inspect backend logs (nssm get FlowAccelBackend AppStdout).'))
        }
    } catch {
        [void]$results.Add((New-CheckResult -Id 'backend.health' -Tier 1 -Name 'Backend /api/health' -Status FAIL -Detail $_.Exception.Message -RemediationHint "Service not listening on $BackendPort - check nssm logs and DATABASE_URL."))
    }

    # 5. iis.site.started
    try {
        Import-Module WebAdministration -ErrorAction Stop
        $site = Get-Website -Name 'FlowAccel' -ErrorAction Stop
        if ($site -and $site.State -eq 'Started') {
            [void]$results.Add((New-CheckResult -Id 'iis.site.started' -Tier 1 -Name "IIS site 'FlowAccel' started" -Status PASS -Detail 'Started'))
        } else {
            [void]$results.Add((New-CheckResult -Id 'iis.site.started' -Tier 1 -Name "IIS site 'FlowAccel' started" -Status FAIL -Detail "State=$($site.State)" -RemediationHint "Start-Website -Name 'FlowAccel'; check port conflict with Default Web Site."))
        }
    } catch {
        [void]$results.Add((New-CheckResult -Id 'iis.site.started' -Tier 1 -Name "IIS site 'FlowAccel' started" -Status FAIL -Detail $_.Exception.Message -RemediationHint 'IIS site missing - re-run Step 20 (create-iis-site).'))
    }

    # 6. iis.apppool.started
    try {
        $pool = Get-Item 'IIS:\AppPools\FlowAccelPool' -ErrorAction Stop
        if ($pool -and $pool.State -eq 'Started') {
            [void]$results.Add((New-CheckResult -Id 'iis.apppool.started' -Tier 1 -Name 'AppPool FlowAccelPool started' -Status PASS -Detail 'Started'))
        } else {
            [void]$results.Add((New-CheckResult -Id 'iis.apppool.started' -Tier 1 -Name 'AppPool FlowAccelPool started' -Status FAIL -Detail "State=$($pool.State)" -RemediationHint "Start-WebAppPool -Name 'FlowAccelPool'."))
        }
    } catch {
        [void]$results.Add((New-CheckResult -Id 'iis.apppool.started' -Tier 1 -Name 'AppPool FlowAccelPool started' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'AppPool missing - re-run Step 20.'))
    }

    # 7. arr.enabled
    $appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
    try {
        if (-not (Test-Path $appcmd)) { throw "appcmd.exe not found at $appcmd" }
        $out = & $appcmd list config /section:system.webServer/proxy 2>&1 | Out-String
        if ($out -match 'enabled="true"') {
            [void]$results.Add((New-CheckResult -Id 'arr.enabled' -Tier 1 -Name 'ARR proxy enabled' -Status PASS -Detail 'enabled="true" in system.webServer/proxy'))
        } else {
            [void]$results.Add((New-CheckResult -Id 'arr.enabled' -Tier 1 -Name 'ARR proxy enabled' -Status FAIL -Detail 'proxy enabled flag not true' -RemediationHint "Enable ARR proxy: appcmd set config -section:system.webServer/proxy /enabled:true /commit:apphost"))
        }
    } catch {
        [void]$results.Add((New-CheckResult -Id 'arr.enabled' -Tier 1 -Name 'ARR proxy enabled' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'Install ARR module + run Step 21.'))
    }

    # 8. Landing-page fingerprint (HTTP only)
    $urlSpecs = @()
    if ($HttpPort -ne 80) {
        $urlSpecs += @{ Id = 'landing.http.bare'; Url = "http://${ServerIP}:${HttpPort}/" }
    } else {
        $urlSpecs += @{ Id = 'landing.http.bare'; Url = "http://$ServerIP/" }
    }

    $firstPassing = $null
    foreach ($spec in $urlSpecs) {
        $id = $spec.Id
        $url = $spec.Url
        if ($spec.ContainsKey('Skip') -and $spec.Skip) {
            [void]$results.Add((New-CheckResult -Id $id -Tier 1 -Name "Landing page $url" -Status SKIP -Detail $spec.SkipReason))
            continue
        }
        $probe = Invoke-LandingPageProbe -Url $url -TimeoutSec 8
        if ($probe.Error) {
            [void]$results.Add((New-CheckResult -Id $id -Tier 1 -Name "Landing page $url" -Status FAIL -Detail $probe.Error -RemediationHint 'Backend or IIS site may not be running, or firewall blocking the port.'))
            continue
        }
        if ($probe.LooksLikeIIS) {
            [void]$results.Add((New-CheckResult -Id $id -Tier 1 -Name "Landing page $url" -Status FAIL -Detail "IIS Welcome page served at $url" -RemediationHint 'Stop and disable Default Web Site; it is bound to the port your browser defaulted to.'))
            continue
        }
        if (-not $probe.LooksLikeFlowAccel) {
            [void]$results.Add((New-CheckResult -Id $id -Tier 1 -Name "Landing page $url" -Status FAIL -Detail "Unknown content at $url (status $($probe.StatusCode))" -RemediationHint 'Check IIS site PhysicalPath and dist\index.html.'))
            continue
        }
        [void]$results.Add((New-CheckResult -Id $id -Tier 1 -Name "Landing page $url" -Status PASS -Detail "FlowAccel fingerprint matched (status $($probe.StatusCode))"))
        if (-not $firstPassing) { $firstPassing = $probe }
    }

    # 10. landing.asset
    if (-not $firstPassing) {
        [void]$results.Add((New-CheckResult -Id 'landing.asset' -Tier 1 -Name 'Static asset reachable' -Status SKIP -Detail 'No landing page check passed'))
    } else {
        $m = [regex]::Match($firstPassing.Body, '/assets/index-[A-Za-z0-9_-]+\.(js|css)')
        if (-not $m.Success) {
            [void]$results.Add((New-CheckResult -Id 'landing.asset' -Tier 1 -Name 'Static asset reachable' -Status FAIL -Detail 'No /assets/index-*.{js,css} reference in landing HTML' -RemediationHint 'Verify dist\index.html was deployed and references hashed bundles.'))
        } else {
            $assetPath = $m.Value
            $baseUri = [Uri]$firstPassing.Url
            $baseUrl = "$($baseUri.Scheme)://$($baseUri.Authority)"
            $assetUrl = "$baseUrl$assetPath"
            try {
                if ($PSVersionTable.PSVersion.Major -ge 6) {
                    $ar = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec 8 -SkipCertificateCheck
                } else {
                    $ar = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec 8
                }
                if ([int]$ar.StatusCode -eq 200) {
                    [void]$results.Add((New-CheckResult -Id 'landing.asset' -Tier 1 -Name 'Static asset reachable' -Status PASS -Detail "200 OK for $assetPath"))
                } else {
                    [void]$results.Add((New-CheckResult -Id 'landing.asset' -Tier 1 -Name 'Static asset reachable' -Status FAIL -Detail "HTTP $($ar.StatusCode) for $assetUrl" -RemediationHint 'Static asset serving broken - check web.config, dist\assets\, MIME types, IIS_IUSRS perms.'))
                }
            } catch {
                [void]$results.Add((New-CheckResult -Id 'landing.asset' -Tier 1 -Name 'Static asset reachable' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'Static asset serving broken - check web.config, dist\assets\, MIME types, IIS_IUSRS perms.'))
            }
        }
    }

    # -------------------------------------------------------------------
    # Tier 2 - auth round-trip (only if admin creds provided)
    # -------------------------------------------------------------------
    $runTier2 = -not [string]::IsNullOrEmpty($AdminEmail) -and -not [string]::IsNullOrEmpty($AdminPassword)
    if ($runTier2) {
        if ($HttpPort -eq 80) { $baseUrl = "http://$ServerIP" } else { $baseUrl = "http://${ServerIP}:${HttpPort}" }
        $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

        # 1. auth.login
        $loginOk = $false
        try {
            $body = ConvertTo-Json @{ email = $AdminEmail; password = $AdminPassword }
            if ($PSVersionTable.PSVersion.Major -ge 6) {
                $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -WebSession $session -TimeoutSec 8 -UseBasicParsing -SkipCertificateCheck
            } else {
                $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -WebSession $session -TimeoutSec 8 -UseBasicParsing
            }
            $okFlag = $false
            try { $okFlag = (($r.Content | ConvertFrom-Json).ok -eq $true) } catch {}
            if ([int]$r.StatusCode -eq 200 -and $okFlag) {
                [void]$results.Add((New-CheckResult -Id 'auth.login' -Tier 2 -Name 'Admin login round-trip' -Status PASS -Detail 'ok:true, 200'))
                $loginOk = $true
            } else {
                [void]$results.Add((New-CheckResult -Id 'auth.login' -Tier 2 -Name 'Admin login round-trip' -Status FAIL -Detail "status=$($r.StatusCode) ok=$okFlag" -RemediationHint "Re-seed admin user via admin-seed.ps1; verify users table has row for $AdminEmail"))
            }
        } catch {
            [void]$results.Add((New-CheckResult -Id 'auth.login' -Tier 2 -Name 'Admin login round-trip' -Status FAIL -Detail $_.Exception.Message -RemediationHint "Re-seed admin user via admin-seed.ps1; verify users table has row for $AdminEmail"))
        }

        # 2. auth.session
        try {
            if ($PSVersionTable.PSVersion.Major -ge 6) {
                $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/session" -WebSession $session -TimeoutSec 8 -UseBasicParsing -SkipCertificateCheck
            } else {
                $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/session" -WebSession $session -TimeoutSec 8 -UseBasicParsing
            }
            $role = $null
            try { $role = ($r.Content | ConvertFrom-Json).user.role } catch {}
            if ([int]$r.StatusCode -eq 200 -and $role -eq 'super_admin') {
                [void]$results.Add((New-CheckResult -Id 'auth.session' -Tier 2 -Name 'Session reflects super_admin' -Status PASS -Detail "user.role=$role"))
            } else {
                [void]$results.Add((New-CheckResult -Id 'auth.session' -Tier 2 -Name 'Session reflects super_admin' -Status FAIL -Detail "status=$($r.StatusCode) role=$role" -RemediationHint 'User row exists but role is not super_admin - re-run admin-seed.'))
            }
        } catch {
            [void]$results.Add((New-CheckResult -Id 'auth.session' -Tier 2 -Name 'Session reflects super_admin' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'User row exists but role is not super_admin - re-run admin-seed.'))
        }

        # 3. db.admin.row
        if (-not $psql -or [string]::IsNullOrEmpty($AppDbPassword)) {
            [void]$results.Add((New-CheckResult -Id 'db.admin.row' -Tier 2 -Name 'Admin row in users table' -Status SKIP -Detail 'psql or AppDbPassword unavailable'))
        } else {
            try {
                $env:PGPASSWORD = $AppDbPassword
                $emailE = $AdminEmail -replace "'","''"
                $sql = "SELECT count(*) FROM users WHERE email='$emailE'"
                $out = (& $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -tA -c $sql 2>&1) | Out-String
                $count = ($out -replace '\s','')
                if ($LASTEXITCODE -eq 0 -and $count -eq '1') {
                    [void]$results.Add((New-CheckResult -Id 'db.admin.row' -Tier 2 -Name 'Admin row in users table' -Status PASS -Detail "1 row for $AdminEmail"))
                } else {
                    [void]$results.Add((New-CheckResult -Id 'db.admin.row' -Tier 2 -Name 'Admin row in users table' -Status FAIL -Detail "Expected 1, got '$count' (exit=$LASTEXITCODE)" -RemediationHint 'Re-run admin-seed.ps1 to create super_admin row.'))
                }
            } catch {
                [void]$results.Add((New-CheckResult -Id 'db.admin.row' -Tier 2 -Name 'Admin row in users table' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'Re-run admin-seed.ps1.'))
            } finally {
                Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
            }
        }

        # 4. auth.logout
        try {
            if ($PSVersionTable.PSVersion.Major -ge 6) {
                $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/logout" -Method POST -WebSession $session -TimeoutSec 8 -UseBasicParsing -SkipCertificateCheck
            } else {
                $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/logout" -Method POST -WebSession $session -TimeoutSec 8 -UseBasicParsing
            }
            if ([int]$r.StatusCode -eq 200) {
                [void]$results.Add((New-CheckResult -Id 'auth.logout' -Tier 2 -Name 'Admin logout' -Status PASS -Detail '200 OK'))
            } else {
                [void]$results.Add((New-CheckResult -Id 'auth.logout' -Tier 2 -Name 'Admin logout' -Status FAIL -Detail "status=$($r.StatusCode)" -RemediationHint 'Logout endpoint not returning 200 - check backend auth router.'))
            }
        } catch {
            [void]$results.Add((New-CheckResult -Id 'auth.logout' -Tier 2 -Name 'Admin logout' -Status FAIL -Detail $_.Exception.Message -RemediationHint 'Logout endpoint not returning 200 - check backend auth router.'))
        }
    } else {
        Write-Log -Level INFO -Message 'Tier 2 auth checks skipped (AdminEmail / AdminPassword not provided).'
    }

    # -------------------------------------------------------------------
    # Summary + log per check + JSON report
    # -------------------------------------------------------------------
    $pass = 0; $fail = 0
    foreach ($r in $results) {
        Write-CheckResult -Result $r
        if ($r.status -eq 'PASS') { $pass++ }
        elseif ($r.status -eq 'FAIL') { $fail++ }
    }

    Write-Host ''
    if ($fail -eq 0) {
        Write-Banner -Status OK -Message "All $pass verification checks passed."
    } else {
        Write-Banner -Status WARN -Message "$pass passed, $fail failed. See log for details."
    }

    $reportPath = $null
    if ($fail -gt 0 -and -not [string]::IsNullOrEmpty($JsonReportDir)) {
        try {
            if (-not (Test-Path $JsonReportDir)) { New-Item -ItemType Directory -Force -Path $JsonReportDir | Out-Null }
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            $reportPath = Join-Path $JsonReportDir "smoke-test-$stamp.json"
            $payload = @{
                timestamp = (Get-Date).ToString('o')
                pass      = $pass
                fail      = $fail
                results   = @($results)
            }
            $payload | ConvertTo-Json -Depth 4 | Out-File -FilePath $reportPath -Encoding utf8
            Write-Log -Level INFO -Message "Smoke-test JSON report: $reportPath"
        } catch {
            Write-Log -Level WARN -Message "Failed to write JSON report: $($_.Exception.Message)"
            $reportPath = $null
        }
    }

    return @{
        Pass       = $pass
        Fail       = $fail
        Results    = @($results)
        ReportPath = $reportPath
    }
}
