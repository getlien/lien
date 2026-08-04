// Command ranking-go is the fixture corpus's tiny entry point, wiring the
// handlers package to the shared util logger.
package main

import (
	"github.com/lien-fixtures/ranking-go/internal/handlers"
	"github.com/lien-fixtures/ranking-go/internal/util"
)

func main() {
	util.LogInfo("starting ranking-go fixture service")
	if err := handlers.CreateUser("ada"); err != nil {
		util.LogError("main", err)
	}
}
