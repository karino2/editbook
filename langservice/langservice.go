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

type commandlineService struct {
	w io.WriteCloser
	rclose io.Closer
	scanner *bufio.Scanner
	cmd *exec.Cmd
	closing bool
}

func (cs *commandlineService) Close() error {
	cs.closing = true
	err := cs.w.Close()
	if err != nil {
		return err
	}
	err = cs.rclose.Close()
	if err != nil {
		return err
	}
	return cs.cmd.Process.Kill()
}

type languageServerService struct {
	*commandlineService
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
		err := s.scanner.Err()
		if err == nil {
			err = io.EOF
		}
		return nil, err
	}
	if len(s.scanner.Bytes()) == 0 {
		return nil, fmt.Errorf("no data available")
	}
	d := s.scanner.Bytes()
	return d, nil
}

func (s *languageServerService) WriteMessage(msg []byte) error {
	l := len(msg)
	_, err := fmt.Fprintf(s.w, "Content-Length: %d\r\n\r\n%s", l, msg)
	return err
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

func startCommandlineService(commands []string) (*commandlineService, error) {
	cmd := exec.Command(commands[0], commands[1:]...)
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
	cmdErr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	cs := &commandlineService{
		w:              cmdIn,
		rclose:         stdout,
		scanner:        cmdOut,
		cmd:            cmd,
	}
	errBuf := make([]string, 0, 100)
	go func() {
		errReader := bufio.NewScanner(cmdErr)
		for {
			if !errReader.Scan() {
				return
			}
			errBuf = append(errBuf, errReader.Text())
			if len(errBuf) > 100 {
				errBuf = errBuf[1:]
			}
		}
	}()
	go func() {
		err := cmd.Wait()
		if cs.closing {
			return
		}
		if err != nil {
			log.Printf("unexpected command exit: %v", err)
			log.Printf("errors: \n%s", strings.Join(errBuf, "\n"))
		}
	}()
	return cs, nil
}

func StartLanguageServer(lang string, config Config) (LangService, error) {
	commandlineService, err := startCommandlineService(config.Commands)
	if err != nil {
		return nil, err
	}
	svc := &languageServerService{
		commandlineService: commandlineService,
		rootPathFinder: DefaultRootPathFinder,
	}
	if finder, ok := RootPathFinders[lang]; ok {
		svc.rootPathFinder = finder
	}
	return svc, nil
}

type tsServerService struct {
	*commandlineService
}

func (s *tsServerService) ReadMessage() ([]byte, error) {
	if !s.scanner.Scan() {
		return nil, s.scanner.Err()
	}
	d := s.scanner.Bytes()
	return d, nil
}

func (s *tsServerService) WriteMessage(msg []byte) error {
	_, err := fmt.Fprintf(s.w, "%s\r\n", msg)
	return err
}

func (ts *tsServerService) Init(msg []byte) error {
	return nil
}

func (ts *tsServerService) Initialized() bool {
	return true
}

func StartTSServer(lang string, config Config) (LangService, error) {
	commandlineService, err := startCommandlineService(config.Commands)
	if err != nil {
		return nil, err
	}
	return &tsServerService{commandlineService: commandlineService}, nil
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

func (lss *LangServices) GetOrInitializeLangService(lang string) (svc LangService, err error) {
	if svc, ok := lss.svcs[lang]; ok {
		return svc, nil
	}
	cfg, ok := lss.configs[lang]
	if !ok {
		return nil, fmt.Errorf("Config not found for lang %s", lang)
	}
	if cfg.Protocol == LanguageServer {
		svc, err = StartLanguageServer(lang, cfg)
	} else {
		svc, err = StartTSServer(lang, cfg)
	}
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
