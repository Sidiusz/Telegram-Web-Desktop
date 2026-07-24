; Register the tg:// URL protocol at install time so browser "open in Telegram"
; links reach this app even before it is first launched. Runtime
; setAsDefaultProtocolClient re-asserts it, but install-time makes it reliable.
!macro customInstall
  DetailPrint "Registering tg:// protocol"
  WriteRegStr HKCU "Software\Classes\tg" "" "URL:Telegram Link"
  WriteRegStr HKCU "Software\Classes\tg" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\tg\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\tg\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\tg"
!macroend
