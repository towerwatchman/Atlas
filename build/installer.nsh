; Default install directory for FRESH installs only.
; `preInit` is the hook electron-builder actually invokes (the previous
; `customInstallDir` macro was never called by the template). At this point
; the per-user install mode has already seeded $INSTDIR from the registry
; (for upgrades) or the per-user default (for fresh installs). The NSIS /D=
; switch, when present, overrides $INSTDIR afterward in setInstallModePerUser,
; so passing /D= from electron-updater still wins for in-place updates.
;
; We only override the default when there is no recorded previous install,
; so we don't stomp on an existing installation's location.
!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Atlas"
  ${EndIf}
!macroend

; Preserve data/ and launchers/ folders on update/uninstall
!macro DeleteLoop DIR PREFIX
  FindFirst $0 $1 "${DIR}\*"
  ${PREFIX}loop:
    StrCmp $1 "" ${PREFIX}done
    StrCmp $1 "." ${PREFIX}next
    StrCmp $1 ".." ${PREFIX}next
    StrCmp $1 "data" ${PREFIX}next
    StrCmp $1 "launchers" ${PREFIX}next
    IfFileExists "${DIR}\$1\*.*" 0 ${PREFIX}next
    RMDir /r "${DIR}\$1"
  ${PREFIX}next:
    FindNext $0 $1
    Goto ${PREFIX}loop
  ${PREFIX}done:
    FindClose $0
!macroend

!macro customRemoveFiles
  Delete "$INSTDIR\*.*"
  !insertmacro DeleteLoop "$INSTDIR" "rm"
!macroend

!macro customUnInstall
  Delete "$INSTDIR\*.*"
  !insertmacro DeleteLoop "$INSTDIR" "un"
!macroend
