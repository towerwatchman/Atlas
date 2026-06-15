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