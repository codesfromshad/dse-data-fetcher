; NSIS hooks for the Windows installer (tauri.conf.json → bundle.windows.nsis.installerHooks).

; Uninstalling with "Delete the application data" ticked: Tauri's uninstaller
; already removes %APPDATA%\<identifier> (settings) and %LOCALAPPDATA%\<identifier>
; (WebView2's cache). This also removes the temporary spreadsheets the app
; leaves in the user's temp folder: ones from a crash, or that were still open
; in Excel when the app closed. Never while updating (the updater runs the
; uninstaller too), and never when the box isn't ticked.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    Delete "$TEMP\temp_stock_data_*.xlsx"
    ; Excel's lock files for them, left behind if Excel was closed abruptly.
    Delete "$TEMP\~$$temp_stock_data_*.xlsx"
  ${EndIf}
!macroend
