// Package handlers implements the HTTP-ish handler layer for the fixture
// corpus's tiny in-memory "user service" example.
package handlers

import (
	"errors"

	"github.com/lien-fixtures/ranking-go/internal/util"
)

// CreateUser validates and records a new user by name, logging the outcome
// through the shared util package.
func CreateUser(name string) error {
	if name == "" {
		err := errors.New("name must not be empty")
		util.LogError("CreateUser", err)
		return err
	}
	util.LogInfo("created user " + name)
	return nil
}
