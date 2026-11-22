' VIERNES Desktop - Ejecutor directo
' Doble clic para iniciar Viernes en una ventana que se queda abierta

Dim shell, scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir
shell.Run "cmd /k ""iniciar-viernes.bat""", 1, True
Set shell = Nothing
Set fso = Nothing
