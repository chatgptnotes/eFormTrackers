# firewall.ps1 - Step 21: Windows Firewall ruleset.

$script:FwGroup = 'FlowAccel'

function Set-FirewallRules {
    param(
        [int]$HttpPort   = 80,
        [int]$HttpsPort  = 443,
        [int]$BackendPort = 3001,
        [int]$PgPort     = 5432,
        [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
        [bool]$AllowIcmp = $true
    )
    Write-StepHeader -Number 21 -Total 25 -Title 'Configuring Windows Firewall (9 FlowAccel rules)'

    # Wipe any prior rules in our group so re-runs converge to expected state.
    $existing = Get-NetFirewallRule -Group $script:FwGroup -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Log -Level INFO -Message "Removing $($existing.Count) existing FlowAccel firewall rules to re-apply clean."
        $existing | Remove-NetFirewallRule
    }

    # 1. HTTP inbound (Domain + Private only)
    New-NetFirewallRule -DisplayName 'FlowAccel: HTTP Inbound' -Group $script:FwGroup `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpPort `
        -Profile Domain,Private | Out-Null

    # 2. HTTPS inbound (Domain + Private only)
    New-NetFirewallRule -DisplayName 'FlowAccel: HTTPS Inbound' -Group $script:FwGroup `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpsPort `
        -Profile Domain,Private | Out-Null

    # 3. Node backend - loopback only (allow)
    New-NetFirewallRule -DisplayName 'FlowAccel: Node Backend Loopback' -Group $script:FwGroup `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $BackendPort `
        -LocalAddress 127.0.0.1 -RemoteAddress 127.0.0.1 | Out-Null

    # 4. Node backend - block external (defense in depth)
    New-NetFirewallRule -DisplayName 'FlowAccel: Node Backend Block External' -Group $script:FwGroup `
        -Direction Inbound -Action Block -Protocol TCP -LocalPort $BackendPort `
        -RemoteAddress Any | Out-Null

    # 5. PostgreSQL - loopback only (allow)
    New-NetFirewallRule -DisplayName 'FlowAccel: PostgreSQL Loopback' -Group $script:FwGroup `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $PgPort `
        -LocalAddress 127.0.0.1 -RemoteAddress 127.0.0.1 | Out-Null

    # 6. PostgreSQL - block external (defense in depth)
    New-NetFirewallRule -DisplayName 'FlowAccel: PostgreSQL Block External' -Group $script:FwGroup `
        -Direction Inbound -Action Block -Protocol TCP -LocalPort $PgPort `
        -RemoteAddress Any | Out-Null

    # 7. Node outbound HTTPS
    if (Test-Path $NodeExe) {
        New-NetFirewallRule -DisplayName 'FlowAccel: Node Outbound HTTPS' -Group $script:FwGroup `
            -Direction Outbound -Action Allow -Protocol TCP -RemotePort 443 `
            -Program $NodeExe | Out-Null
    } else {
        Write-Log -Level WARN -Message "node.exe not found at $NodeExe; outbound rule scoped by program skipped."
    }

    # 8. Node outbound DNS
    if (Test-Path $NodeExe) {
        New-NetFirewallRule -DisplayName 'FlowAccel: Node Outbound DNS' -Group $script:FwGroup `
            -Direction Outbound -Action Allow -Protocol UDP -RemotePort 53 `
            -Program $NodeExe | Out-Null
    }

    # 9. ICMP inbound (LAN)
    if ($AllowIcmp) {
        New-NetFirewallRule -DisplayName 'FlowAccel: ICMP Inbound (LAN)' -Group $script:FwGroup `
            -Direction Inbound -Action Allow -Protocol ICMPv4 `
            -IcmpType 8 -Profile Domain,Private | Out-Null
    }

    # Warn if firewall profiles are disabled
    Get-NetFirewallProfile | ForEach-Object {
        if (-not $_.Enabled) {
            Write-Log -Level WARN -Message "Windows Firewall is DISABLED on profile '$($_.Name)' - rules added but not enforced on that profile."
        }
    }

    $count = (Get-NetFirewallRule -Group $script:FwGroup).Count
    Write-Log -Level OK -Message "Firewall rules configured ($count rules in group '$script:FwGroup')."
}

function Remove-FirewallRules {
    $existing = Get-NetFirewallRule -Group $script:FwGroup -ErrorAction SilentlyContinue
    if ($existing) {
        $existing | Remove-NetFirewallRule
        Write-Log -Level OK -Message "Removed $($existing.Count) FlowAccel firewall rules."
    }
}
