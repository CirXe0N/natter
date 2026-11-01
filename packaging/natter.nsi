; Per-user installer for the Windows desktop build. packaging/windows.sh runs
; it with -DVERSION, -DEXE (the built natter.exe), -DLICENSES and -DOUT (the installer).
; Installing per user, without admin rights, lets the updater replace natter.exe.
Unicode true
Name "Natter"
OutFile "${OUT}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Natter"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Natter"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section
  SetOutPath "$INSTDIR"
  File "/oname=natter.exe" "${EXE}"
  File "/oname=THIRD_PARTY_LICENSES.txt" "${LICENSES}"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortCut "$SMPROGRAMS\Natter.lnk" "$INSTDIR\natter.exe"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "Natter"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "CirXe0N"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\natter.exe"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\uninstall.exe"'
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\natter.exe"
  Delete "$INSTDIR\THIRD_PARTY_LICENSES.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Natter.lnk"
  DeleteRegKey HKCU "${UNINST}"
SectionEnd
