; Register tg:// as a real Windows URL handler and as a Default Apps candidate.
; The app-specific ProgID is important on modern Windows: it lets AppResolver
; resolve tg:// even when older Telegram installs left stale association state.
!macro customInstall
  DetailPrint "Registering tg:// protocol"

  ; Direct scheme handler (legacy/fallback path used by ShellExecute).
  WriteRegStr HKCU "Software\Classes\tg" "" "URL:Telegram Link"
  WriteRegStr HKCU "Software\Classes\tg" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\tg\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\tg\shell" "" "open"
  WriteRegStr HKCU "Software\Classes\tg\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Application-specific ProgID used by Default Apps / AppResolver.
  WriteRegStr HKCU "Software\Classes\TelegramWebDesktop.tg" "" "URL:Telegram Web Desktop Link"
  WriteRegStr HKCU "Software\Classes\TelegramWebDesktop.tg" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\TelegramWebDesktop.tg\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\TelegramWebDesktop.tg\shell" "" "open"
  WriteRegStr HKCU "Software\Classes\TelegramWebDesktop.tg\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Register the executable itself as URL-capable.
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Telegram Web Desktop"
  WriteRegDWORD HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "UseUrl" 1
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedProtocols" "tg" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Register with Windows Default Apps so AppResolver knows this executable owns tg://.
  WriteRegStr HKCU "Software\Telegram Web Desktop\Capabilities" "ApplicationName" "Telegram Web Desktop"
  WriteRegStr HKCU "Software\Telegram Web Desktop\Capabilities" "ApplicationDescription" "Telegram Web Desktop client"
  WriteRegStr HKCU "Software\Telegram Web Desktop\Capabilities\UrlAssociations" "tg" "TelegramWebDesktop.tg"
  WriteRegStr HKCU "Software\RegisteredApplications" "Telegram Web Desktop" "Software\Telegram Web Desktop\Capabilities"

  ; App Paths helps Shell resolve the installed executable consistently after upgrades.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}" "Path" "$INSTDIR"

  ; Flush the Shell association cache immediately; no Explorer reboot should be needed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, i 0, i 0)'
!macroend

!macro customUnInstall
  ; Only remove the generic tg:// owner if it still points at this installation.
  ReadRegStr $0 HKCU "Software\Classes\tg\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 +2
  DeleteRegKey HKCU "Software\Classes\tg"

  ReadRegStr $0 HKCU "Software\Classes\TelegramWebDesktop.tg\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 +2
  DeleteRegKey HKCU "Software\Classes\TelegramWebDesktop.tg"

  ReadRegStr $0 HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 +2
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"

  ReadRegStr $0 HKCU "Software\RegisteredApplications" "Telegram Web Desktop"
  StrCmp $0 "Software\Telegram Web Desktop\Capabilities" 0 +2
  DeleteRegValue HKCU "Software\RegisteredApplications" "Telegram Web Desktop"
  DeleteRegKey HKCU "Software\Telegram Web Desktop\Capabilities"

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}" ""
  StrCmp $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +2
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, i 0, i 0)'
!macroend
