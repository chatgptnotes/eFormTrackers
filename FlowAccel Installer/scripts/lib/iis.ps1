# iis.ps1 - Step 2b: Ensure IIS + required features installed.

$script:IISFeaturesWin = @(
    'IIS-WebServerRole','IIS-WebServer','IIS-CommonHttpFeatures','IIS-StaticContent',
    'IIS-DefaultDocument','IIS-HttpErrors','IIS-RequestFiltering','IIS-WebSockets',
    'IIS-HttpRedirect','IIS-ApplicationInit','IIS-ManagementConsole','IIS-ManagementScriptingTools'
)

$script:IISFeaturesServer = @(
    'Web-Server','Web-WebServer','Web-Common-Http','Web-Static-Content',
    'Web-Default-Doc','Web-Http-Errors','Web-Filtering','Web-WebSockets',
    'Web-Http-Redirect','Web-AppInit','Web-Mgmt-Console','Web-Scripting-Tools'
)

function Test-IISFeaturesEnabled {
    if (Test-IsServerSKU) {
        $missing = @()
        foreach ($f in $script:IISFeaturesServer) {
            $st = Get-WindowsFeature -Name $f -ErrorAction SilentlyContinue
            if (-not $st -or -not $st.Installed) { $missing += $f }
        }
        return ($missing.Count -eq 0)
    } else {
        $missing = @()
        foreach ($f in $script:IISFeaturesWin) {
            $st = Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction SilentlyContinue
            if (-not $st -or $st.State -ne 'Enabled') { $missing += $f }
        }
        return ($missing.Count -eq 0)
    }
}

function Install-IISFeatures {
    Write-StepHeader -Number 2 -Total 25 -Title 'Installing IIS web server features'

    if (Test-IISFeaturesEnabled) {
        Write-Log -Level OK -Message 'All IIS features already enabled; skipping.'
        return @{ RestartRequired = $false }
    }

    $restart = $false
    if (Test-IsServerSKU) {
        Write-Log -Level INFO -Message 'Server SKU detected; using Install-WindowsFeature.'
        $r = Install-WindowsFeature -Name $script:IISFeaturesServer -IncludeManagementTools -ErrorAction Stop
        $restart = [bool]$r.RestartNeeded
    } else {
        Write-Log -Level INFO -Message 'Client SKU detected; using Enable-WindowsOptionalFeature.'
        $r = Enable-WindowsOptionalFeature -Online -FeatureName $script:IISFeaturesWin -NoRestart -All -ErrorAction Stop
        $restart = [bool]$r.RestartNeeded
    }

    if ($restart) {
        Write-Banner -Status WARN -Message 'Windows requests a reboot to finish installing IIS. Re-run the installer after the reboot to resume.'
    } else {
        Write-Banner -Status OK -Message 'IIS features installed.'
    }
    return @{ RestartRequired = $restart }
}

function Enable-ARRProxy {
    Write-StepHeader -Number 5 -Total 25 -Title 'Enabling ARR reverse-proxy mode'
    $appcmd = Join-Path $env:SystemRoot 'system32\inetsrv\appcmd.exe'
    if (-not (Test-Path $appcmd)) {
        throw 'appcmd.exe not found - IIS may not be installed.'
    }
    $current = & $appcmd list config -section:system.webServer/proxy 2>$null
    if ($current -match 'enabled="true"') {
        Write-Log -Level OK -Message 'ARR proxy already enabled; skipping.'
        return
    }
    & $appcmd set config -section:system.webServer/proxy /enabled:true /commit:apphost | Out-Null
    Write-Log -Level OK -Message 'ARR proxy enabled.'
}

function Add-AllowedServerVariable {
    param([string]$Name = 'HTTP_X_FORWARDED_PROTO')
    Write-StepHeader -Number 6 -Total 25 -Title "Allowing IIS rewrite server variable '$Name'"
    Import-Module WebAdministration -ErrorAction Stop
    $existing = Get-WebConfiguration -Filter "/system.webServer/rewrite/allowedServerVariables/add[@name='$Name']" -PSPath 'MACHINE/WEBROOT/APPHOST'
    if ($existing) {
        Write-Log -Level OK -Message "Server variable '$Name' already allowed; skipping."
        return
    }
    Add-WebConfiguration -Filter '/system.webServer/rewrite/allowedServerVariables' `
        -PSPath 'MACHINE/WEBROOT/APPHOST' `
        -AtIndex 0 `
        -Value @{ name = $Name }
    Write-Log -Level OK -Message "Server variable '$Name' added to allowed list."
}

function Install-VCRedist {
    param([Parameter(Mandatory)][string]$InstallerPath)
    Write-StepHeader -Number 2 -Total 25 -Title 'Installing Visual C++ Runtime (required by PostgreSQL)'
    $key = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
    if (Test-Path $key) {
        $ver = (Get-ItemProperty $key -ErrorAction SilentlyContinue).Version
        if ($ver -and ([Version]($ver.TrimStart('v')) -ge [Version]'14.30')) {
            Write-Log -Level OK -Message "VC++ Redist $ver already installed; skipping."
            return
        }
    }
    if (-not (Test-Path $InstallerPath)) { throw "VC++ installer not found: $InstallerPath" }
    Write-Log -Level INFO -Message 'Running VC_redist.x64.exe /install /quiet /norestart...'
    $p = Start-Process -FilePath $InstallerPath -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
        throw "VC++ install failed with exit code $($p.ExitCode)."
    }
    Write-Log -Level OK -Message 'VC++ Redistributable installed.'
}

function Install-IISModule {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$RegistryKey,
        [Parameter(Mandatory)][string]$MsiPath,
        [int]$Step
    )
    Write-StepHeader -Number $Step -Total 25 -Title "Installing $Name"
    if (Test-Path $RegistryKey) {
        Write-Log -Level OK -Message "$Name already installed; skipping."
        return
    }
    if (-not (Test-Path $MsiPath)) { throw "$Name installer not found: $MsiPath" }
    $log = Join-Path $env:TEMP "flowaccel-msi-$([guid]::NewGuid()).log"
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/i `"$MsiPath`" /qn /norestart /l*v `"$log`"" -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
        throw "$Name install failed with exit code $($p.ExitCode). See $log"
    }
    Write-Log -Level OK -Message "$Name installed."
}
