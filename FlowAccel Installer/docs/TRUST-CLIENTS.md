# Distributing the FlowAccel Root CA to LAN Clients

Once installed, the FlowAccel server uses HTTPS with an internal Certificate
Authority. To make browsers and command-line tools trust that CA on every
client machine, distribute `FlowAccel-RootCA.cer` once. After that, all future
certificate rotations on the server are trusted automatically — clients need
no further action.

Thumbprint of your installation's Root CA is recorded at:
`<InstallDir>\.rootca-thumbprint`
and printed on the installer's final page. Verify out-of-band before trusting.

---

## Distribution Channels

| Channel | Best for | Effort |
|---|---|---|
| A. One-click `.bat` | Individual Windows users | 10 seconds per machine |
| B. PowerShell one-liner | Power users, scripted onboarding | 5 seconds per machine |
| C. Group Policy (GPO) | Domain-joined fleets | Once per OU |
| D. Bring-your-own PFX (ADCS) | Enterprises with existing PKI | Zero (skip whole flow) |
| E. macOS / Linux / iOS / Android | Heterogeneous fleets | Per-OS, 1 min each |

All five channels use the same `FlowAccel-RootCA.cer` file published at:

    http://<server-ip>/trust-flowaccel/

(Note: HTTP, not HTTPS — clients cannot validate HTTPS until they trust the CA.)

---

### Channel A — One-Click Windows Batch

1. Browse to `http://<server-ip>/trust-flowaccel/` on the client.
2. Download `install-trust.bat`.
3. Double-click. Click Yes on the UAC prompt.
4. Success message includes the thumbprint — compare against the value
   printed by the installer.

### Channel B — PowerShell One-Liner

Open elevated PowerShell:

    iwr http://<server-ip>/trust-flowaccel/install-trust.ps1 -UseBasicParsing | iex

### Channel C — Group Policy (recommended for domains)

1. Save `FlowAccel-RootCA.cer` to a network share readable by all DCs.
2. Open *Group Policy Management Editor*.
3. Navigate to:
   `Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities`
4. Right-click → *Import...* → select the `.cer` file.
5. Link the GPO to the OU(s) containing your client machines.
6. On a client: `gpupdate /force`, then verify with:
   `certutil -store Root FlowAccel-LAN-RootCA`

### Channel D — Bring Your Own PFX (skip self-signed entirely)

At install time, choose `CertStrategy = ImportPFX` on the *HTTPS Certificate*
wizard page and supply a PFX issued by your enterprise CA (Active Directory
Certificate Services, DigiCert, Sectigo). The installer skips Root-CA
generation entirely; every domain-joined machine trusts the cert automatically
because they already trust the issuing CA.

### Channel E — Non-Windows clients

**macOS:**

    sudo security add-trusted-cert -d -r trustRoot \
        -k /Library/Keychains/System.keychain FlowAccel-RootCA.cer

**Debian/Ubuntu:**

    sudo cp FlowAccel-RootCA.cer /usr/local/share/ca-certificates/FlowAccel-RootCA.crt
    sudo update-ca-certificates

**RHEL/CentOS/Fedora:**

    sudo cp FlowAccel-RootCA.cer /etc/pki/ca-trust/source/anchors/
    sudo update-ca-trust

**iOS:** email the `.cer` to yourself, open in Mail, install the profile, then
`Settings → General → About → Certificate Trust Settings → enable "FlowAccel-LAN-RootCA"`.

**Android:** `Settings → Security → Encryption & credentials → Install a certificate → CA certificate`.

---

## Verifying the Right Certificate

After import, run on Windows:

    certutil -store Root FlowAccel-LAN-RootCA

The output should include a `Cert Hash(sha1)` line matching the thumbprint
your installer printed and the value in `<InstallDir>\.rootca-thumbprint`.
If they differ, **stop** — the `.cer` file may have been intercepted on the
LAN. Re-download by RDP'ing directly to the server.

---

## Rotating the Server Leaf Cert (no client action needed)

The leaf cert (the one bound to IIS:443) expires every 2 years. To rotate:

    PowerShell -ExecutionPolicy Bypass -File `
        "<InstallDir>\_payload\scripts\lib\ssl.ps1"
    # then in interactive PowerShell:
    . "<InstallDir>\_payload\scripts\lib\ssl.ps1"
    . "<InstallDir>\_payload\scripts\lib\log.ps1"
    Initialize-Log -Path "<InstallDir>\logs\rotate.log"
    $ca = Get-RootCA
    $cert = New-LeafCertificate -RootCA $ca -CN "<ServerIP>"
    Set-IISHttpsBinding -SiteName FlowAccel -Cert $cert -Port 443

Because the new leaf is signed by the same Root CA that clients already trust,
no client-side action is needed. IIS picks up the new binding immediately.

---

## Removing Trust on a Client

**Windows:**

    certutil -delstore Root "FlowAccel-LAN-RootCA"

**macOS:**

    sudo security delete-certificate -c "FlowAccel-LAN-RootCA" \
        /Library/Keychains/System.keychain

**Linux:** remove the file you placed in `/usr/local/share/ca-certificates/`
(Debian) or `/etc/pki/ca-trust/source/anchors/` (RHEL), then re-run
`update-ca-certificates` / `update-ca-trust`.
