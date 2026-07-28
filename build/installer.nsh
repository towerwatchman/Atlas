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
  ; An existing install is upgraded WHERE IT ALREADY LIVES. HKLM is checked first
  ; (per-machine installs) then HKCU, because installs made by the older
  ; per-user build recorded themselves there — switching to perMachine made
  ; electron-builder look only in HKLM, find nothing, and silently relocate every
  ; upgrade to Program Files.
  ;
  ; The previous version of this macro read the location into $0 and then never
  ; copied it into $INSTDIR, so the value was found and discarded.
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\*.*"
    StrCpy $INSTDIR "$0"
  ${Else}
    ; Nothing installed: default to Program Files, like most desktop software.
    ${If} ${RunningX64}
      StrCpy $INSTDIR "$PROGRAMFILES64\Atlas"
    ${Else}
      StrCpy $INSTDIR "$PROGRAMFILES\Atlas"
    ${EndIf}
  ${EndIf}
!macroend

; Atlas keeps its database, cache and artwork in <installDir>\data. Program Files
; is not user-writable, so grant the local Users group modify rights on that ONE
; subfolder while we still hold the installer's elevated token. The app then runs
; unelevated for the rest of its life.
;
; This matters for security: Atlas launches game executables, and a child process
; inherits its parent's elevation. A permanently elevated Atlas would run every
; game it launches as administrator.
;
; The grant is scoped to data\ and launchers\ and never to $INSTDIR itself, which
; holds Atlas.exe — a user-writable folder containing executables that something
; elevated later runs is a privilege-escalation route.
;
; S-1-5-32-545 is the well-known SID for the local Users group; the name is
; localised ("Benutzer", "Utilisateurs") so a name-based grant fails outside
; English Windows. (OI)(CI) makes the grant inherit to files and subfolders.
!macro customInstall
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\launchers"
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\data" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\launchers" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q'
  Pop $1
  ${If} $0 != 0
    DetailPrint "Warning: could not grant write access to $INSTDIR\data (icacls returned $0)."
    DetailPrint "Atlas will offer to repair this on first run."
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
