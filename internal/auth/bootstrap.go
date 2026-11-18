package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"

	"plate/internal/config"
	"plate/internal/domain"
	"plate/internal/store"
)

// Bootstrap creates the single admin from the deploy environment, or applies a one-shot password reset.
// It never creates a user from a request and never logs a password.
func Bootstrap(ctx context.Context, cfg config.Config, db *sql.DB, sessions *SessionStore, log *slog.Logger) error {
	repo := store.NewRepo(db)
	users, err := repo.CountUsers(ctx)
	if err != nil {
		return err
	}
	haveEnv := cfg.AdminEmail != "" && cfg.AdminPassword != ""

	switch {
	case users == 0 && cfg.ResetPassword:
		return errors.New("PLATE_ADMIN_RESET_PASSWORD is set but no admin exists; reset never creates a user")
	case users == 0 && !haveEnv:
		return errors.New("no admin exists: set PLATE_ADMIN_EMAIL and PLATE_ADMIN_PASSWORD for the first boot")
	case users == 0:
		return createAdmin(ctx, cfg, db, log)
	case cfg.ResetPassword:
		return resetPassword(ctx, cfg, repo, sessions, log)
	case cfg.AdminEmail != "" || cfg.AdminPassword != "":
		log.WarnContext(ctx, "admin already exists; ignoring PLATE_ADMIN_EMAIL and PLATE_ADMIN_PASSWORD, remove them from the environment")
	}
	return nil
}

func createAdmin(ctx context.Context, cfg config.Config, db *sql.DB, log *slog.Logger) error {
	email, err := NormalizeEmail(cfg.AdminEmail)
	if err != nil {
		return fmt.Errorf("PLATE_ADMIN_EMAIL: %w", err)
	}
	if err := CheckPassword(cfg.AdminPassword); err != nil {
		return fmt.Errorf("PLATE_ADMIN_PASSWORD: %w", err)
	}
	hash, err := HashPassword(cfg.AdminPassword)
	if err != nil {
		return err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generating user id: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	err = store.InTx(ctx, db, func(r *store.Repo) error {
		n, err := r.CountUsers(ctx)
		if err != nil {
			return err
		}
		if n > 0 {
			return nil
		}
		return r.CreateUser(ctx, domain.User{ID: id.String(), Email: email, PasswordHash: hash, CreatedAt: now, UpdatedAt: now})
	})
	if err != nil {
		return err
	}
	log.InfoContext(ctx, "admin created", slog.String("email", email))
	return nil
}

func resetPassword(ctx context.Context, cfg config.Config, repo *store.Repo, sessions *SessionStore, log *slog.Logger) error {
	if err := CheckPassword(cfg.AdminPassword); err != nil {
		return fmt.Errorf("PLATE_ADMIN_PASSWORD: %w", err)
	}
	u, err := repo.FirstUser(ctx)
	if err != nil {
		return fmt.Errorf("reset needs an existing admin: %w", err)
	}
	hash, err := HashPassword(cfg.AdminPassword)
	if err != nil {
		return err
	}
	if err := repo.SetPassword(ctx, u.ID, hash, time.Now().UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	if _, err := sessions.RevokeUser(ctx, u.ID); err != nil {
		return err
	}
	log.WarnContext(ctx, "admin password reset; sessions revoked. Remove PLATE_ADMIN_PASSWORD and PLATE_ADMIN_RESET_PASSWORD and restart.")
	return nil
}

// NormalizeEmail trims, lowercases and validates an address.
func NormalizeEmail(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s {
		return "", errors.New("not a valid email address")
	}
	return s, nil
}
