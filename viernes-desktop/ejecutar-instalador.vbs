' VIERNES Desktop - Ejecutor de instalador
' Doble clic para abrir el instalador en una ventana que se queda abierta

Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd /k ""instalar-electron.bat""", 1, True
Set shell = Nothing

