// Package domain holds the types and rules shared by the HTTP layer, the sync engine and the store.
package domain

import (
	"errors"
	"regexp"
	"strings"
	"unicode"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("conflict")
	ErrInvalid      = errors.New("invalid")
	ErrNotLoggable  = errors.New("food has no kcal and cannot be logged")
	ErrTombstoned   = errors.New("row was deleted")
	ErrLimitReached = errors.New("account limit reached")
	ErrUnauthorized = errors.New("unauthorized")
)

type Meal string

const (
	Breakfast Meal = "breakfast"
	Lunch     Meal = "lunch"
	Dinner    Meal = "dinner"
	Snack     Meal = "snack"
)

func (m Meal) Valid() bool {
	switch m {
	case Breakfast, Lunch, Dinner, Snack:
		return true
	}
	return false
}

type Unit string

const (
	Gram    Unit = "g"
	Milli   Unit = "ml"
	Piece   Unit = "piece"
	Serving Unit = "serving"
)

func (u Unit) Valid() bool {
	switch u {
	case Gram, Milli, Piece, Serving:
		return true
	}
	return false
}

type Source string

const (
	SourceOFF     Source = "off"
	SourceBLS     Source = "bls"
	SourceUser    Source = "user"
	SourceCatalog Source = "catalog"
)

func (s Source) Valid() bool {
	switch s {
	case SourceOFF, SourceBLS, SourceUser, SourceCatalog:
		return true
	}
	return false
}

// Nutrients are per 100 g (or 100 ml). A nil pointer means "not reported", never zero.
type Nutrients struct {
	Kcal    float64
	Protein *float64
	Carbs   *float64
	Fat     *float64
	Sugar   *float64
	SatFat  *float64
	Fiber   *float64
	Salt    *float64
}

type User struct {
	ID           string
	Username     string
	PasswordHash string
	CreatedAt    string
	UpdatedAt    string
	LastLoginAt  *string
}

type Settings struct {
	UserID       string
	GoalKcal     int64
	ProteinG     int64
	CarbsG       int64
	FatG         int64
	FiberG       int64
	DayStartHour int64
	Theme        string
	// WeightGoalKg and the medication plan are optional: nil means not set.
	WeightGoalKg    *float64
	MedName         *string
	MedIntervalDays *int64
	MedStartedOn    *string
	MedSupplyDoses  *int64
	MedSupplyAsOf   *string
	CreatedAt       string
	UpdatedAt       string
	ServerSeq       int64
}

// HealthKind is what a health record measures.
type HealthKind string

const (
	HealthWeight   HealthKind = "weight"
	HealthWaist    HealthKind = "waist"
	HealthHips     HealthKind = "hips"
	HealthChest    HealthKind = "chest"
	HealthArm      HealthKind = "arm"
	HealthThigh    HealthKind = "thigh"
	HealthNeck     HealthKind = "neck"
	HealthAppetite HealthKind = "appetite"
	HealthNausea   HealthKind = "nausea"
	HealthDose     HealthKind = "dose"
)

func (k HealthKind) Valid() bool {
	switch k {
	case HealthWeight, HealthWaist, HealthHips, HealthChest, HealthArm, HealthThigh, HealthNeck, HealthAppetite, HealthNausea, HealthDose:
		return true
	}
	return false
}

// HealthRecord is one dated number the person logs: a weight in kg, a body measurement in cm (waist, hips, chest, arm, thigh or neck), an appetite or nausea rating from
// 0 to 5, or a medication dose in mg.
type HealthRecord struct {
	ID         string
	UserID     string
	Kind       HealthKind
	RecordedOn string
	RecordedAt string
	Value      float64
	Medication string
	Site       string
	Note       string
	CreatedAt  string
	UpdatedAt  string
	DeletedAt  *string
	ServerSeq  int64
}

type Food struct {
	ID              string
	UserID          string
	Barcode         *string
	Name            string
	Brand           string
	Quantity        string
	ServingSize     string
	ServingGrams    *float64
	Per100          Nutrients
	Nutriscore      *string
	Source          Source
	SourceID        *string
	SourceUpdatedAt *string
	SourceCheckedAt *string
	ImageKey        *string
	Ingredients     string
	Allergens       string
	SearchName      string
	CreatedAt       string
	UpdatedAt       string
	DeletedAt       *string
	ServerSeq       int64
	// CommunityRev is the accepted product-fact revision this row's nutrition came from (ADR-020), or nil.
	CommunityRev *string
	// Category is the Open Food Facts category this food is compared with (a key of category_stats), or empty.
	Category string
}

type Entry struct {
	ID              string
	UserID          string
	EatenOn         string
	Meal            Meal
	FoodID          *string
	Name            string
	Brand           string
	Barcode         *string
	Amount          float64
	Unit            Unit
	Grams           float64
	Snapshot        Nutrients
	Note            string
	CreatedAt       string
	UpdatedAt       string
	ClientUpdatedAt string
	DeletedAt       *string
	ServerSeq       int64
}

var nonWord = regexp.MustCompile(`[^\p{L}\p{N}]+`)

var fold = strings.NewReplacer(
	"ä", "a", "ö", "o", "ü", "u", "ß", "ss",
	"é", "e", "è", "e", "ê", "e", "à", "a", "â", "a", "ô", "o", "î", "i", "ç", "c", "ñ", "n",
)

// SearchName lowercases, folds umlauts and collapses punctuation so `Gut & Günstig` becomes `gut gunstig`.
func SearchName(s string) string {
	s = fold.Replace(strings.ToLower(s))
	s = nonWord.ReplaceAllString(s, " ")
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s))
}

// MaxServings is the most portions a recipe can make.
const MaxServings = 1000

type SavedMealItem struct {
	ID          string
	SavedMealID string
	FoodID      *string
	Name        string
	Brand       string
	Amount      float64
	Unit        Unit
	Grams       float64
	Snapshot    Nutrients
	Position    int64
}

type SavedMeal struct {
	ID        string
	UserID    string
	Name      string
	Servings  float64
	CreatedAt string
	UpdatedAt string
	DeletedAt *string
	ServerSeq int64
	Items     []SavedMealItem
}

type Favorite struct {
	UserID    string
	FoodID    string
	CreatedAt string
	UpdatedAt string
	DeletedAt *string
	ServerSeq int64
}

// CatalogFood is a row of the shared OFF German seed. Every row is loggable: kcal is required.
type CatalogFood struct {
	Barcode        string
	Name           string
	Brand          string
	Quantity       string
	ServingSize    string
	ServingGrams   *float64
	Per100         Nutrients
	Nutriscore     *string
	ImageSourceURL *string
	Scans          int64
	DatasetVersion string
	ImportedAt     string
	// Category is the category this product is compared with, a key of category_stats; empty when it has none.
	Category string
	// Categories are all the category tags the product carries. Only the catalog builder fills them in; they are never stored.
	Categories []string
}

// ImageRecord tracks one cached product image. SourceURL never leaves the server.
type ImageRecord struct {
	Key         string
	ContentType string
	Bytes       int64
	FetchedAt   string
	LastUsedAt  string
	SourceURL   string
}

// CategoryStats is how one Open Food Facts category looks per 100 g: for each of kcal, fat, protein, carbs and salt the 5th
// percentile, the median and the 95th percentile over its German products. A product far outside these ranges on several
// nutrients at once is almost always a data-entry mistake.
type CategoryStats struct {
	Category string
	N        int
	Ranges   map[string][3]float64
}

// ReferenceFood is a row of the shared generic-food table: a food without a barcode, such as a staple or a soup
// ingredient. Every row is loggable: kcal is required, and any other missing nutrient stays nil.
type ReferenceFood struct {
	// RefID is the stable text key, such as "wafct:02_005".
	RefID          string
	Name           string
	LocalNames     string
	ScientificName string
	Category       string
	Per100         Nutrients
	// Estimated is true when the source marks the energy or a macronutrient as imputed or borrowed, not analysed.
	Estimated      bool
	Source         string
	DatasetVersion string
	ImportedAt     string
}
