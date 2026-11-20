package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
)

// ErrBadRecovery covers an unknown username, a wrong code and a spent code, so none of them can be told apart.
var ErrBadRecovery = errors.New("username or recovery code is not valid")

func nowStamp() string { return time.Now().UTC().Format(time.RFC3339) }

// Register creates an account and its recovery codes in one transaction. The codes are returned once and never stored.
func Register(ctx context.Context, db *sql.DB, username, password string) (domain.User, []string, error) {
	username, err := NormalizeUsername(username)
	if err != nil {
		return domain.User{}, nil, err
	}
	if err := CheckPassword(password); err != nil {
		return domain.User{}, nil, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return domain.User{}, nil, err
	}
	codes, hashes, err := NewRecoveryCodes()
	if err != nil {
		return domain.User{}, nil, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return domain.User{}, nil, fmt.Errorf("generating user id: %w", err)
	}
	now := nowStamp()
	u := domain.User{ID: id.String(), Username: username, PasswordHash: hash, CreatedAt: now, UpdatedAt: now}
	err = store.InTx(ctx, db, func(r *store.Repo) error {
		if err := r.CreateUser(ctx, u); err != nil {
			return err
		}
		return r.ReplaceRecoveryCodes(ctx, u.ID, hashes, now)
	})
	if err != nil {
		return domain.User{}, nil, err
	}
	return u, codes, nil
}

// NewCodes replaces every recovery code the user has and returns the new ones once.
func NewCodes(ctx context.Context, db *sql.DB, userID string) ([]string, error) {
	codes, hashes, err := NewRecoveryCodes()
	if err != nil {
		return nil, err
	}
	err = store.InTx(ctx, db, func(r *store.Repo) error {
		return r.ReplaceRecoveryCodes(ctx, userID, hashes, nowStamp())
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// ResetWithCode sets a new password when the recovery code is right, spends the code and signs out every device.
// The new password is hashed first so every failure costs the same time.
func ResetWithCode(ctx context.Context, db *sql.DB, sessions *SessionStore, username, code, newPassword string) error {
	if err := CheckPassword(newPassword); err != nil {
		return err
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	username, uerr := NormalizeUsername(username)
	given, cok := HashRecoveryCode(code)
	repo := store.NewRepo(db)
	var user domain.User
	if uerr == nil {
		user, err = repo.UserByUsername(ctx, username)
		if err != nil && !errors.Is(err, domain.ErrNotFound) {
			return err
		}
	}
	if uerr != nil || !cok || user.ID == "" {
		return ErrBadRecovery
	}
	stored, err := repo.UnusedRecoveryHashes(ctx, user.ID)
	if err != nil {
		return err
	}
	var match []byte
	for _, h := range stored {
		if subtle.ConstantTimeCompare(h, given) == 1 {
			match = h
		}
	}
	if match == nil {
		return ErrBadRecovery
	}
	now := nowStamp()
	err = store.InTx(ctx, db, func(r *store.Repo) error {
		spent, err := r.UseRecoveryCode(ctx, user.ID, match, now)
		if err != nil {
			return err
		}
		if !spent {
			return ErrBadRecovery
		}
		return r.SetPassword(ctx, user.ID, hash, now)
	})
	if err != nil {
		return err
	}
	if _, err := sessions.RevokeUser(ctx, user.ID); err != nil {
		return err
	}
	return nil
}
