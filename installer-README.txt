FlowAccel Server Installer (Windows) - Multi-Part Download
===========================================================

1. Download every FlowAccel-Setup-1.0.exe.NNN listed in SHA256SUMS.txt
   from this folder, plus SHA256SUMS.txt itself. Place all files in
   one folder (your browser may auto-download all of them after a
   single "Allow multiple downloads" prompt).

2. Open Command Prompt in that folder and run:

      copy /b FlowAccel-Setup-1.0.exe.001 + FlowAccel-Setup-1.0.exe.002 + ^
              FlowAccel-Setup-1.0.exe.003 + FlowAccel-Setup-1.0.exe.004 + ^
              FlowAccel-Setup-1.0.exe.005 FlowAccel-Setup-1.0.exe

   (Adjust the part count to match the files you downloaded.)

3. Verify (optional):

      certutil -hashfile FlowAccel-Setup-1.0.exe SHA256

   Compare the result to the "merged" line in SHA256SUMS.txt.

4. Right-click FlowAccel-Setup-1.0.exe and Run as administrator. The
   setup wizard installs Node 18, PostgreSQL 15, IIS URL Rewrite,
   IIS Application Request Routing, NSSM, and FlowAccel itself.

No Inno Setup, Node, or 7-Zip is required on your machine - the
installer is self-contained.
