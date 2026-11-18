package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	psync "plate/internal/sync"
)

type pushIn struct {
	Body psync.PushRequest
}

type pushOut struct{ Body psync.PushResponse }

type pullIn struct {
	Since int64 `query:"since" minimum:"0" default:"0" doc:"The last sequence the client has applied. Changes with a greater seq are returned."`
	Limit int   `query:"limit" minimum:"1" maximum:"500" default:"100"`
}

type pullOut struct{ Body psync.PullResponse }

type snapshotOut struct{ Body psync.Snapshot }

type metaOut struct{ Body psync.Meta }

func (d Deps) syncDisabled() error {
	p := Err(http.StatusServiceUnavailable, "sync_disabled", "Sync is paused by the server. Keep logging; your entries are kept and will sync later.")
	secs := 60
	p.RetryAfter = &secs
	h := http.Header{}
	h.Set("Retry-After", "60")
	return huma.ErrorWithHeaders(p, h)
}

func (d Deps) registerSync(api huma.API, sv *psync.Service) {
	if d.Auth == nil {
		return
	}
	op := func(id, method, path, summary string, errs ...int) huma.Operation {
		return huma.Operation{
			OperationID: id, Method: method, Path: path, Tags: []string{"sync"}, Summary: summary, Security: sessionSecurity,
			Errors: append([]int{http.StatusServiceUnavailable}, errs...),
		}
	}

	push := op("sync-push", http.MethodPost, "/sync/push", "Apply a batch of client mutations", http.StatusUnprocessableEntity)
	push.Description = "At most 100 ops. Each op is applied under its own savepoint: a rejected op rolls back only itself. " +
		"A repeated op_id returns its recorded outcome as a duplicate."
	huma.Register(api, push, func(ctx context.Context, in *pushIn) (*pushOut, error) {
		if !d.Config.SyncEnabled {
			return nil, d.syncDisabled()
		}
		res, err := sv.Push(ctx, UserID(ctx), in.Body)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		return &pushOut{Body: res}, nil
	})

	pull := op("sync-pull", http.MethodGet, "/sync/pull", "Changes after a cursor, oldest first", http.StatusConflict)
	huma.Register(api, pull, func(ctx context.Context, in *pullIn) (*pullOut, error) {
		if !d.Config.SyncEnabled {
			return nil, d.syncDisabled()
		}
		res, err := sv.Pull(ctx, UserID(ctx), in.Since, in.Limit)
		var re *psync.ResyncError
		if errors.As(err, &re) {
			p := Err(http.StatusConflict, "resync_required", "This device is too far behind. Take a snapshot.")
			p.RequestID = RequestID(ctx)
			p.MinSeq = &re.MinSeq
			return nil, p
		}
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		return &pullOut{Body: res}, nil
	})

	huma.Register(api, op("sync-snapshot", http.MethodGet, "/sync/snapshot", "Every live row plus a cursor to continue from"),
		func(ctx context.Context, _ *struct{}) (*snapshotOut, error) {
			if !d.Config.SyncEnabled {
				return nil, d.syncDisabled()
			}
			snap, err := sv.Snapshot(ctx, UserID(ctx))
			if err != nil {
				return nil, d.toAPIError(ctx, err)
			}
			return &snapshotOut{Body: snap}, nil
		})

	huma.Register(api, op("sync-meta", http.MethodGet, "/sync/meta", "Stream bounds and whether sync is enabled"),
		func(ctx context.Context, _ *struct{}) (*metaOut, error) {
			m, err := sv.Meta(ctx, UserID(ctx), d.Config.SyncEnabled)
			if err != nil {
				return nil, d.toAPIError(ctx, err)
			}
			return &metaOut{Body: m}, nil
		})
}
