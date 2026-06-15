; Default install directory — only used when no /D= flag is passed
; (i.e. fresh install). When electron-updater runs the new installer
; it passes /D=<current install path> which NSIS honors automatically.
!macro customInstallDir
  ; Only set default if $INSTDIR wasn't already set by /D= command line flag
  ${If} $INSTDIR == ""
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
