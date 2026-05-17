; FlowAccel.iss - Inno Setup 6.x script for FlowAccel self-contained installer.
;
; Compile with:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" FlowAccel.iss
;
; Produces output/FlowAccel-Setup-1.0.exe

#define MyAppName        "FlowAccel"
#define MyAppVersion     "1.0.0"
#define MyAppPublisher   "FlowAccel"
#define MyAppURL         "https://flowaccel.local/"
#define MyAppExeName     "FlowAccel-Setup-1.0.exe"

[Setup]
AppId={{9C5F2D6E-7B41-4F2B-A7E0-9E1F0D5C1B92}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName=C:\inetpub\flowaccel
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=output
OutputBaseFilename=FlowAccel-Setup-1.0
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
WizardStyle=modern
SetupLogging=yes
UninstallDisplayIcon={app}\dist\favicon.ico
; Code-signing (configure your signtool path before compiling).
; SignTool=signtool
; SignedUninstaller=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; ---------- Third-party installer payloads (verified by SHA256SUMS) ----------
Source: "payload\installers\VC_redist.x64.exe";                Flags: dontcopy
Source: "payload\installers\node-v18.20.4-x64.msi";             Flags: dontcopy
Source: "payload\installers\postgresql-15.8-1-windows-x64.exe"; Flags: dontcopy
Source: "payload\installers\rewrite_amd64_en-US.msi";           Flags: dontcopy
Source: "payload\installers\requestRouter_amd64.msi";           Flags: dontcopy
Source: "payload\installers\nssm-2.24.zip";                     Flags: dontcopy
Source: "payload\installers\SHA256SUMS.txt";                    Flags: dontcopy

; ---------- App payload extracted to the install dir ----------
Source: "payload\app\*";       DestDir: "{app}\_payload\app";       Flags: recursesubdirs createallsubdirs ignoreversion
Source: "scripts\*";           DestDir: "{app}\_payload\scripts";   Flags: recursesubdirs createallsubdirs ignoreversion
Source: "config\config.template.json"; DestDir: "{app}\_payload\config"; Flags: ignoreversion
Source: "docs\*";              DestDir: "{app}\_payload\docs";      Flags: recursesubdirs ignoreversion

; ---------- Payload installers extracted on demand by [Code] ExtractTemporaryFile ----------

[Dirs]
Name: "{app}\logs"
Name: "{app}\uploads\avatars"
Name: "{app}\uploads\signatures"

[Run]
Filename: "powershell.exe"; \
    Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\_payload\scripts\install.ps1"" -ConfigPath ""{app}\config.json"""; \
    StatusMsg: "Installing FlowAccel (this may take 10-15 minutes)..."; \
    Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
    Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\_payload\scripts\uninstall.ps1"" -ConfigPath ""{app}\config.json"" -Silent -KeepData"; \
    RunOnceId: "FlowAccelUninstall"; \
    Flags: runhidden waituntilterminated

[Code]
var
  PageNet:    TInputQueryWizardPage;
  PageDb:     TInputQueryWizardPage;
  PageJot:    TInputQueryWizardPage;
  PageMs:     TInputQueryWizardPage;
  PageCert:   TInputQueryWizardPage;
  PageDryRun: TOutputMsgWizardPage;
  ServerIPDefault: string;

function GetDefaultServerIP(Param: string): string;
var
  ResultCode: Integer;
  TmpFile: string;
  Lines: TStringList;
begin
  Result := '127.0.0.1';
  TmpFile := ExpandConstant('{tmp}\detect-ip.txt');
  Exec('powershell.exe',
       '-NoProfile -Command "$ip = (Get-NetIPAddress -AddressFamily IPv4 | ' +
       'Where-Object { $_.IPAddress -ne ''127.0.0.1'' -and $_.PrefixOrigin -ne ''WellKnown'' } | ' +
       'Select-Object -First 1 -ExpandProperty IPAddress); ' +
       'if ($ip) { Set-Content -Path ''' + TmpFile + ''' -Value $ip -Encoding ASCII }"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if FileExists(TmpFile) then begin
    Lines := TStringList.Create;
    try
      Lines.LoadFromFile(TmpFile);
      if Lines.Count > 0 then Result := Trim(Lines[0]);
    finally
      Lines.Free;
    end;
  end;
end;

function GetTickCount: DWORD;
  external 'GetTickCount@kernel32.dll stdcall';

function GenerateRandomPassword(Len: Integer): string;
var
  i, Idx: Integer;
  Chars: string;
  Tick: DWORD;
begin
  Chars := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  Result := '';
  Tick := GetTickCount;
  for i := 1 to Len do begin
    Tick := (Tick * 1103515245 + 12345) and $7FFFFFFF;
    Idx := (Tick mod Length(Chars)) + 1;
    Result := Result + Chars[Idx];
  end;
end;

procedure InitializeWizard;
begin
  ServerIPDefault := GetDefaultServerIP('');

  // Page: Network
  PageNet := CreateInputQueryPage(wpSelectDir,
    'Network settings',
    'Where will users reach this server?',
    'Enter the IP address or hostname users will use to reach FlowAccel.');
  PageNet.Add('Server IP / hostname:', False);
  PageNet.Add('HTTP port (usually 80):', False);
  PageNet.Add('HTTPS port (usually 443):', False);
  PageNet.Values[0] := ServerIPDefault;
  PageNet.Values[1] := '80';
  PageNet.Values[2] := '443';

  // Page: Database
  PageDb := CreateInputQueryPage(PageNet.ID,
    'PostgreSQL passwords',
    'Choose strong passwords for the database',
    'PostgreSQL will be installed automatically. These passwords are used internally; the application database is never exposed to the network.');
  PageDb.Add('Postgres superuser password (min 12 chars):', True);
  PageDb.Add('Application DB password (auto-generated, change if you want):', True);
  PageDb.Values[1] := GenerateRandomPassword(24);

  // Page: JotForm
  PageJot := CreateInputQueryPage(PageDb.ID,
    'JotForm integration (optional)',
    'Connect to JotForm Enterprise',
    'Leave blank to skip - you can configure later by editing backend\.env.');
  PageJot.Add('JotForm API key:', False);
  PageJot.Add('JotForm Team ID:', False);
  PageJot.Add('JotForm API base URL:', False);
  PageJot.Add('JotForm host URL:', False);
  PageJot.Values[2] := 'https://eforms.mediaoffice.ae/API';
  PageJot.Values[3] := 'https://eforms.mediaoffice.ae';

  // Page: Microsoft OAuth
  PageMs := CreateInputQueryPage(PageJot.ID,
    'Microsoft Sign-In (optional)',
    'Azure AD / Entra ID single sign-on',
    'Leave blank to skip.');
  PageMs.Add('Client ID:', False);
  PageMs.Add('Tenant ID:', False);
  PageMs.Add('Client secret:', True);

  // Page: Cert strategy
  PageCert := CreateInputQueryPage(PageMs.ID,
    'HTTPS certificate',
    'Choose a certificate strategy for this server',
    'Default is recommended: a self-signed Root CA so cert renewals are automatic for trusted clients. To use an existing PFX (DigiCert, internal ADCS, etc.), put the full path below and set strategy to ImportPFX.');
  PageCert.Add('Strategy (SelfSignedCA | ImportPFX | Skip):', False);
  PageCert.Add('PFX file path (if ImportPFX):', False);
  PageCert.Add('PFX password (if ImportPFX):', True);
  PageCert.Add('Extra SANs (comma-separated DNS names / IPs):', False);
  PageCert.Values[0] := 'SelfSignedCA';

  // Dry-run preview page
  PageDryRun := CreateOutputMsgPage(PageCert.ID,
    'Ready to install',
    'The installer will now run 25 steps to set up FlowAccel.',
    'Click Next to proceed. If anything goes wrong, the install log will be saved to '#13#10 +
    '{app}\logs\install-<timestamp>.log so you can diagnose. Click Back to change any setting.');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PgPwd: string;
begin
  Result := True;
  if CurPageID = PageDb.ID then begin
    PgPwd := Trim(PageDb.Values[0]);
    if Length(PgPwd) < 12 then begin
      MsgBox('PostgreSQL superuser password must be at least 12 characters.', mbError, MB_OK);
      Result := False;
      exit;
    end;
    if Length(Trim(PageDb.Values[1])) < 12 then begin
      MsgBox('Application DB password must be at least 12 characters.', mbError, MB_OK);
      Result := False;
      exit;
    end;
  end;
end;

function JsonEscape(S: string): string;
begin
  Result := S;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
  StringChangeEx(Result, #13, '\r', True);
  StringChangeEx(Result, #10, '\n', True);
end;

procedure WriteConfigJson;
var
  J: TStringList;
  Path: string;
  CertCN: string;
begin
  J := TStringList.Create;
  try
    CertCN := Trim(PageNet.Values[0]);
    J.Add('{');
    J.Add('  "InstallDir": "'           + JsonEscape(ExpandConstant('{app}')) + '",');
    J.Add('  "ServerIP": "'             + JsonEscape(PageNet.Values[0]) + '",');
    J.Add('  "HttpPort": '              + PageNet.Values[1] + ',');
    J.Add('  "HttpsPort": '             + PageNet.Values[2] + ',');
    J.Add('  "BackendPort": 3001,');
    J.Add('  "PgPort": 5432,');
    J.Add('  "DbName": "jotflow",');
    J.Add('  "DbUser": "jotflow",');
    J.Add('  "PgSuperPassword": "'      + JsonEscape(PageDb.Values[0]) + '",');
    J.Add('  "AppDbPassword": "'        + JsonEscape(PageDb.Values[1]) + '",');
    J.Add('  "SessionSecret": "",');
    J.Add('  "JotformApiKey": "'        + JsonEscape(PageJot.Values[0]) + '",');
    J.Add('  "JotformTeamId": "'        + JsonEscape(PageJot.Values[1]) + '",');
    J.Add('  "JotformBase": "'          + JsonEscape(PageJot.Values[2]) + '",');
    J.Add('  "JotformHost": "'          + JsonEscape(PageJot.Values[3]) + '",');
    J.Add('  "JotformWebhookSecret": "",');
    J.Add('  "MicrosoftClientId": "'    + JsonEscape(PageMs.Values[0]) + '",');
    J.Add('  "MicrosoftTenantId": "'    + JsonEscape(PageMs.Values[1]) + '",');
    J.Add('  "MicrosoftClientSecret": "'+ JsonEscape(PageMs.Values[2]) + '",');
    J.Add('  "MicrosoftRedirectUri": "https://' + JsonEscape(PageNet.Values[0]) + '/api/auth/microsoft/callback",');
    J.Add('  "CertStrategy": "'         + JsonEscape(PageCert.Values[0]) + '",');
    J.Add('  "PfxPath": "'              + JsonEscape(PageCert.Values[1]) + '",');
    J.Add('  "PfxPassword": "'          + JsonEscape(PageCert.Values[2]) + '",');
    J.Add('  "CertCN": "'               + JsonEscape(CertCN) + '",');
    J.Add('  "CertExtraSANs": "'        + JsonEscape(PageCert.Values[3]) + '",');
    J.Add('  "AllowIcmp": true');
    J.Add('}');

    Path := ExpandConstant('{app}\config.json');
    ForceDirectories(ExpandConstant('{app}'));
    J.SaveToFile(Path);
  finally
    J.Free;
  end;
end;

procedure ExtractInstallerPayloads;
var
  InstallersDir: string;
begin
  InstallersDir := ExpandConstant('{app}\_payload\installers');
  ForceDirectories(InstallersDir);
  ExtractTemporaryFile('VC_redist.x64.exe');
  ExtractTemporaryFile('node-v18.20.4-x64.msi');
  ExtractTemporaryFile('postgresql-15.8-1-windows-x64.exe');
  ExtractTemporaryFile('rewrite_amd64_en-US.msi');
  ExtractTemporaryFile('requestRouter_amd64.msi');
  ExtractTemporaryFile('nssm-2.24.zip');
  ExtractTemporaryFile('SHA256SUMS.txt');
  FileCopy(ExpandConstant('{tmp}\VC_redist.x64.exe'),                InstallersDir + '\VC_redist.x64.exe', False);
  FileCopy(ExpandConstant('{tmp}\node-v18.20.4-x64.msi'),             InstallersDir + '\node-v18.20.4-x64.msi', False);
  FileCopy(ExpandConstant('{tmp}\postgresql-15.8-1-windows-x64.exe'), InstallersDir + '\postgresql-15.8-1-windows-x64.exe', False);
  FileCopy(ExpandConstant('{tmp}\rewrite_amd64_en-US.msi'),           InstallersDir + '\rewrite_amd64_en-US.msi', False);
  FileCopy(ExpandConstant('{tmp}\requestRouter_amd64.msi'),           InstallersDir + '\requestRouter_amd64.msi', False);
  FileCopy(ExpandConstant('{tmp}\nssm-2.24.zip'),                     InstallersDir + '\nssm-2.24.zip', False);
  FileCopy(ExpandConstant('{tmp}\SHA256SUMS.txt'),                    InstallersDir + '\SHA256SUMS.txt', False);
end;

function VerifyPayloadChecksums: Boolean;
var
  ResultCode: Integer;
  Cmd: string;
begin
  Cmd := '-NoProfile -ExecutionPolicy Bypass -Command "' +
         '$d=Join-Path ''' + ExpandConstant('{app}\_payload\installers') + ''' ''SHA256SUMS.txt''; ' +
         'if (-not (Test-Path $d)) { exit 1 }; ' +
         '$bad=$false; Get-Content $d | ForEach-Object { ' +
         '  $p=$_ -split ''\s+'',2; if ($p.Count -lt 2) { return }; ' +
         '  $f=Join-Path ''' + ExpandConstant('{app}\_payload\installers') + ''' $p[1]; ' +
         '  if (-not (Test-Path $f)) { $bad=$true; return }; ' +
         '  $h=(Get-FileHash $f -Algorithm SHA256).Hash; ' +
         '  if ($h -ne $p[0].ToUpper()) { $bad=$true } }; ' +
         'if ($bad) { exit 2 } else { exit 0 }"';
  Exec('powershell.exe', Cmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := (ResultCode = 0);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    WriteConfigJson;
    ExtractInstallerPayloads;
    if not VerifyPayloadChecksums then begin
      MsgBox('Installer payload integrity check FAILED. Do not proceed - the installer file may be corrupt or tampered with. Re-download from the official source.',
             mbCriticalError, MB_OK);
      Abort;
    end;
  end;
end;
