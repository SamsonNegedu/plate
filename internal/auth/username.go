package auth

import (
	"errors"
	"regexp"
	"strings"
)

// Usernames are lowercase and may hold an at sign, so a former email sign-in is still a valid username.
var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._@+-]{2,63}$`)

var ErrBadUsername = errors.New("not a valid username")

// NormalizeUsername trims, lowercases and validates a username.
func NormalizeUsername(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if !usernamePattern.MatchString(s) {
		return "", ErrBadUsername
	}
	return s, nil
}
