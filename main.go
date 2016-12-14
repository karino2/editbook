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
	"path"
	"path/filepath"
	"strings"

	"github.com/codegangsta/cli"
	"github.com/gorilla/websocket"
	"github.com/kardianos/osext"
)

var cmdsch = make(chan string)

func handleCommandConnection(conn net.Conn) {
	messageWithLF, _ := bufio.NewReader(conn).ReadString('\n')
	path := strings.TrimSpace(messageWithLF)

	cmd := "open"
	fmt.Println("cmd:", cmd, " arg:", path)
	cmdsch <- cmd + " " + path
}

func saveFile(path string, body string) error {
	bbody := []byte(body)
	return ioutil.WriteFile(toTargetPath(path), bbody, 0600)
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

func toTargetPath(name string) string {
	cwd, _ := os.Getwd()
	return filepath.Join(cwd, filepath.FromSlash(path.Clean("/"+name)))
}

func openFileToClient(conn *websocket.Conn, path string) error {

	targetPath := toTargetPath(path)
	log.Println(targetPath)
	tbody, _ := ioutil.ReadFile(targetPath)

	type OpenCmdJSON struct {
		Path, Data string
	}

	jsondat, _ := json.Marshal(OpenCmdJSON{path, string(tbody)})

	return sendData(conn, append([]byte{clientOPEN}, []byte(jsondat)...))
}

func wsSendReceive(cmdsch chan string, conn *websocket.Conn) {
	disconn := make(chan bool, 2)

	conn.SetCloseHandler(func(code int, text string) error {
		log.Println("on close called")
		disconn <- true
		return nil
	})

	go func() {
		for {
			select {
			case cmdarg := <-cmdsch:
				arr := strings.SplitN(cmdarg, " ", 2)
				cmd, arg := arr[0], arr[1]
				switch cmd {
				case "open":
					if err := openFileToClient(conn, arg); err != nil {
						log.Println("err:" + err.Error())
						return
					}
				}
			case <-disconn:
				log.Println("disconn")
				return
			}

		}
	}()

	go func() {
		defer func() { disconn <- true }()

		// receive
		const (
			ping = '1'
		)
		// sendback
		const (
			pong = '1'
		)

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				log.Println("err2:" + err.Error())
				return
			}
			if len(data) == 0 {
				log.Println("Invalid message")
				return
			}

			switch data[0] {
			case ping:
				if err := sendData(conn, []byte{pong}); err != nil {
					log.Println("pong err:" + err.Error())
					return
				}
			}
		}
	}()

}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("wsHandler")

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

func serverMain(port string) {
	// editorType := "plain"
	// editorType := "jhtmlarea"
	editorType := "ace"

	log.Println("start main")

	modulepath, _ := osext.ExecutableFolder()

	fileServer := http.StripPrefix("/static/", http.FileServer(http.Dir(filepath.Join(modulepath, "static"))))
	editorServer := http.StripPrefix("/editor/", http.FileServer(http.Dir(filepath.Join(modulepath, "editors/"+editorType))))
	http.HandleFunc("/save/", saveHandler)
	http.HandleFunc("/ws", wsHandler)
	http.Handle("/static/", fileServer)
	http.Handle("/editor/", editorServer)
	go http.ListenAndServe(":"+port, nil)
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

func clientMain(path string) {
	conn, err := net.Dial("tcp", "127.0.0.1:5124")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	cmd := path
	fmt.Println("client path:", cmd)
	fmt.Fprintf(conn, cmd+"\n")
}

func main() {
	app := cli.NewApp()
	app.Name = "editbook"
	app.Usage = "Tiny text editor server."

	app.Flags = []cli.Flag{
		cli.StringFlag{
			Name:  "port, p",
			Value: "5123",
			Usage: "Specify port number of outer web connection.",
		},
		cli.StringFlag{
			Name:  "client",
			Value: "",
			Usage: "Run as client mode and open `PATH` file relative to server execution folder.",
		},
	}

	app.Action = func(c *cli.Context) error {
		clientpath := c.String("client")

		if clientpath == "" {
			port := c.String("port")
			serverMain(port)
		} else {
			clientMain(clientpath)
		}

		return nil
	}

	app.Run(os.Args)
}
