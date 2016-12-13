# editbook
EditBook is micro http server and web based editor.


# build

```
$ cd editbook
$ go build main.go
$ cd cmds
$ go build ebclient
```

# how to test

```
$ cd editbook
$ ./main &
# open browser here with http://localhost:5123
$ cd cmds
$ ./ebclient "open main.go"
```

# (partially) supported editor

- plain
- jhtmlarea http://jhtmlarea.codeplex.com/