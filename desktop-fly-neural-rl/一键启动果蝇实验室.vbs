' Double-click this file for a console-free one-click launch.
' Launch Electron directly so Chinese paths do not pass through cmd.exe's
' nested quoting rules. The visible CMD remains the first-install fallback.
Option Explicit
Dim shell, fso, root, electronExe, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = root & "\windows\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electronExe) Then
  MsgBox "Runtime is missing. Please run the CMD launcher in this folder once.", 48, "Fruit Fly Lab"
  WScript.Quit 1
End If

shell.CurrentDirectory = root & "\windows"
shell.Environment("PROCESS")("DESKTOPFLY_LAB_ONLY") = "1"
shell.Environment("PROCESS")("DESKTOPFLY_APP_MODE") = "observation"
command = Chr(34) & electronExe & Chr(34) & " ."
shell.Run command, 0, False
