!define OPENCHAMBER_INSTALL_DIR_NAME "OpenChamber"

!ifndef BUILD_UNINSTALLER
Function OpenChamberNormalizeInstallDirectory
  StrCpy $0 "$INSTDIR"

  loop_trim_trailing_slash:
    StrLen $1 "$0"
    IntCmp $1 3 done_trim_trailing_slash
    StrCpy $2 "$0" 1 -1
    StrCmp "$2" "\" 0 done_trim_trailing_slash
    StrCpy $0 "$0" -1
    Goto loop_trim_trailing_slash

  done_trim_trailing_slash:
    StrCpy $INSTDIR "$0"

    StrCpy $1 "$INSTDIR" 12 -12
    StrCmp "$1" "\${OPENCHAMBER_INSTALL_DIR_NAME}" done_normalize_install_directory

    StrCmp "$INSTDIR" "${OPENCHAMBER_INSTALL_DIR_NAME}" done_normalize_install_directory

    StrCpy $1 "$INSTDIR" 1 -1
    StrCmp "$1" "\" 0 append_with_separator
      StrCpy $INSTDIR "$INSTDIR${OPENCHAMBER_INSTALL_DIR_NAME}"
      Goto done_normalize_install_directory

    append_with_separator:
      StrCpy $INSTDIR "$INSTDIR\${OPENCHAMBER_INSTALL_DIR_NAME}"

  done_normalize_install_directory:
FunctionEnd

Function OpenChamberDirectoryLeave
  Call OpenChamberNormalizeInstallDirectory
FunctionEnd

!define MUI_PAGE_CUSTOMFUNCTION_LEAVE OpenChamberDirectoryLeave
!endif
