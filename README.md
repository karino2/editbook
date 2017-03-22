# editbook

[![TravisCI Build Status](https://travis-ci.org/karino2/editbook.svg?branch=master)](https://travis-ci.org/karino2/editbook)

EditBook is micro http server and web based editor.


# install

```
$ go get github.com/karino2/editbook
```

# how to test

```
$ ./editbook &
# open browser here with http://localhost:5123/static/
$ ./editbook --client /README.md
```

# how to use via ssh port forward

```
$ ssh -L 51234:localhost:51234 yoursshconfigname
# open browser here with http://localhost:51234/static/
```

# (partially) supported editor

- monaco https://github.com/Microsoft/monaco-editor
- ace https://ace.c9.io/#nav=about

# how to try tsserver and language server

```
editbook --ls-config lsconf.json
```

## how to check whether go-langserver is working.

1. Open main.go of editbook folder
2. Hover mouse cursor to "conn" of the argument of handleCommandConnection(conn net.Conn).
3. If go-langserver is working, there is some suggestion for this variable type.

CAUTION: intellisence is not supported now in go-langserver.

## how to check tsserver is working.

1. open editors/monaco/languageservice.js
2. put code fragment "document.getEleme" to somewhere and see suggestion
3. If tsserver is working, there is two "document.getElementById()" suggestion, and one has some description to this method, while others does not.

# how to use Dockerfile

```
docker build -t editbook .
docker run -d --publish 51234:5123 --publish 5124:5124 --name editbookdev -v $PWD:/go/src/github.com/karino2/editbook editbook  /go/src/github.com/karino2/editbook/script/build_and_exec.sh --ls-config lsconf.json
```

TIPS: it's better to place host editbook folder to match to container path because in this case you can use bash completion when calling editbook --client command.

