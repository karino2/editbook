package main

import (
	"fmt"
	"net"
	"os"
)

func main() {
	conn, err := net.Dial("tcp", "127.0.0.1:5124")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	cmd := os.Args[1]
	fmt.Println("cmd:", cmd)
	fmt.Fprintf(conn, cmd+"\n")
}
