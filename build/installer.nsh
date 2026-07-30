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
; The gap it does NOT cover is the per-user -> per-machine transition. Installs
; made by the older perMachine:false build recorded themselves under HKCU, and
; setInstallModePerAllUsers only ever consults HKLM — so every upgrade of one of
; those looked like a fresh install and relocated to Program Files. This adopts
; the HKCU location when HKLM has none.
; Show a progress banner during an update install.
;
; Updates install silently (see electron/ipc/updater.js), which is required:
; installSection.nsh only auto-starts the app itself when ${isForceRun} AND
; ${Silent}, so a non-silent update installs fine and then never reopens Atlas.
; A previous attempt went non-silent to get the NSIS progress page and hand-rolled
; the relaunch here instead — the install worked and the app stayed closed.
;
; Silent means no installer UI at all, though, and the gap between Atlas closing
; and reopening looked like a crash. SpiderBanner is a plugin window rather than
; an installer page, so it can be shown even under /S. oneClick.nsh uses the same
; call for exactly this purpose.
;
; Only for updates: a first-time install already has the full wizard, and a
; banner on top of it would be noise. ${isUpdated} is reliable here — it is what
; makes skipPageIfUpdated suppress the directory page.
;
; InitPluginsDir is required before any plugin call and is safe to repeat;
; installSection.nsh calls it too, but that runs after .onInit.
;
; If the plugin call fails the banner simply does not appear and the update still
; completes normally, which is the pre-existing behaviour.
!macro customInit
  ${If} ${isUpdated}
    InitPluginsDir
    SpiderBanner::Show /MODERN
  ${EndIf}

  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\*.*"
      DetailPrint "Existing per-user installation found at $0 - upgrading in place."
      StrCpy $INSTDIR "$0"
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
