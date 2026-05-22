# FlowAccel-Setup-1.0.4.exe - chunked download

GitHub rejects single files larger than 100 MB, so the 396 MB FlowAccel
installer is shipped here as a ZIP split into 90 MB chunks. Reassemble them into
`FlowAccel-Setup-1.0.4.exe` before running.

## Files

| File | Size |
|------|------|
| `FlowAccel-Setup-1.0.4.zip.00.part` | 90 MB |
| `FlowAccel-Setup-1.0.4.zip.01.part` | 90 MB |
| `FlowAccel-Setup-1.0.4.zip.02.part` | 90 MB |
| `FlowAccel-Setup-1.0.4.zip.03.part` | 90 MB |
| `FlowAccel-Setup-1.0.4.zip.04.part` | 36 MB |

## Checksums (SHA-256)

```
zip : E30E4BB000AABC6CFFD52C0B569C6C1407ED53EEC3D68FEB5DAFC4A4D4D7F6AB  FlowAccel-Setup-1.0.4.zip
exe : 0CAC23693A42E1DC269C2BF4FC72D899DB572AB37C93A97735393C28E780BB40  FlowAccel-Setup-1.0.4.exe
```

## Reassemble

### Windows (PowerShell)

```powershell
.\reassemble.ps1
```

Or manually:

```powershell
cmd /c copy /b "FlowAccel-Setup-1.0.4.zip.00.part+FlowAccel-Setup-1.0.4.zip.01.part+FlowAccel-Setup-1.0.4.zip.02.part+FlowAccel-Setup-1.0.4.zip.03.part+FlowAccel-Setup-1.0.4.zip.04.part" "FlowAccel-Setup-1.0.4.zip"
Expand-Archive -Path "FlowAccel-Setup-1.0.4.zip" -DestinationPath . -Force
(Get-FileHash "FlowAccel-Setup-1.0.4.exe" -Algorithm SHA256).Hash   # must equal the exe checksum above
```

### macOS / Linux

```bash
./reassemble.sh
# or manually:
cat FlowAccel-Setup-1.0.4.zip.*.part > FlowAccel-Setup-1.0.4.zip
unzip -o FlowAccel-Setup-1.0.4.zip
shasum -a 256 FlowAccel-Setup-1.0.4.exe   # must equal the exe checksum above
```

## What changed in 1.0.4

- **Visible install:** the dependency install + build now streams live in a
  console window (no more silent `runhidden`); errors appear in red as they happen.
- **Abort + rollback on dependency failure:** if a mandatory dependency (VC++,
  IIS, URL Rewrite, ARR, Node, PostgreSQL, DB) fails, the installer aborts,
  prints the exact reason, rolls back its own changes (service, IIS site/pool,
  firewall rules, and the DB/role if this run created it), and exits non-zero.
  Shared runtimes are left installed so a fixed re-run is fast.
- **Logs as a web directory:** all install + service logs are browsable at
  `http://<host>/logs/` after install.
- **Finish screen** shows the localhost URL, the install directory, and the logs
  URL.
