// put this file to SendTO and create shortcut which host wscript.exe

var shell = WScript.CreateObject ("WScript.Shell");
shell.Run("editbook.exe --client " + WScript.Arguments(0), 0, false);
