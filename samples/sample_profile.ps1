set-alias editbook editbook.exe

function ebclient($arg) {
	$path = Resolve-Path $arg
  editbook --client $path
}


