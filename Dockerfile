FROM golang:1.7.5 
run go get github.com/karino2/editbook
run go get github.com/sourcegraph/go-langserver/langserver
run cd /go/src/github.com/sourcegraph/go-langserver/langserver/cmd/langserver-go && go install
run mkdir -p /go/src/github.com/karino2/editbook
workdir /go/src/github.com/karino2/editbook
copy . /go/src/github.com/karino2/editbook
run go install
entrypoint ["editbook"]
expose 5123 5124
