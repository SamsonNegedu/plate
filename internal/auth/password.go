// Package auth holds password hashing, the session store, rate limiting and client-IP trust rules.
package auth

import (
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/alexedwards/argon2id"
)

// OWASP minimum for Argon2id: 19 MiB, 2 iterations, 1 lane.
var params = &argon2id.Params{Memory: 19 * 1024, Iterations: 2, Parallelism: 1, SaltLength: 16, KeyLength: 32}

const MinPasswordLength = 12

var ErrWeakPassword = errors.New("password is too weak")

// commonPasswords is a small floor, not a breach corpus. Anything here is rejected at setup.
var commonPasswords = map[string]bool{
	"password1234": true, "123456789012": true, "qwertyuiop12": true, "passwordpassword": true,
	"letmein12345": true, "iloveyou1234": true, "administrator": true, "welcome12345": true,
	"changeme1234": true, "000000000000": true, "111111111111": true, "abcdefghijkl": true,
	"password123!": true, "qwertz123456": true, "passwort1234": true, "willkommen123": true,
}

// CheckPassword enforces the setup rules: length and a short deny list.
func CheckPassword(pw string) error {
	if len([]rune(pw)) < MinPasswordLength {
		return fmt.Errorf("use at least %d characters: %w", MinPasswordLength, ErrWeakPassword)
	}
	if commonPasswords[strings.ToLower(pw)] {
		return fmt.Errorf("that password is on the common list: %w", ErrWeakPassword)
	}
	return nil
}

func HashPassword(pw string) (string, error) {
	h, err := argon2id.CreateHash(pw, params)
	if err != nil {
		return "", fmt.Errorf("hashing password: %w", err)
	}
	return h, nil
}

// VerifyPassword reports whether pw matches the encoded hash.
func VerifyPassword(pw, hash string) (bool, error) {
	ok, err := argon2id.ComparePasswordAndHash(pw, hash)
	if err != nil {
		return false, fmt.Errorf("verifying password: %w", err)
	}
	return ok, nil
}

var (
	dummyOnce sync.Once
	dummyHash string
)

// BurnPasswordTime does the same work as a real verification so an unknown email costs the same as a wrong password.
func BurnPasswordTime(pw string) {
	dummyOnce.Do(func() { dummyHash, _ = HashPassword("not-a-real-password-just-for-timing") })
	_, _ = VerifyPassword(pw, dummyHash)
}
