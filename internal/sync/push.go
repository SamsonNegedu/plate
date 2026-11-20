package sync

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
)

type storedResult struct {
	Status   string `json:"status"`
	Conflict bool   `json:"conflict,omitempty"`
}

// Push applies a batch in one transaction with a savepoint per op. A rejected or tombstoned op rolls back only itself.
// A repeated op_id returns its recorded outcome as a duplicate.
func (s *Service) Push(ctx context.Context, userID string, req PushRequest) (PushResponse, error) {
	if len(req.Ops) > MaxBatchOps {
		return PushResponse{}, fmt.Errorf("%d ops, the limit is %d: %w", len(req.Ops), MaxBatchOps, ErrBatchTooLarge)
	}
	if _, err := uuid.Parse(req.ClientID); err != nil {
		return PushResponse{}, bad("client_id", "must be a UUID")
	}
	var resp PushResponse
	ctx = withRoom(ctx)
	err := store.WithTx(ctx, s.db, func(conn *sql.Conn) error {
		resp = PushResponse{Results: make([]OpResult, 0, len(req.Ops))}
		repo := store.NewRepo(conn)
		now := s.now()
		for i, op := range req.Ops {
			sp := fmt.Sprintf("op%d", i)
			if _, err := conn.ExecContext(ctx, "SAVEPOINT "+sp); err != nil { // #nosec G202 -- sp is "op<index>", never user input
				return fmt.Errorf("opening savepoint: %w", err)
			}
			res, keep, err := s.applyOp(ctx, repo, userID, req.ClientID, op, now)
			if err != nil {
				return err // an infrastructure failure aborts the whole batch; the client retries it safely
			}
			finish := "ROLLBACK TO " + sp // #nosec G202 -- sp is "op<index>", never user input
			if keep {
				finish = "RELEASE " + sp // #nosec G202 -- see above
			}
			if _, err := conn.ExecContext(ctx, finish); err != nil {
				return fmt.Errorf("closing savepoint: %w", err)
			}
			if !keep {
				if _, err := conn.ExecContext(ctx, "RELEASE "+sp); err != nil { // #nosec G202 -- see above
					return fmt.Errorf("releasing savepoint: %w", err)
				}
			}
			resp.Results = append(resp.Results, res)
		}
		st, err := repo.SyncState(ctx, userID)
		if err != nil {
			return err
		}
		resp.Cursor = st.HeadSeq
		return nil
	})
	return resp, err
}

func reject(op Op, code, detail string, fields ...domain.FieldError) OpResult {
	p := &OpProblem{Code: code, Detail: detail}
	for _, f := range fields {
		p.Errors = append(p.Errors, FieldProblem{Field: f.Field, Message: f.Message})
	}
	return OpResult{OpID: op.OpID, Status: StatusRejected, Problem: p}
}

func rejectErr(op Op, err error) (OpResult, bool, error) {
	var ve *domain.ValidationError
	switch {
	case errors.As(err, &ve):
		return reject(op, "validation_failed", "Some fields are invalid.", ve.Fields...), false, nil
	case errors.Is(err, domain.ErrNotFound):
		return reject(op, "not_found", "The row does not exist."), false, nil
	case errors.Is(err, domain.ErrLimitReached):
		return reject(op, "limit_reached", "This account has reached its storage limit. Delete something before adding more."), false, nil
	case errors.Is(err, domain.ErrConflict):
		return reject(op, "conflict", err.Error()), false, nil
	case errors.Is(err, domain.ErrInvalid):
		return reject(op, "validation_failed", err.Error()), false, nil
	}
	return OpResult{}, false, err
}

// applyOp returns the result and whether its writes stay (false rolls the savepoint back).
func (s *Service) applyOp(ctx context.Context, r *store.Repo, userID, clientID string, op Op, now time.Time) (OpResult, bool, error) {
	if _, err := uuid.Parse(op.OpID); err != nil {
		return reject(op, "validation_failed", "op_id must be a UUID"), false, nil //nolint:nilerr // a bad op is rejected, not an error
	}
	if len(op.Data) > MaxOpDataBytes {
		return reject(op, "payload_too_large", "op data is larger than 256 KB"), false, nil
	}
	if stored, found, err := r.SyncOp(ctx, userID, op.OpID); err != nil {
		return OpResult{}, false, err
	} else if found {
		var sr storedResult
		_ = json.Unmarshal([]byte(stored.Result), &sr)
		seq := stored.ServerSeq
		return OpResult{OpID: op.OpID, Status: StatusDuplicate, ServerSeq: &seq, Conflict: sr.Conflict}, false, nil
	}
	if op.Type != "upsert" && op.Type != "delete" {
		return reject(op, "validation_failed", "type must be upsert or delete"), false, nil
	}

	var (
		seq      int64
		conflict bool
		res      *OpResult
		err      error
	)
	switch op.Entity {
	case EntityEntry:
		seq, conflict, res, err = s.opEntry(ctx, r, userID, op, now)
	case EntityFood:
		seq, conflict, res, err = s.opFood(ctx, r, userID, op, now)
	case EntitySettings:
		seq, conflict, res, err = s.opSettings(ctx, r, userID, op, now)
	case EntitySavedMeal:
		seq, conflict, res, err = s.opSavedMeal(ctx, r, userID, op, now)
	case EntityFavorite:
		seq, conflict, res, err = s.opFavorite(ctx, r, userID, op, now)
	case EntityHealth:
		seq, conflict, res, err = s.opHealth(ctx, r, userID, op, now)
	default:
		return reject(op, "validation_failed", "unknown entity"), false, nil
	}
	if err != nil {
		return rejectErr(op, err)
	}
	if res != nil {
		return *res, false, nil
	}
	result, _ := json.Marshal(storedResult{Status: StatusApplied, Conflict: conflict})
	if err := r.PutSyncOp(ctx, userID, op.OpID, clientID, string(result), seq, stamp(now)); err != nil {
		return rejectErr(op, fmt.Errorf("op id is already used by another account: %w", domain.ErrConflict))
	}
	return OpResult{OpID: op.OpID, Status: StatusApplied, ServerSeq: &seq, Conflict: conflict}, true, nil
}

func tombstoned(op Op, doc any) *OpResult {
	b, _ := json.Marshal(doc)
	return &OpResult{OpID: op.OpID, Status: StatusTombstoned, Tombstone: b}
}

func decode(op Op, into any) error {
	if len(bytes.TrimSpace(op.Data)) == 0 {
		return bad("data", "is required for an upsert")
	}
	dec := json.NewDecoder(bytes.NewReader(op.Data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return bad("data", err.Error())
	}
	return nil
}

func newer(existingSeq int64, base *int64) bool { return base != nil && existingSeq > *base }

func (s *Service) opEntry(ctx context.Context, r *store.Repo, userID string, op Op, now time.Time) (int64, bool, *OpResult, error) {
	if _, err := uuid.Parse(op.ID); err != nil {
		return 0, false, nil, bad("id", "must be a UUID")
	}
	if op.Type == "delete" {
		existing, err := r.Entry(ctx, userID, op.ID)
		if err != nil {
			return 0, false, nil, err
		}
		changed, err := ApplyEntryDelete(ctx, r, userID, op.ID, now)
		if err != nil {
			return 0, false, nil, err
		}
		seq := existing.ServerSeq
		if changed {
			if e, err := r.Entry(ctx, userID, op.ID); err == nil {
				seq = e.ServerSeq
			}
		}
		return seq, false, nil, nil
	}
	var body EntryBody
	if err := decode(op, &body); err != nil {
		return 0, false, nil, err
	}
	e := entryFromBody(body, op.ID, userID)
	if err := domain.ValidateEntry(e, now); err != nil {
		return 0, false, nil, err
	}
	conflict := false
	if existing, err := r.Entry(ctx, userID, op.ID); err == nil {
		conflict = newer(existing.ServerSeq, op.BaseSeq)
	}
	out, err := ApplyEntry(ctx, r, userID, e, now)
	if errors.Is(err, domain.ErrTombstoned) {
		return 0, false, tombstoned(op, EntryToDoc(out)), nil
	}
	if err != nil {
		return 0, false, nil, err
	}
	return out.ServerSeq, conflict, nil, nil
}

func (s *Service) opHealth(ctx context.Context, r *store.Repo, userID string, op Op, now time.Time) (int64, bool, *OpResult, error) {
	if _, err := uuid.Parse(op.ID); err != nil {
		return 0, false, nil, bad("id", "must be a UUID")
	}
	if op.Type == "delete" {
		existing, err := r.HealthRecord(ctx, userID, op.ID)
		if err != nil {
			return 0, false, nil, err
		}
		changed, err := ApplyHealthDelete(ctx, r, userID, op.ID, now)
		if err != nil {
			return 0, false, nil, err
		}
		seq := existing.ServerSeq
		if changed {
			if h, err := r.HealthRecord(ctx, userID, op.ID); err == nil {
				seq = h.ServerSeq
			}
		}
		return seq, false, nil, nil
	}
	var body HealthRecordBody
	if err := decode(op, &body); err != nil {
		return 0, false, nil, err
	}
	h := healthFromBody(body, op.ID, userID)
	if err := domain.ValidateHealthRecord(h, now); err != nil {
		return 0, false, nil, err
	}
	conflict := false
	if existing, err := r.HealthRecord(ctx, userID, op.ID); err == nil {
		conflict = newer(existing.ServerSeq, op.BaseSeq)
	}
	out, err := ApplyHealthRecord(ctx, r, userID, h, now)
	if errors.Is(err, domain.ErrTombstoned) {
		return 0, false, tombstoned(op, HealthToDoc(out)), nil
	}
	if err != nil {
		return 0, false, nil, err
	}
	return out.ServerSeq, conflict, nil, nil
}

func (s *Service) opFood(ctx context.Context, r *store.Repo, userID string, op Op, now time.Time) (int64, bool, *OpResult, error) {
	if _, err := uuid.Parse(op.ID); err != nil {
		return 0, false, nil, bad("id", "must be a UUID")
	}
	existing, err := r.Food(ctx, userID, op.ID)
	found := err == nil
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return 0, false, nil, err
	}
	if op.Type == "delete" {
		if !found {
			return 0, false, nil, fmt.Errorf("food %s: %w", op.ID, domain.ErrNotFound)
		}
		if existing.Source != domain.SourceUser {
			return 0, false, rejectedResult(op, "forbidden", "Only your own foods can be deleted; cached foods are managed by the server."), nil
		}
		if existing.DeletedAt != nil {
			return existing.ServerSeq, false, nil, nil
		}
		t := stamp(now)
		existing.DeletedAt = &t
		out, err := ApplyFood(ctx, r, existing, now)
		return out.ServerSeq, false, nil, err
	}

	var body FoodBody
	if err := decode(op, &body); err != nil {
		return 0, false, nil, err
	}
	if found && existing.DeletedAt != nil {
		return 0, false, tombstoned(op, FoodToDoc(existing)), nil
	}
	n, ok := domain.SanitizeNutrients(domain.Nutrients{
		Kcal: body.Kcal, Protein: body.Protein, Carbs: body.Carbs, Fat: body.Fat, Sugar: body.Sugar, SatFat: body.SatFat,
		Fiber: body.Fiber, Salt: body.Salt,
	})
	if !ok {
		return 0, false, nil, bad("kcal", "nutrition values are not plausible per 100 g")
	}
	f := existing
	if !found {
		if err := checkFoodRoom(ctx, r, userID); err != nil {
			return 0, false, nil, err
		}
		f = domain.Food{ID: op.ID, UserID: userID, CreatedAt: stamp(now)}
	}
	f.Name, f.Brand, f.Quantity, f.ServingSize = trim(body.Name), trim(body.Brand), body.Quantity, body.ServingSize
	if f.Name == "" {
		return 0, false, nil, bad("name", "is required")
	}
	f.ServingGrams, f.Per100, f.Source = body.ServingGrams, n, domain.SourceUser
	if body.Nutriscore != nil {
		f.Nutriscore = body.Nutriscore
	}
	f.Barcode = nil
	if body.Barcode != nil {
		code, _, err := domain.NormalizeBarcode(*body.Barcode)
		if err != nil {
			return 0, false, nil, bad("barcode", "must have 6 to 14 digits")
		}
		if owner, err := r.FoodByBarcode(ctx, userID, code); err == nil && owner.ID != f.ID {
			return 0, false, rejectedResult(op, "barcode_taken", "Another food already has this barcode."), nil
		}
		f.Barcode = &code
	}
	f.SearchName = domain.SearchName(f.Name + " " + f.Brand)
	out, err := ApplyFood(ctx, r, f, now)
	if err != nil {
		return 0, false, nil, err
	}
	return out.ServerSeq, found && newer(existing.ServerSeq, op.BaseSeq), nil, nil
}

func rejectedResult(op Op, code, detail string) *OpResult {
	r := reject(op, code, detail)
	return &r
}

func trim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\n') {
		s = s[:len(s)-1]
	}
	return s
}

func (s *Service) opSettings(ctx context.Context, r *store.Repo, userID string, op Op, now time.Time) (int64, bool, *OpResult, error) {
	if op.ID != userID {
		return 0, false, rejectedResult(op, "validation_failed", "A settings op must use your user id as its id."), nil
	}
	if op.Type == "delete" {
		return 0, false, rejectedResult(op, "validation_failed", "Settings cannot be deleted."), nil
	}
	var body SettingsBody
	if err := decode(op, &body); err != nil {
		return 0, false, nil, err
	}
	in := settingsFromBody(body, userID)
	if err := domain.ValidateSettings(in); err != nil {
		return 0, false, nil, err
	}
	conflict := false
	if existing, err := r.Settings(ctx, userID); err == nil {
		conflict = newer(existing.ServerSeq, op.BaseSeq)
	}
	out, err := ApplySettings(ctx, r, userID, in, now)
	return out.ServerSeq, conflict, nil, err
}

func (s *Service) opSavedMeal(ctx context.Context, r *store.Repo, userID string, op Op, now time.Time) (int64, bool, *OpResult, error) {
	if _, err := uuid.Parse(op.ID); err != nil {
		return 0, false, nil, bad("id", "must be a UUID")
	}
	existing, err := r.SavedMeal(ctx, userID, op.ID)
	found := err == nil
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return 0, false, nil, err
	}
	if op.Type == "delete" {
		if !found {
			return 0, false, nil, fmt.Errorf("saved meal %s: %w", op.ID, domain.ErrNotFound)
		}
		if existing.DeletedAt != nil {
			return existing.ServerSeq, false, nil, nil
		}
		t := stamp(now)
		existing.DeletedAt, existing.UpdatedAt = &t, t
		seq, err := writeMealSeq(ctx, r, existing, "delete", now)
		return seq, false, nil, err
	}
	if found && existing.DeletedAt != nil {
		return 0, false, tombstoned(op, MealToDoc(existing)), nil
	}
	var body SavedMealBody
	if err := decode(op, &body); err != nil {
		return 0, false, nil, err
	}
	if err := validateMeal(ctx, r, userID, body); err != nil {
		return 0, false, nil, err
	}
	m := DocToMeal(SavedMealDoc{ID: op.ID, Name: trim(body.Name), Servings: body.Servings, Items: body.Items}, userID)
	m.CreatedAt = stamp(now)
	if found {
		m.CreatedAt = existing.CreatedAt
	}
	m.UpdatedAt = stamp(now)
	seq, err := writeMealSeq(ctx, r, m, "upsert", now)
	return seq, found && newer(existing.ServerSeq, op.BaseSeq), nil, err
}

func writeMealSeq(ctx context.Context, r *store.Repo, m domain.SavedMeal, op string, now time.Time) (int64, error) {
	if err := writeMeal(ctx, r, m, op, now); err != nil {
		return 0, err
	}
	out, err := r.SavedMeal(ctx, m.UserID, m.ID)
	return out.ServerSeq, err
}

func validateMeal(ctx context.Context, r *store.Repo, userID string, b SavedMealBody) error {
	var fields []domain.FieldError
	if trim(b.Name) == "" {
		fields = append(fields, domain.FieldError{Field: "name", Message: "is required"})
	}
	if b.Servings != 0 && !(b.Servings > 0 && b.Servings <= domain.MaxServings) {
		fields = append(fields, domain.FieldError{Field: "servings", Message: "must be above 0 and at most 1000"})
	}
	seen := map[string]bool{}
	for i, it := range b.Items {
		field := fmt.Sprintf("items[%d]", i)
		if _, err := uuid.Parse(it.ID); err != nil || seen[it.ID] {
			fields = append(fields, domain.FieldError{Field: field + ".id", Message: "must be a unique UUID"})
		}
		seen[it.ID] = true
		if !domain.Unit(it.Unit).Valid() || !(it.Amount > 0) || !(it.Grams > 0) || trim(it.Name) == "" {
			fields = append(fields, domain.FieldError{Field: field, Message: "needs a name, a unit, and positive amount and grams"})
		}
		if _, ok := domain.SanitizeNutrients(domain.Nutrients{
			Kcal: it.Kcal, Protein: it.Protein, Carbs: it.Carbs, Fat: it.Fat, Sugar: it.Sugar, SatFat: it.SatFat, Fiber: it.Fiber, Salt: it.Salt,
		}); !ok {
			fields = append(fields, domain.FieldError{Field: field + ".kcal", Message: "nutrition values are not plausible"})
		}
		if it.FoodID != nil {
			if ok, err := r.FoodExists(ctx, userID, *it.FoodID); err != nil {
				return err
			} else if !ok {
				fields = append(fields, domain.FieldError{Field: field + ".food_id", Message: "food does not exist"})
			}
		}
	}
	if len(fields) > 0 {
		return &domain.ValidationError{Fields: fields}
	}
	return nil
}

func (s *Service) opFavorite(ctx context.Context, r *store.Repo, userID string, op Op, now time.Time) (int64, bool, *OpResult, error) {
	if _, err := uuid.Parse(op.ID); err != nil {
		return 0, false, nil, bad("id", "must be the food's UUID")
	}
	if ok, err := r.FoodExists(ctx, userID, op.ID); err != nil {
		return 0, false, nil, err
	} else if !ok {
		return 0, false, nil, fmt.Errorf("food %s: %w", op.ID, domain.ErrNotFound)
	}
	fav, _, err := ApplyFavorite(ctx, r, userID, op.ID, op.Type == "upsert", now)
	return fav.ServerSeq, false, nil, err
}
