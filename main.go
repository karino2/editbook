package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/codegangsta/cli"
	"github.com/gorilla/websocket"
	"github.com/karino2/editbook/langservice"
)

var cmdsch = make(chan string)
var lsConfig = map[string]langservice.Config{}
var sendDataMutex = &sync.Mutex{}

func handleCommandConnection(conn net.Conn) {
	messageWithLF, _ := bufio.NewReader(conn).ReadString('\n')
	path := strings.TrimSpace(messageWithLF)

	cmd := "open"
	fmt.Println("cmd:", cmd, " arg:", path)
	cmdsch <- cmd + " " + path
}

func saveFile(path string, body string) error {
	targetPath, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	bbody := []byte(body)
	return ioutil.WriteFile(targetPath, bbody, 0600)
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
	sendDataMutex.Lock()
	defer sendDataMutex.Unlock()
	return conn.WriteMessage(websocket.TextMessage, data)
}

func openFileToClient(conn *websocket.Conn, path string) error {
	targetPath, err := filepath.Abs(path)
	if err != nil {
		log.Println(targetPath)
		return err
	}
	tbody, _ := ioutil.ReadFile(targetPath)

	jsondat, err := json.Marshal(map[string]string{
		"path": path,
		"abspath": targetPath,
		"data": string(tbody),
	})
	if err != nil {
		return err
	}

	return sendData(conn, append([]byte{clientOPEN}, []byte(jsondat)...))
}

func wsSendReceive(cmdsch chan string, conn *websocket.Conn) {
	// receive
	const (
		ping     = '1'
		ls       = '2'
		langlist = '3'
	)
	// sendback
	const (
		pong = '1'
	)

	disconn := make(chan bool, 2)

	conn.SetCloseHandler(func(code int, text string) error {
		log.Println("on close called")
		disconn <- true
		return nil
	})

	langServices := langservice.NewLangServices(lsConfig, func(lang string, data []byte) error {
		content := []byte{ls}
		content = append(content, []byte(lang)...)
		content = append(content, data...)
		return sendData(conn, content)
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
					}
				}
			case <-disconn:
				log.Println("disconn")
				langServices.Close()
				return
			}

		}
	}()

	go func() {
		defer func() { disconn <- true }()

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
			case ls:
				log.Printf("lang service: %s", data)
				data = data[1:]
				if idx := bytes.IndexAny(data, "{["); idx > 0 {
					langName := string(data[:idx])
					log.Printf("lang service: %s", langName)
					svc, err := langServices.GetOrInitializeLangService(langName)
					if err != nil {
						log.Printf("lang service error: %v", err)
						continue
					}
					data := data[idx:]
					if svc.Initialized() {
						svc.WriteMessage(data)
					} else {
						svc.Init(data)
					}
				}
			case langlist:
				log.Printf("Sending the list of langservice supported languages upon request.")
				langs := []string{}
				for lang, _ := range lsConfig {
					langs = append(langs, lang)
				}
				sendData(conn, append([]byte{langlist}, []byte(strings.Join(langs, ","))...))
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

func serverMain(port, editorType, lsConfigFile string) {
	log.Println("start main")

	_, sourceFileName, _, _ := runtime.Caller(0)
	modulepath := filepath.Dir(sourceFileName)

	if lsConfigFile != "" {
		loadedConfig, err := langservice.LoadConfigFile(lsConfigFile)
		if err != nil {
			log.Printf("Failed to load the language server config file: %v", err)
		} else {
			lsConfig = loadedConfig
		}
	}

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
		cli.StringFlag{
			Name:  "editor",
			Value: "monaco",
			Usage: "Specify the name of editor types.",
		},
		cli.StringFlag{
			Name:  "ls-config",
			Value: "",
			Usage: "specifies the filename containing JSON data to specify language servers.",
		},
	}

	app.Action = func(c *cli.Context) error {
		clientpath := c.String("client")

		if clientpath == "" {
			port := c.String("port")
			editorType := c.String("editor")
			lsConfig := c.String("ls-config")
			serverMain(port, editorType, lsConfig)
		} else {
			clientMain(clientpath)
		}

		return nil
	}

	app.Run(os.Args)
}
