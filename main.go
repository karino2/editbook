package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/websocket"
)

var cmdsch = make(chan string)

func handleCommandConnection(conn net.Conn) {
	messageWithLF, _ := bufio.NewReader(conn).ReadString('\n')
	message := strings.TrimSpace(messageWithLF)
	cmds := strings.SplitN(message, " ", 2)
	cmd := cmds[0]
	arg := cmds[1]
	fmt.Println("cmd:", cmd, " arg:", arg)
	cmdsch <- cmd
	cmdsch <- arg
}

func saveFile(path string, body string) error {
	bbody := []byte(body)
	return ioutil.WriteFile(path, bbody, 0600)
}

func saveHandler(w http.ResponseWriter, r *http.Request) {
	path := r.FormValue("path")
	body := r.FormValue("data")
	err := saveFile(path, body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/static/empty.html", http.StatusFound)
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	Subprotocols:    []string{"editbook"},
}

const (
	clientOPEN = '0'
)

func sendData(conn *websocket.Conn, data []byte) error {
	return conn.WriteMessage(websocket.TextMessage, data)
}

func openFileToClient(conn *websocket.Conn, path string) error {
	tbody, _ := ioutil.ReadFile(path)

	type OpenCmdJSON struct {
		Path, Data string
	}

	jsondat, _ := json.Marshal(OpenCmdJSON{path, string(tbody)})

	return sendData(conn, append([]byte{clientOPEN}, []byte(jsondat)...))
}

func wsSendReceive(cmdsch chan string, conn *websocket.Conn) {
	exit := make(chan bool, 2)

	// should handle disconnect someway.
	go func() {
		defer func() { exit <- true }()

		for {
			cmd := <-cmdsch
			arg := <-cmdsch
			switch cmd {
			case "open":
				openFileToClient(conn, arg)
			}
		}
	}()
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", 405)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Print("Failed to upgrade connection: " + err.Error())
		return
	}

	go wsSendReceive(cmdsch, conn)
}

func main() {
	editorType := "plain"
	// editorType := "jhtmlarea"

	log.Println("start main")

	fileServer := http.StripPrefix("/static/", http.FileServer(http.Dir("static")))
	editorServer := http.StripPrefix("/editor/", http.FileServer(http.Dir("editors/"+editorType)))
	http.HandleFunc("/save/", saveHandler)
	http.HandleFunc("/ws", wsHandler)
	http.Handle("/static/", fileServer)
	http.Handle("/editor/", editorServer)
	go http.ListenAndServe(":5123", nil)
	ln, err := net.Listen("tcp", ":5124")
	if err != nil {
		fmt.Printf("Can't open command socket %s\n", err)
		os.Exit(1)
	}
	for {
		conn, _ := ln.Accept()
		go handleCommandConnection(conn)

	}

}
