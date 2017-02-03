package langservice

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os/exec"
	"strconv"
	"strings"
)

type LangService interface {
	// Assumes the message is in JSON format, but Go just forwards
	// the data to the underlying language service, it doesn't have
	// to parse it.
	WriteMessage(msg []byte) error

	// Reads the message from the langauge server, and returns its
	// payload. Again, this does not parse the actual content.
	ReadMessage() ([]byte, error)

	Init(data []byte) error

	Initialized() bool

	io.Closer
}

type languageServerService struct {
	w              io.WriteCloser
	rclose         io.Closer
	scanner        *bufio.Scanner
	cmd            *exec.Cmd
	rootPathFinder func() string
	initialized    bool
}

func scanMessages(data []byte, atEOF bool) (advance int, token []byte, err error) {
	const CONTENT_LEN = "content-length:"
	var clen int
	for {
		adv, ln, err := bufio.ScanLines(data, atEOF)
		if err != nil {
			return 0, nil, err
		}
		if adv == 0 || adv == len(data) {
			return 0, nil, nil
		}
		lns := strings.ToLower(string(ln))
		data = data[adv:]
		advance += adv
		if len(ln) == 0 {
			break
		} else if strings.HasPrefix(lns, CONTENT_LEN) {
			l, err := strconv.ParseInt(strings.TrimSpace(lns[len(CONTENT_LEN):]), 10, 32)
			if err != nil {
				return 0, nil, err
			}
			clen = int(l)
		}
	}
	if clen == 0 {
		return advance, nil, nil
	}
	if len(data) < clen {
		return 0, nil, nil
	}
	return advance + clen, data[:clen], nil
}

func (s *languageServerService) ReadMessage() ([]byte, error) {
	if !s.scanner.Scan() {
		return nil, s.scanner.Err()
	}
	d := s.scanner.Bytes()
	return d, nil
}

func (s *languageServerService) WriteMessage(msg []byte) error {
	l := len(msg)
	_, err := fmt.Fprintf(s.w, "Content-Length: %d\r\n\r\n%s", l, msg)
	return err
}

func (s *languageServerService) Close() error {
	err := s.w.Close()
	if err != nil {
		return err
	}
	err = s.rclose.Close()
	if err != nil {
		return err
	}
	return s.cmd.Process.Kill()
}

func (s *languageServerService) Init(msg []byte) error {
	value := map[string]interface{}{}
	if err := json.Unmarshal(msg, &value); err != nil {
		return err
	}
	params := value["params"].(map[string]interface{})
	path := s.rootPathFinder()
	if len(path) > 0 {
		params["rootUri"] = "file://" + path
		params["rootPath"] = "file://" + path
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	err = s.WriteMessage(encoded)
	s.initialized = (err == nil)
	return err
}

func (s *languageServerService) Initialized() bool {
	return s.initialized
}

func StartLanguageServer(lang string, config Config) (LangService, error) {
	cmd := exec.Command(config.Commands[0], config.Commands[1:]...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmdOut := bufio.NewScanner(stdout)
	cmdOut.Split(scanMessages)
	cmdIn, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	cmderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	go func() {
		// This will cause *lots* of output -- probably
		// better to allow only with "developer mode".
		return
		cmderrio := bufio.NewScanner(cmderr)
		defer cmderr.Close()
		for {
			if !cmderrio.Scan() {
				break
			}
			println(cmderrio.Text())
		}
	}()
	svc := &languageServerService{
		w:              cmdIn,
		rclose:         stdout,
		scanner:        cmdOut,
		cmd:            cmd,
		rootPathFinder: DefaultRootPathFinder,
	}
	if finder, ok := RootPathFinders[lang]; ok {
		svc.rootPathFinder = finder
	}
	return svc, nil
}

type SendDataFunc func(lang string, data []byte) error

type LangServices struct {
	svcs     map[string]LangService
	configs  map[string]Config
	sendData SendDataFunc
}

func NewLangServices(configs map[string]Config, sendData SendDataFunc) *LangServices {
	return &LangServices{
		svcs:     map[string]LangService{},
		configs:  configs,
		sendData: sendData,
	}
}

func (lss *LangServices) GetOrInitializeLangService(lang string) (LangService, error) {
	if svc, ok := lss.svcs[lang]; ok {
		return svc, nil
	}
	cfg, ok := lss.configs[lang]
	if !ok {
		return nil, fmt.Errorf("Config not found for lang %s", lang)
	}
	svc, err := StartLanguageServer(lang, cfg)
	if err != nil {
		return nil, err
	}
	go func() {
		for {
			data, err := svc.ReadMessage()
			if err == io.EOF {
				break
			} else if err != nil {
				log.Printf("Error on reading from langserver: %v", err)
				continue
			}
			lss.sendData(lang, data)
		}
	}()
	lss.svcs[lang] = svc
	return svc, nil
}

func (lss *LangServices) Close() {
	for _, svc := range lss.svcs {
		svc.Close()
	}
}
