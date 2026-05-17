# verify.ps1 - Step 24: End-to-end health checks.

function Invoke-Verification {
    param(
        [Parameter(Mandatory)][string]$ServerIP,
        [int]$HttpsPort = 443,
        [int]$BackendPort = 3001,
        [string]$ServiceName = 'FlowAccelBackend'
    )
    Write-StepHeader -Number 24 -Total 25 -Title 'End-to-end verification'

    $pass = 0
    $fail = 0

    # 1. Service is running
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        Write-Log -Level OK -Message "Service '$ServiceName' is Running."
        $pass++
    } else {
        Write-Log -Level ERROR -Message "Service '$ServiceName' is NOT running."
        $fail++
    }

    # 2. Backend local health
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/api/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) {
            Write-Log -Level OK -Message "Backend /api/health returned 200 ($($r.Content.Substring(0,[Math]::Min(80,$r.Content.Length))))."
            $pass++
        } else {
            Write-Log -Level ERROR -Message "Backend /api/health returned $($r.StatusCode)."
            $fail++
        }
    } catch {
        Write-Log -Level ERROR -Message "Backend /api/health unreachable: $($_.Exception.Message)"
        $fail++
    }

    # 3. IIS HTTPS reachable
    try {
        # -SkipCertificateCheck added in PS 6+; on Windows PowerShell 5.1 we set a bypass callback.
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            $r = Invoke-WebRequest -Uri "https://$ServerIP`:$HttpsPort/api/health" -UseBasicParsing -TimeoutSec 5 -SkipCertificateCheck
        } else {
            Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAll : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@ -ErrorAction SilentlyContinue
            [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAll
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
            $r = Invoke-WebRequest -Uri "https://$ServerIP`:$HttpsPort/api/health" -UseBasicParsing -TimeoutSec 5
        }
        if ($r.StatusCode -eq 200) {
            Write-Log -Level OK -Message "HTTPS https://$ServerIP/api/health returned 200."
            $pass++
        } else {
            Write-Log -Level ERROR -Message "HTTPS https://$ServerIP/api/health returned $($r.StatusCode)."
            $fail++
        }
    } catch {
        Write-Log -Level ERROR -Message "HTTPS reverse-proxy unreachable: $($_.Exception.Message)"
        $fail++
    }

    # 4. Frontend served
    try {
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            $r = Invoke-WebRequest -Uri "https://$ServerIP`:$HttpsPort/" -UseBasicParsing -TimeoutSec 5 -SkipCertificateCheck
        } else {
            $r = Invoke-WebRequest -Uri "https://$ServerIP`:$HttpsPort/" -UseBasicParsing -TimeoutSec 5
        }
        if ($r.StatusCode -eq 200 -and $r.Content -match '(?i)flowaccel|jotflow|<!doctype html') {
            Write-Log -Level OK -Message 'Frontend HTML served by IIS.'
            $pass++
        } else {
            Write-Log -Level WARN -Message 'Frontend reachable but content does not look like FlowAccel.'
            $fail++
        }
    } catch {
        Write-Log -Level ERROR -Message "Frontend unreachable: $($_.Exception.Message)"
        $fail++
    }

    Write-Host ""
    if ($fail -eq 0) {
        Write-Banner -Status OK -Message "All $pass verification checks passed."
    } else {
        Write-Banner -Status WARN -Message "$pass passed, $fail failed. See log for details."
    }
    return @{ Pass = $pass; Fail = $fail }
}
