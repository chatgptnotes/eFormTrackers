FlowAccel Installer - Multi-Part Download
==========================================

1. Download every part listed in SHA256SUMS.txt from this folder, plus
   SHA256SUMS.txt itself. Place all files in one folder.

2. Open Command Prompt in that folder and run:

      copy /b FlowAccelInstaller.zip.001 + FlowAccelInstaller.zip.002 + ^
              FlowAccelInstaller.zip.003 + FlowAccelInstaller.zip.004 + ^
              FlowAccelInstaller.zip.005 FlowAccelInstaller.zip

   (Adjust the part count to match the files you downloaded.)

3. Verify (optional):

      certutil -hashfile FlowAccelInstaller.zip SHA256

   Compare to the "merged" line in SHA256SUMS.txt.

4. Right-click FlowAccelInstaller.zip -> Extract All.

5. Inside the extracted folder, run build-installer.bat
   (Inno Setup 6 must be installed).
