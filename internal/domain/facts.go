package domain

// FactStatus is where a product-fact revision stands (ADR-020).
type FactStatus string

const (
	FactPending    FactStatus = "pending"
	FactAccepted   FactStatus = "accepted"
	FactSuperseded FactStatus = "superseded"
	FactReverted   FactStatus = "reverted"
)

// FactOrigin says what the revision changed on top of what Open Food Facts or the catalog already knew.
type FactOrigin string

const (
	OriginCorrection FactOrigin = "off_correction"
	OriginFilled     FactOrigin = "off_missing_fields"
	OriginNew        FactOrigin = "new_product"
)

// FactRevision is one submitted version of a product's facts. Field names follow Open Food Facts so a revision can be
// pushed upstream later. It carries no account id, only an opaque contributor.
type FactRevision struct {
	ID              string
	Barcode         string
	Contributor     string
	Source          string // "manual" or "ocr"
	Origin          FactOrigin
	Status          FactStatus
	AppVersion      string
	Lang            string
	Countries       string
	Name            string
	Brand           string
	Quantity        string
	ServingSize     string
	ServingGrams    *float64
	IngredientsText string
	Per100          Nutrients
	EnergyKJ        *float64
	LabelImage      []byte
	FrontImage      []byte
	SubmittedAt     string
	AcceptedAt      *string
	PushedAt        *string
}
