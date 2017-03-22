package langservice

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const (
	LanguageServer Protocol = "LS"
	TSServer       Protocol = "TS"
)

var RootPathFinders = map[string]func() string{
	"go": findRootPathGo,
}

type Protocol string

type Config struct {
	Commands []string `json:"commands"`
	Protocol Protocol `json:"protocol"`
}

func LoadConfigFile(filename string) (map[string]Config, error) {
	fin, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	result := map[string]Config{}
	if err := json.NewDecoder(fin).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}

func findRootPathGo() string {
	gopath, err := filepath.Abs(os.Getenv("GOPATH"))
	if err != nil {
		return ""
	}
	path := filepath.ToSlash(filepath.Join(gopath, "src"))
	if strings.HasPrefix(path, "/") {
		return path
	}
	return "/" + path
}

func DefaultRootPathFinder() string {
	path, err := os.Getwd()
	if err != nil {
		return ""
	}
	return path
}
