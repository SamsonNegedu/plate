package store

import (
	"fmt"
	"io/fs"

	"plate/db"
)

func fsSub() (fs.FS, error) {
	sub, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return nil, fmt.Errorf("opening embedded migrations: %w", err)
	}
	return sub, nil
}
