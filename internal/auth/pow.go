package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/bits"
	"strconv"
	"sync"
	"time"
)

// Proof of work makes a mass signup expensive without a CAPTCHA or any outside service. The server signs a salt and
// a difficulty; the browser searches for a counter whose SHA-256(salt ":" counter) starts with that many zero bits.
const (
	ChallengeTTL = 5 * time.Minute
	MaxPoWBits   = 28
	loadWindow   = 10 * time.Minute
)

var (
	ErrBadChallenge = errors.New("challenge is not valid")
	ErrExpired      = errors.New("challenge expired")
	ErrReplayed     = errors.New("challenge was already used")
	ErrWorkTooLow   = errors.New("proof of work does not meet the difficulty")
)

type Challenge struct {
	Salt      string `json:"salt"`
	Bits      int    `json:"bits"`
	ExpiresAt int64  `json:"expires_at"`
	Signature string `json:"signature"`
}

type PoW struct {
	secret []byte
	base   int
	now    func() time.Time

	mu     sync.Mutex
	used   map[string]time.Time
	solves []time.Time
}

// NewPoW makes a verifier with a fresh signing secret. A restart invalidates open challenges; clients just ask again.
func NewPoW(baseBits int) (*PoW, error) {
	if baseBits < 0 || baseBits > MaxPoWBits {
		return nil, fmt.Errorf("proof-of-work bits %d: want 0 to %d", baseBits, MaxPoWBits)
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generating signing secret: %w", err)
	}
	return &PoW{secret: secret, base: baseBits, now: time.Now, used: map[string]time.Time{}}, nil
}

// Issue signs a new challenge. Difficulty rises when many signups landed recently and falls back on its own.
func (p *PoW) Issue() (Challenge, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return Challenge{}, fmt.Errorf("generating salt: %w", err)
	}
	c := Challenge{
		Salt:      hex.EncodeToString(salt),
		Bits:      p.difficulty(),
		ExpiresAt: p.now().Add(ChallengeTTL).Unix(),
	}
	c.Signature = p.sign(c)
	return c, nil
}

func (p *PoW) difficulty() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pruneLocked(p.now())
	extra := 0
	switch n := len(p.solves); {
	case n > 120:
		extra = 2
	case n > 30:
		extra = 1
	}
	return min(p.base+extra, MaxPoWBits)
}

// Verify accepts one solved challenge exactly once.
func (p *PoW) Verify(c Challenge, counter uint64) error {
	if len(c.Salt) != 32 || c.Bits < 0 || c.Bits > MaxPoWBits {
		return ErrBadChallenge
	}
	want, err := hex.DecodeString(p.sign(c))
	got, err2 := hex.DecodeString(c.Signature)
	if err != nil || err2 != nil || !hmac.Equal(want, got) {
		return ErrBadChallenge
	}
	now := p.now()
	if now.Unix() > c.ExpiresAt {
		return ErrExpired
	}
	if leadingZeroBits(workHash(c.Salt, counter)) < c.Bits {
		return ErrWorkTooLow
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pruneLocked(now)
	if _, dup := p.used[c.Salt]; dup {
		return ErrReplayed
	}
	p.used[c.Salt] = time.Unix(c.ExpiresAt, 0)
	p.solves = append(p.solves, now)
	return nil
}

func (p *PoW) pruneLocked(now time.Time) {
	for salt, exp := range p.used {
		if now.After(exp) {
			delete(p.used, salt)
		}
	}
	i := 0
	for i < len(p.solves) && now.Sub(p.solves[i]) > loadWindow {
		i++
	}
	p.solves = p.solves[i:]
}

func (p *PoW) sign(c Challenge) string {
	m := hmac.New(sha256.New, p.secret)
	m.Write([]byte(c.Salt + ":" + strconv.Itoa(c.Bits) + ":" + strconv.FormatInt(c.ExpiresAt, 10)))
	return hex.EncodeToString(m.Sum(nil))
}

func workHash(salt string, counter uint64) [32]byte {
	return sha256.Sum256([]byte(salt + ":" + strconv.FormatUint(counter, 10)))
}

func leadingZeroBits(h [32]byte) int {
	n := 0
	for _, b := range h {
		if b == 0 {
			n += 8
			continue
		}
		return n + bits.LeadingZeros8(b)
	}
	return n
}

// Solve is the reference solver the tests use; the browser runs the same search in a worker.
func Solve(c Challenge) uint64 {
	for n := uint64(0); ; n++ {
		if leadingZeroBits(workHash(c.Salt, n)) >= c.Bits {
			return n
		}
	}
}
