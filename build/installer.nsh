; Adopt an existing installation directory.
;
; This has to be customInit, NOT preInit. electron-builder's .onInit runs:
;
;     preInit  ->  check64BitAndSetRegView  ->  initMultiUser  ->  customInit
;
; so a preInit hook is doomed twice over: the 64-bit registry view is not set
; yet, meaning a HKLM read hits the WOW6432Node redirect and finds nothing, and
; initMultiUser then overwrites $INSTDIR regardless of what preInit set. An
; earlier version of this file set $INSTDIR in preInit and the value was
; silently discarded every time.
;
; electron-builder already handles the per-machine case on its own:
; setInstallModePerAllUsers reads HKLM InstallLocation and falls back to
; $PROGRAMFILES64\Atlas, which is exactly the wanted behaviour, so there is no
; preInit macro here at all any more.
;
; The gap it does NOT cover is a mode transition in EITHER direction, and this
; build has now made both:
;
;   * perMachine:false -> true recorded installs under HKCU while
;     setInstallModePerAllUsers only consults HKLM.
;   * perMachine:true -> false (current) is the mirror: those builds recorded
;     under HKLM, and setInstallModePerUser only consults HKCU.
;
; Either way an upgrade of an install from the other era looks like a fresh one
; and relocates — Program Files one way, %LOCALAPPDATA%\Programs the other. So
; adopt a recorded location from whichever hive actually has one that still exists
; on disk, preferring HKLM since a per-machine record is the stronger signal of
; where the app really lives.
;
; Updates from within the app also pass /D=, which overrides this, but a manually
; downloaded installer has no such switch and relies entirely on this.
!macro customInit
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
  ${OrIfNot} ${FileExists} "$0\*.*"
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\*.*"
    DetailPrint "Existing installation found at $0 - upgrading in place."
    StrCpy $INSTDIR "$0"
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
