set-alias editbook $env:GOPATH\src\github.com\karino2\editbook\main.exe

function ebclient($arg) {
  $path = $arg
  if($arg.StartsWith(".\")) {
     $path = $arg.substring(2)
  }
  editbook --client $path
}


