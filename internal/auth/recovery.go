package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"strings"
)

// RecoveryCodeCount is how many single-use reset codes an account holds.
const RecoveryCodeCount = 8

// Crockford base32: no I, L, O or U, so a code read off a screen or paper is hard to mistype.
const codeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

const codeLength = 10

// NewRecoveryCodes returns the codes to show once ("ABCDE-FGHJK") and the hashes to store.
func NewRecoveryCodes() (codes []string, hashes [][]byte, err error) {
	for range RecoveryCodeCount {
		raw := make([]byte, codeLength)
		if _, err := rand.Read(raw); err != nil {
			return nil, nil, fmt.Errorf("generating recovery code: %w", err)
		}
		var b strings.Builder
		for i, v := range raw {
			if i == codeLength/2 {
				b.WriteByte('-')
			}
			b.WriteByte(codeAlphabet[v%32]) // 256 is a multiple of 32, so there is no modulo bias
		}
		code := b.String()
		h, _ := HashRecoveryCode(code)
		codes = append(codes, code)
		hashes = append(hashes, h)
	}
	return codes, hashes, nil
}

// HashRecoveryCode normalises what a person typed and hashes it. ok is false when it cannot be a code.
func HashRecoveryCode(input string) (hash []byte, ok bool) {
	var b strings.Builder
	for _, r := range strings.ToUpper(input) {
		switch r {
		case ' ', '-', '\t':
			continue
		case 'O':
			r = '0'
		case 'I', 'L':
			r = '1'
		}
		if !strings.ContainsRune(codeAlphabet, r) {
			return nil, false
		}
		b.WriteRune(r)
	}
	if b.Len() != codeLength {
		return nil, false
	}
	h := sha256.Sum256([]byte(b.String()))
	return h[:], true
}
