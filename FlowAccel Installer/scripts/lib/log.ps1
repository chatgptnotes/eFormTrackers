# log.ps1 - Timestamped logging helper for FlowAccel installer.
# Dot-source from install.ps1 / uninstall.ps1.
#
# Exposes:
#   Initialize-Log -Path <file>
#   Write-Log -Level INFO|WARN|ERROR|OK|STEP -Message <string>
#   Write-StepHeader -Number <int> -Total <int> -Title <string>
#   Write-Banner -Status OK|WARN|STOP -Message <string>

$script:LogFile = $null

function Initialize-Log {
    param([Parameter(Mandatory)][string]$Path)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $script:LogFile = $Path
    "=== FlowAccel installer log started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" |
        Out-File -FilePath $Path -Encoding utf8 -Append
}

function Write-Log {
    param(
        [ValidateSet('INFO','WARN','ERROR','OK','STEP','DEBUG')][string]$Level = 'INFO',
        [Parameter(Mandatory)][string]$Message
    )
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] [$Level] $Message"

    $color = switch ($Level) {
        'OK'    { 'Green' }
        'WARN'  { 'Yellow' }
        'ERROR' { 'Red' }
        'STEP'  { 'Cyan' }
        'DEBUG' { 'DarkGray' }
        default { 'Gray' }
    }
    Write-Host $line -ForegroundColor $color

    if ($script:LogFile) {
        $line | Out-File -FilePath $script:LogFile -Encoding utf8 -Append
    }
}

function Write-StepHeader {
    param(
        [Parameter(Mandatory)][int]$Number,
        [Parameter(Mandatory)][int]$Total,
        [Parameter(Mandatory)][string]$Title
    )
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor Cyan
    Write-Log -Level STEP -Message ("Step {0} of {1}: {2}" -f $Number, $Total, $Title)
    Write-Host ("=" * 72) -ForegroundColor Cyan
}

function Write-Banner {
    param(
        [ValidateSet('OK','WARN','STOP')][string]$Status,
        [Parameter(Mandatory)][string]$Message
    )
    $glyph = switch ($Status) { 'OK' {'[OK]'} 'WARN' {'[!!]'} 'STOP' {'[XX]'} }
    $color = switch ($Status) { 'OK' {'Green'} 'WARN' {'Yellow'} 'STOP' {'Red'} }
    Write-Host ""
    Write-Host "$glyph  $Message" -ForegroundColor $color
    Write-Host ""
    if ($script:LogFile) {
        "[BANNER $Status] $Message" | Out-File -FilePath $script:LogFile -Encoding utf8 -Append
    }
}
