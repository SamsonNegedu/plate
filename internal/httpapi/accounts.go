package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"plate/internal/auth"
	"plate/internal/domain"
	"plate/internal/store"
)

type challengeBody struct {
	Salt      string `json:"salt" minLength:"32" maxLength:"32"`
	Bits      int    `json:"bits" minimum:"0" maximum:"28"`
	ExpiresAt int64  `json:"expires_at"`
	Signature string `json:"signature" minLength:"64" maxLength:"64"`
}

type challengeOutput struct{ Body challengeBody }

type signupInput struct {
	Body struct {
		Username  string        `json:"username" minLength:"1" maxLength:"254"`
		Password  string        `json:"password" minLength:"1" maxLength:"1024"`
		Challenge challengeBody `json:"challenge"`
		Counter   int64         `json:"counter" minimum:"0" doc:"The number that makes SHA-256(salt + ':' + counter) start with challenge.bits zero bits."`
	}
}

type signupOutput struct {
	Body struct {
		User          UserBody `json:"user"`
		RecoveryCodes []string `json:"recovery_codes" nullable:"false" doc:"Shown once. Each resets the password one time."`
	}
}

type resetInput struct {
	Body struct {
		Username     string `json:"username" minLength:"1" maxLength:"254"`
		RecoveryCode string `json:"recovery_code" minLength:"1" maxLength:"64"`
		NewPassword  string `json:"new_password" minLength:"1" maxLength:"1024"`
	}
}

type passwordInput struct {
	Body struct {
		Password string `json:"password" minLength:"1" maxLength:"1024"`
	}
}

type codesOutput struct {
	Body struct {
		RecoveryCodes []string `json:"recovery_codes" nullable:"false"`
	}
}

func (d Deps) registerAccounts(api huma.API) {
	a := d.Auth
	repo := store.NewRepo(d.DB)

	huma.Register(api, huma.Operation{
		OperationID: "signup-challenge",
		Method:      http.MethodGet,
		Path:        "/auth/challenge",
		Summary:     "Get a proof-of-work challenge for signup",
		Tags:        []string{"auth"},
		Errors:      []int{http.StatusForbidden},
	}, func(ctx context.Context, _ *struct{}) (*challengeOutput, error) {
		if !d.Config.SignupEnabled {
			return nil, errSignupClosed
		}
		c, err := a.PoW.Issue()
		if err != nil {
			return nil, Err(http.StatusInternalServerError, "internal", "Could not start signup.")
		}
		return &challengeOutput{Body: challengeBody{Salt: c.Salt, Bits: c.Bits, ExpiresAt: c.ExpiresAt, Signature: c.Signature}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "signup",
		Method:      http.MethodPost,
		Path:        "/auth/signup",
		Summary:     "Create an account and sign in",
		Description: "Needs a solved challenge from `/auth/challenge`. The recovery codes in the response are shown once.",
		Tags:        []string{"auth"},
		Errors:      []int{http.StatusForbidden, http.StatusConflict, http.StatusUnprocessableEntity, http.StatusTooManyRequests},
	}, func(ctx context.Context, in *signupInput) (*signupOutput, error) {
		return d.signup(ctx, in, repo)
	})

	huma.Register(api, huma.Operation{
		OperationID:   "reset-password",
		Method:        http.MethodPost,
		Path:          "/auth/reset",
		Summary:       "Set a new password with a recovery code",
		Description:   "Spends the code and signs the account out everywhere.",
		Tags:          []string{"auth"},
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusTooManyRequests},
	}, func(ctx context.Context, in *resetInput) (*struct{}, error) {
		ip := clientIP(ctx)
		if err := d.limitAttempt(ctx, ip, "reset:"+in.Body.Username); err != nil {
			return nil, err
		}
		err := auth.ResetWithCode(ctx, d.DB, a.Store, in.Body.Username, in.Body.RecoveryCode, in.Body.NewPassword)
		switch {
		case errors.Is(err, auth.ErrBadRecovery):
			d.Log.WarnContext(ctx, "password reset failed", slog.String("ip", hashIP(ip)), slog.String("request_id", RequestID(ctx)))
			return nil, Err(http.StatusUnauthorized, "invalid_recovery", "That username and recovery code do not match.")
		case errors.Is(err, auth.ErrWeakPassword):
			return nil, Err(http.StatusUnprocessableEntity, "weak_password", err.Error())
		case err != nil:
			d.Log.ErrorContext(ctx, "password reset failed", slog.String("error", err.Error()), slog.String("request_id", RequestID(ctx)))
			return nil, Err(http.StatusInternalServerError, "internal", "Could not reset the password.")
		}
		d.Log.WarnContext(ctx, "password reset with recovery code", slog.String("request_id", RequestID(ctx)))
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "new-recovery-codes",
		Method:      http.MethodPost,
		Path:        "/auth/recovery-codes",
		Summary:     "Replace the recovery codes",
		Description: "Needs the current password. Every earlier code stops working.",
		Tags:        []string{"auth"},
		Security:    sessionSecurity,
		Errors:      []int{http.StatusUnauthorized, http.StatusTooManyRequests},
	}, func(ctx context.Context, in *passwordInput) (*codesOutput, error) {
		if err := d.confirmPassword(ctx, repo, "codes:", in.Body.Password); err != nil {
			return nil, err
		}
		codes, err := auth.NewCodes(ctx, d.DB, UserID(ctx))
		if err != nil {
			return nil, Err(http.StatusInternalServerError, "internal", "Could not create recovery codes.")
		}
		out := &codesOutput{}
		out.Body.RecoveryCodes = codes
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "ack-recovery-codes",
		Method:        http.MethodPost,
		Path:          "/auth/recovery-codes/ack",
		Summary:       "Confirm the recovery codes were saved",
		Tags:          []string{"auth"},
		Security:      sessionSecurity,
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, _ *struct{}) (*struct{}, error) {
		if err := repo.AcknowledgeCodes(ctx, UserID(ctx), time.Now().UTC().Format(time.RFC3339)); err != nil {
			return nil, Err(http.StatusInternalServerError, "internal", "Could not record that.")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "delete-account",
		Method:        http.MethodPost,
		Path:          "/auth/delete-account",
		Summary:       "Delete this account and all of its data",
		Description:   "Needs the current password. This cannot be undone.",
		Tags:          []string{"auth"},
		Security:      sessionSecurity,
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusTooManyRequests},
	}, func(ctx context.Context, in *passwordInput) (*struct{}, error) {
		if err := d.confirmPassword(ctx, repo, "delete:", in.Body.Password); err != nil {
			return nil, err
		}
		if err := repo.DeleteUser(ctx, UserID(ctx)); err != nil {
			return nil, Err(http.StatusInternalServerError, "internal", "Could not delete the account.")
		}
		_ = a.Sessions.Destroy(ctx)
		d.Log.WarnContext(ctx, "account deleted", slog.String("request_id", RequestID(ctx)))
		return nil, nil
	})
}

var errSignupClosed = Err(http.StatusForbidden, "signup_disabled", "New accounts are turned off on this server.")

func (d Deps) signup(ctx context.Context, in *signupInput, repo *store.Repo) (*signupOutput, error) {
	a := d.Auth
	if !d.Config.SignupEnabled {
		return nil, errSignupClosed
	}
	if ok, wait := a.Signups.Allow("all"); !ok {
		return nil, tooMany(wait, "Too many new accounts right now. Try again later.")
	}
	c := auth.Challenge{Salt: in.Body.Challenge.Salt, Bits: in.Body.Challenge.Bits, ExpiresAt: in.Body.Challenge.ExpiresAt, Signature: in.Body.Challenge.Signature}
	switch err := a.PoW.Verify(c, uint64(in.Body.Counter)); { // #nosec G115 -- minimum:"0" keeps the counter non-negative
	case errors.Is(err, auth.ErrExpired):
		return nil, Err(http.StatusUnprocessableEntity, "challenge_expired", "That took too long. Try again.")
	case err != nil:
		return nil, Err(http.StatusUnprocessableEntity, "challenge_invalid", "The check did not pass. Try again.")
	}

	user, codes, err := auth.Register(ctx, d.DB, in.Body.Username, in.Body.Password)
	switch {
	case errors.Is(err, auth.ErrBadUsername):
		return nil, Err(http.StatusUnprocessableEntity, "invalid_username", "Use 3 to 64 letters, numbers or . _ - @ +, starting with a letter or number.")
	case errors.Is(err, auth.ErrWeakPassword):
		return nil, Err(http.StatusUnprocessableEntity, "weak_password", err.Error())
	case errors.Is(err, domain.ErrConflict):
		return nil, Err(http.StatusConflict, "username_taken", "That username is taken.")
	case err != nil:
		d.Log.ErrorContext(ctx, "signup failed", slog.String("error", err.Error()), slog.String("request_id", RequestID(ctx)))
		return nil, Err(http.StatusInternalServerError, "internal", "Could not create the account.")
	}
	if err := d.startSession(ctx, repo, user.ID); err != nil {
		return nil, err
	}
	d.Log.InfoContext(ctx, "signup ok", slog.String("ip", hashIP(clientIP(ctx))), slog.String("request_id", RequestID(ctx)))
	out := &signupOutput{}
	out.Body.User = UserBody{ID: user.ID, Username: user.Username}
	out.Body.RecoveryCodes = codes
	return out, nil
}

// startSession signs the request in as userID with a fresh session token.
func (d Deps) startSession(ctx context.Context, repo *store.Repo, userID string) error {
	if err := d.Auth.Sessions.RenewToken(ctx); err != nil {
		return Err(http.StatusInternalServerError, "internal", "Could not sign in.")
	}
	d.Auth.Sessions.Put(ctx, auth.UserKey, userID)
	if err := repo.TouchLastLogin(ctx, userID, time.Now().UTC().Format(time.RFC3339)); err != nil {
		d.Log.ErrorContext(ctx, "recording last login failed", slog.String("error", err.Error()))
	}
	return nil
}

// limitAttempt counts a password-guessing attempt against the shared login buckets.
func (d Deps) limitAttempt(ctx context.Context, ip, account string) error {
	ok, wait := d.Auth.Limits.Check(ip, account)
	if ok {
		return nil
	}
	d.Log.WarnContext(ctx, "attempt rate limited", slog.String("ip", hashIP(ip)), slog.String("request_id", RequestID(ctx)))
	return tooMany(wait, "Too many attempts. Try again later.")
}

// confirmPassword re-checks the signed-in user's password before a destructive account action.
func (d Deps) confirmPassword(ctx context.Context, repo *store.Repo, bucket, password string) error {
	uid := UserID(ctx)
	if err := d.limitAttempt(ctx, clientIP(ctx), bucket+uid); err != nil {
		return err
	}
	u, err := repo.UserByID(ctx, uid)
	if err != nil {
		return Err(http.StatusUnauthorized, "unauthorized", "Sign in to continue.")
	}
	ok, err := auth.VerifyPassword(password, u.PasswordHash)
	if err != nil || !ok {
		return Err(http.StatusUnauthorized, "invalid_credentials", "That password is not correct.")
	}
	d.Auth.Limits.Succeeded(bucket + uid)
	return nil
}

func tooMany(wait time.Duration, msg string) error {
	h := http.Header{}
	h.Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
	return huma.ErrorWithHeaders(Err(http.StatusTooManyRequests, "rate_limited", msg), h)
}
