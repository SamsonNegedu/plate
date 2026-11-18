package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/alexedwards/scs/v2"

	"plate/internal/store/sqlc"
)

const userKey = "user_id"

// SessionStore keeps scs sessions in SQLite. Only the SHA-256 of the cookie token is stored.
type SessionStore struct {
	q     *sqlc.Queries
	codec scs.Codec
	now   func() time.Time
}

func NewSessionStore(db *sql.DB) *SessionStore {
	return &SessionStore{q: sqlc.New(db), codec: scs.GobCodec{}, now: time.Now}
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func (s *SessionStore) Find(token string) ([]byte, bool, error) {
	return s.FindCtx(context.Background(), token)
}

func (s *SessionStore) Commit(token string, b []byte, expiry time.Time) error {
	return s.CommitCtx(context.Background(), token, b, expiry)
}

func (s *SessionStore) Delete(token string) error {
	return s.DeleteCtx(context.Background(), token)
}

func (s *SessionStore) FindCtx(ctx context.Context, token string) ([]byte, bool, error) {
	row, err := s.q.GetSession(ctx, hashToken(token))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("finding session: %w", err)
	}
	exp, err := time.Parse(time.RFC3339Nano, row.Expiry)
	if err != nil {
		return nil, false, nil //nolint:nilerr // an unreadable expiry means the row is unusable, so treat it as no session
	}
	if !exp.After(s.now()) {
		return nil, false, nil
	}
	return row.Data, true, nil
}

// CommitCtx extracts the user id from the encoded session so logout-all can find every row for a user.
// A session without a user id is not persisted: this app has no anonymous sessions.
func (s *SessionStore) CommitCtx(ctx context.Context, token string, b []byte, expiry time.Time) error {
	_, values, err := s.codec.Decode(b)
	if err != nil {
		return fmt.Errorf("decoding session: %w", err)
	}
	uid, _ := values[userKey].(string)
	if uid == "" {
		return nil
	}
	err = s.q.UpsertSession(ctx, sqlc.UpsertSessionParams{
		TokenHash: hashToken(token), UserID: uid, Data: b, Expiry: expiry.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return fmt.Errorf("saving session: %w", err)
	}
	return nil
}

func (s *SessionStore) DeleteCtx(ctx context.Context, token string) error {
	if err := s.q.DeleteSession(ctx, hashToken(token)); err != nil {
		return fmt.Errorf("deleting session: %w", err)
	}
	return nil
}

// RevokeUser deletes every session for the user and returns how many existed.
func (s *SessionStore) RevokeUser(ctx context.Context, userID string) (int64, error) {
	n, err := s.q.DeleteSessionsByUser(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("revoking sessions: %w", err)
	}
	return n, nil
}

// PruneExpired removes sessions past their expiry.
func (s *SessionStore) PruneExpired(ctx context.Context) (int64, error) {
	n, err := s.q.DeleteExpiredSessions(ctx, s.now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, fmt.Errorf("pruning sessions: %w", err)
	}
	return n, nil
}

// Count returns how many sessions the user has.
func (s *SessionStore) Count(ctx context.Context, userID string) (int64, error) {
	n, err := s.q.CountSessionsByUser(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("counting sessions: %w", err)
	}
	return n, nil
}
