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
