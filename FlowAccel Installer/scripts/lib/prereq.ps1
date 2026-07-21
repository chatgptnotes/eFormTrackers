# prereq.ps1 - Step 0: Pre-flight checks.
# Requires log.ps1 already dot-sourced.

function Test-IsAdministrator {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WindowsBuildOK {
    $ver = [System.Environment]::OSVersion.Version
    # Windows 10 = 10.0.10240+, Server 2016 = 10.0.14393+
    return ($ver.Major -ge 10)
}

function Get-FreeSpaceGB {
    param([string]$Drive = 'C:')
    $d = Get-PSDrive -Name ($Drive.TrimEnd(':'))
    return [math]::Round($d.Free / 1GB, 1)
}

function Test-IsServerSKU {
    $os = Get-CimInstance Win32_OperatingSystem
    # ProductType: 1=Workstation, 2=DC, 3=Server
    return ($os.ProductType -ne 1)
}

function Invoke-PreflightChecks {
    param(
        [int]$MinDiskGB = 10,
        [string]$Drive = 'C:'
    )
    Write-StepHeader -Number 0 -Total 25 -Title 'Pre-flight checks'

    $issues = @()

    if (-not (Test-IsAdministrator)) {
        $issues += 'Installer is not running as Administrator. Right-click the installer and choose "Run as administrator".'
    } else {
        Write-Log -Level OK -Message 'Running with Administrator privileges.'
    }

    $osCaption = (Get-CimInstance Win32_OperatingSystem).Caption
    if (-not (Get-WindowsBuildOK)) {
        $issues += 'Windows 10 / Windows Server 2016 or newer is required.'
    } elseif ($osCaption -match 'Home') {
        # Windows Home has no IIS - the install would fail confusingly mid-way.
        # AWS/Azure/GCP Windows Server and Win 10/11 Pro are all fine.
        $issues += "This edition ($osCaption) does not include IIS, which FlowAccel requires. Use Windows 10/11 Pro or Windows Server 2016+ (e.g. a standard AWS Windows Server AMI)."
    } else {
        Write-Log -Level OK -Message "OS supported: $osCaption"
    }

    # 64-bit only (the bundled binaries and Node MSI are x64).
    if (-not [Environment]::Is64BitOperatingSystem) {
        $issues += 'A 64-bit (x64) edition of Windows is required.'
    }

    $free = Get-FreeSpaceGB -Drive $Drive
    if ($free -lt $MinDiskGB) {
        $issues += "Insufficient free disk space on $Drive ($free GB free, need $MinDiskGB GB)."
    } else {
        Write-Log -Level OK -Message "Disk space OK: $free GB free on $Drive"
    }

    if ($issues.Count -gt 0) {
        foreach ($i in $issues) { Write-Banner -Status STOP -Message $i }
        throw 'Pre-flight checks failed.'
    }

    Write-Banner -Status OK -Message 'All pre-flight checks passed.'
}
