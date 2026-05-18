# =====================================================================
#  FlowAccel - fix bk@bettroi.com login
#  Sets the password AND promotes the account to admin role.
#
#  Run (it will prompt for the new password):
#    powershell -ExecutionPolicy Bypass -File C:\Website\flowaccel\fix-login.ps1
#
#  Or pass the password directly:
#    powershell -ExecutionPolicy Bypass -File C:\Website\flowaccel\fix-login.ps1 -NewPassword 'YourPassword'
# =====================================================================
param([Parameter(Mandatory=$true)][string]$NewPassword)

$ErrorActionPreference = 'Stop'
$node   = 'C:\Program Files\nodejs\node.exe'
$psql   = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
$bcrypt = 'C:/Website/flowaccel/backend/node_modules/bcrypt'
$email  = 'bk@bettroi.com'

Write-Host "[1/3] Generating password hash..." -ForegroundColor Cyan
$hash = & $node -e "console.log(require('$bcrypt').hashSync(process.argv[1], 12))" $NewPassword
if (-not $hash -or -not $hash.StartsWith('$2')) { throw "Hash generation failed: $hash" }

Write-Host "[2/3] Updating database (password + admin role)..." -ForegroundColor Cyan
$env:PGPASSWORD = Read-Host 'Enter the jotflow database password'
$sql = @"
UPDATE users       SET password_hash='$hash', updated_at=now() WHERE email='$email';
UPDATE profiles    SET role='admin' WHERE user_id=(SELECT id FROM users WHERE email='$email');
UPDATE org_members SET role='admin' WHERE user_id=(SELECT id FROM users WHERE email='$email');
"@
& $psql -h 127.0.0.1 -U jotflow -d jotflow -c $sql

Write-Host "[3/3] Testing login..." -ForegroundColor Cyan
$body = (@{ email = $email; password = $NewPassword } | ConvertTo-Json -Compress)
try {
    $r = Invoke-WebRequest "http://localhost:8081/api/auth/login" -Method POST `
            -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 12
    Write-Host "      LOGIN OK ($($r.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "      LOGIN test failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n===============================================" -ForegroundColor Green
Write-Host "  URL:      http://192.168.8.127:8081/"
Write-Host "  Email:    $email"
Write-Host "  Password: $NewPassword"
Write-Host "  Role:     admin"
Write-Host "===============================================" -ForegroundColor Green
Write-Host "Log in, then logout+login once so the admin role applies." -ForegroundColor DarkGray
