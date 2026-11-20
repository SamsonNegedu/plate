package sync

import (
	"encoding/json"
	"errors"
	"fmt"
)

// Limits from the sync plan.
const (
	MaxBatchOps    = 100
	MaxOpDataBytes = 256 << 10
	MaxPullLimit   = 500
	DefaultPull    = 100
)

// Entities that sync. OFF, BLS and catalog foods are server-managed and never travel.
const (
	EntityEntry     = "entry"
	EntityFood      = "food"
	EntitySettings  = "settings"
	EntitySavedMeal = "saved_meal"
	EntityFavorite  = "favorite"
	EntityHealth    = "health_record"
)

// Op is one client mutation. For a favorite, "upsert" adds and "delete" removes; the id is the food id.
// For settings the id is the user id. data holds the entity body (see EntryBody, FoodBody, SettingsBody, SavedMealBody).
type Op struct {
	OpID     string          `json:"op_id" format:"uuid" doc:"UUIDv7 created with the mutation. Replaying it is safe."`
	Entity   string          `json:"entity" enum:"entry,food,settings,saved_meal,favorite,health_record"`
	Type     string          `json:"type" enum:"upsert,delete"`
	ID       string          `json:"id"`
	BaseSeq  *int64          `json:"base_seq,omitempty" required:"false" doc:"Optional. Only used to report a conflict; it never blocks a write."`
	ClientTS string          `json:"client_ts,omitempty" required:"false"`
	Data     json.RawMessage `json:"data,omitempty" required:"false" doc:"The entity body. Required for upsert, absent for delete."`
}

type PushRequest struct {
	ClientID string `json:"client_id" format:"uuid"`
	Ops      []Op   `json:"ops" maxItems:"100"`
}

// Op statuses.
const (
	StatusApplied    = "applied"
	StatusDuplicate  = "duplicate"
	StatusRejected   = "rejected"
	StatusTombstoned = "tombstoned"
)

type OpProblem struct {
	Code   string         `json:"code"`
	Detail string         `json:"detail"`
	Errors []FieldProblem `json:"errors,omitempty"`
}

type FieldProblem struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type OpResult struct {
	OpID      string          `json:"op_id"`
	Status    string          `json:"status" enum:"applied,duplicate,rejected,tombstoned"`
	ServerSeq *int64          `json:"server_seq,omitempty" required:"false"`
	Conflict  bool            `json:"conflict,omitempty" required:"false" doc:"An existing row was newer than base_seq and was overwritten."`
	Problem   *OpProblem      `json:"problem,omitempty" required:"false"`
	Tombstone json.RawMessage `json:"tombstone,omitempty" required:"false" doc:"The deleted row, when status is tombstoned."`
}

type PushResponse struct {
	Results []OpResult `json:"results"`
	Cursor  int64      `json:"cursor" doc:"The user's head sequence after the batch."`
}

type PullChange struct {
	Seq    int64           `json:"seq"`
	Entity string          `json:"entity" enum:"entry,food,settings,saved_meal,favorite,health_record"`
	ID     string          `json:"id"`
	Op     string          `json:"op" enum:"upsert,delete"`
	Data   json.RawMessage `json:"data" doc:"The full row for an upsert; {deleted_at} for a delete."`
}

type PullResponse struct {
	Changes []PullChange `json:"changes"`
	Next    int64        `json:"next" doc:"Pass this as since on the next pull. It equals the last seq in the page, or since when the page is empty."`
	HasMore bool         `json:"has_more"`
}

// SavedMealBody is a recipe (the wire name stays saved_meal): its ingredients and the portions it makes, replaced atomically.
type SavedMealBody struct {
	Name     string             `json:"name" minLength:"1" maxLength:"200"`
	Servings float64            `json:"servings" required:"false" exclusiveMinimum:"0" maximum:"1000" doc:"Portions the recipe makes. Absent means 1."`
	Items    []SavedMealItemDoc `json:"items" maxItems:"100"`
}

// FoodBody is a custom food or a correction. kcal per 100 g is mandatory.
type FoodBody struct {
	Barcode      *string  `json:"barcode" required:"false" nullable:"true" maxLength:"32"`
	Name         string   `json:"name" minLength:"1" maxLength:"200"`
	Brand        string   `json:"brand" required:"false" maxLength:"200"`
	Quantity     string   `json:"quantity" required:"false" maxLength:"100"`
	ServingSize  string   `json:"serving_size" required:"false" maxLength:"100"`
	ServingGrams *float64 `json:"serving_grams" required:"false" nullable:"true" exclusiveMinimum:"0"`
	Kcal         float64  `json:"kcal" minimum:"0" doc:"Required. kcal per 100 g or 100 ml."`
	Protein      *float64 `json:"protein" required:"false" nullable:"true" minimum:"0"`
	Carbs        *float64 `json:"carbs" required:"false" nullable:"true" minimum:"0"`
	Fat          *float64 `json:"fat" required:"false" nullable:"true" minimum:"0"`
	Sugar        *float64 `json:"sugar" required:"false" nullable:"true" minimum:"0"`
	SatFat       *float64 `json:"satfat" required:"false" nullable:"true" minimum:"0"`
	Fiber        *float64 `json:"fiber" required:"false" nullable:"true" minimum:"0"`
	Salt         *float64 `json:"salt" required:"false" nullable:"true" minimum:"0"`
	Nutriscore   *string  `json:"nutriscore" required:"false" nullable:"true" enum:"a,b,c,d,e"`
}

// Snapshot is every live syncable row plus the cursor to continue pulling from.
type Snapshot struct {
	Cursor        int64             `json:"cursor"`
	MinSeq        int64             `json:"min_seq"`
	Settings      *SettingsDoc      `json:"settings,omitempty" required:"false"`
	Foods         []FoodDoc         `json:"foods"`
	Entries       []EntryDoc        `json:"entries"`
	SavedMeals    []SavedMealDoc    `json:"saved_meals"`
	Favorites     []FavoriteDoc     `json:"favorites"`
	HealthRecords []HealthRecordDoc `json:"health_records"`
}

// Meta lets a client detect a retention gap, show "last synced" and tell a kill switch from a network failure.
type Meta struct {
	Enabled    bool   `json:"enabled"`
	Head       int64  `json:"head"`
	MinSeq     int64  `json:"min_seq"`
	ServerTime string `json:"server_time"`
}

// ErrBatchTooLarge is returned for a push with more than MaxBatchOps ops.
var ErrBatchTooLarge = errors.New("too many ops in one push")

// ResyncError means the client's cursor is below the user's min_seq and it must take a snapshot.
type ResyncError struct{ MinSeq int64 }

func (e *ResyncError) Error() string {
	return fmt.Sprintf("cursor is below min_seq %d: a snapshot is required", e.MinSeq)
}
