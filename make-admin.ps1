# =====================================================================
#  FlowAccel - promote bk@bettroi.com to admin role
#  Just run this file:
#    powershell -ExecutionPolicy Bypass -File C:\Website\flowaccel\make-admin.ps1
# =====================================================================

$env:PGPASSWORD = Read-Host 'Enter the jotflow database password'
$psql  = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
$email = 'bk@bettroi.com'

Write-Host "Promoting $email to admin..." -ForegroundColor Cyan

& $psql -h 127.0.0.1 -U jotflow -d jotflow -c @"
UPDATE profiles    SET role='admin' WHERE user_id=(SELECT id FROM users WHERE email='$email');
UPDATE org_members SET role='admin' WHERE user_id=(SELECT id FROM users WHERE email='$email');
"@

Write-Host "`nResult:" -ForegroundColor Green
& $psql -h 127.0.0.1 -U jotflow -d jotflow -c @"
SELECT u.email, p.role AS profile_role, om.role AS member_role
FROM users u
JOIN profiles p     ON p.user_id  = u.id
JOIN org_members om ON om.user_id = u.id;
"@

Write-Host "`nDone. Log out and log back in for the new role to take effect." -ForegroundColor Green
