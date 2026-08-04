package handlers

import (
	"errors"

	"github.com/lien-fixtures/ranking-go/internal/util"
)

// UpdateUser changes an existing user's display name, logging the outcome
// through the shared util package.
func UpdateUser(id int, name string) error {
	if id <= 0 {
		err := errors.New("id must be positive")
		util.LogError("UpdateUser", err)
		return err
	}
	util.LogInfo("updated user " + name)
	return nil
}
