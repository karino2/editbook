# editbook
EditBook is micro http server and web based editor.


# build

```
$ cd editbook
$ go build main.go
```

# how to test

```
$ cd editbook
$ ./main &
# open browser here with http://localhost:5123/static/
$ ./main --client /README.md
```

# (partially) supported editor

- plain
- ace https://ace.c9.io/#nav=about