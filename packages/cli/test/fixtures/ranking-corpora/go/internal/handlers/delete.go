package handlers

import (
	"errors"

	"github.com/lien-fixtures/ranking-go/internal/util"
)

// DeleteUser removes a user by id, logging the outcome through the shared
// util package.
func DeleteUser(id int) error {
	if id <= 0 {
		err := errors.New("id must be positive")
		util.LogError("DeleteUser", err)
		return err
	}
	util.LogInfo("deleted user")
	return nil
}
