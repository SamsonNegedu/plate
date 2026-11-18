package sync

import "plate/internal/domain"

// FormatVersion is the export format this build writes. It imports this version and the one before it.
const FormatVersion = 1

type FoodDoc struct {
	ID              string   `json:"id" format:"uuid"`
	Barcode         *string  `json:"barcode" nullable:"true"`
	Name            string   `json:"name"`
	Brand           string   `json:"brand"`
	Quantity        string   `json:"quantity"`
	ServingSize     string   `json:"serving_size"`
	ServingGrams    *float64 `json:"serving_grams" nullable:"true"`
	Kcal            float64  `json:"kcal"`
	Protein         *float64 `json:"protein" nullable:"true"`
	Carbs           *float64 `json:"carbs" nullable:"true"`
	Fat             *float64 `json:"fat" nullable:"true"`
	Sugar           *float64 `json:"sugar" nullable:"true"`
	SatFat          *float64 `json:"satfat" nullable:"true"`
	Fiber           *float64 `json:"fiber" nullable:"true"`
	Salt            *float64 `json:"salt" nullable:"true"`
	Nutriscore      *string  `json:"nutriscore" nullable:"true"`
	Source          string   `json:"source" enum:"off,bls,user,catalog"`
	SourceID        *string  `json:"source_id" nullable:"true"`
	SourceUpdatedAt *string  `json:"source_updated_at" nullable:"true"`
	SourceCheckedAt *string  `json:"source_checked_at" nullable:"true"`
	ImageKey        *string  `json:"image_key" nullable:"true"`
	Ingredients     string   `json:"ingredients"`
	Allergens       string   `json:"allergens"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
	DeletedAt       *string  `json:"deleted_at" nullable:"true"`
	ServerSeq       int64    `json:"server_seq"`
}

type SavedMealItemDoc struct {
	ID       string   `json:"id" format:"uuid"`
	FoodID   *string  `json:"food_id" nullable:"true"`
	Name     string   `json:"name"`
	Brand    string   `json:"brand"`
	Amount   float64  `json:"amount"`
	Unit     string   `json:"unit" enum:"g,ml,piece,serving"`
	Grams    float64  `json:"grams"`
	Kcal     float64  `json:"kcal"`
	Protein  *float64 `json:"protein" nullable:"true"`
	Carbs    *float64 `json:"carbs" nullable:"true"`
	Fat      *float64 `json:"fat" nullable:"true"`
	Sugar    *float64 `json:"sugar" nullable:"true"`
	SatFat   *float64 `json:"satfat" nullable:"true"`
	Fiber    *float64 `json:"fiber" nullable:"true"`
	Salt     *float64 `json:"salt" nullable:"true"`
	Position int64    `json:"position"`
}

type SavedMealDoc struct {
	ID        string             `json:"id" format:"uuid"`
	Name      string             `json:"name"`
	Items     []SavedMealItemDoc `json:"items"`
	CreatedAt string             `json:"created_at"`
	UpdatedAt string             `json:"updated_at"`
	DeletedAt *string            `json:"deleted_at" nullable:"true"`
	ServerSeq int64              `json:"server_seq"`
}

type FavoriteDoc struct {
	FoodID    string  `json:"food_id" format:"uuid"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	DeletedAt *string `json:"deleted_at" nullable:"true"`
	ServerSeq int64   `json:"server_seq"`
}

type TombstoneDoc struct {
	ID        string `json:"id" format:"uuid"`
	DeletedAt string `json:"deleted_at"`
}

// ExportDoc is the full JSON backup. It never includes the shared OFF cache beyond foods the log references.
type ExportDoc struct {
	FormatVersion  int            `json:"format_version"`
	SchemaVersion  int64          `json:"schema_version"`
	ExportedAt     string         `json:"exported_at"`
	AppVersion     string         `json:"app_version"`
	Settings       *SettingsDoc   `json:"settings,omitempty" required:"false" doc:"Absent until goals were saved."`
	Entries        []EntryDoc     `json:"entries"`
	DeletedEntries []TombstoneDoc `json:"deleted_entries"`
	Foods          []FoodDoc      `json:"foods"`
	SavedMeals     []SavedMealDoc `json:"saved_meals"`
	Favorites      []FavoriteDoc  `json:"favorites"`
	Attribution    []string       `json:"attribution,omitempty" required:"false" doc:"Credits for the data sources the foods come from."`
}

func FoodToDoc(f domain.Food) FoodDoc {
	return FoodDoc{
		ID: f.ID, Barcode: f.Barcode, Name: f.Name, Brand: f.Brand, Quantity: f.Quantity, ServingSize: f.ServingSize,
		ServingGrams: f.ServingGrams, Kcal: f.Per100.Kcal, Protein: f.Per100.Protein, Carbs: f.Per100.Carbs,
		Fat: f.Per100.Fat, Sugar: f.Per100.Sugar, SatFat: f.Per100.SatFat, Fiber: f.Per100.Fiber, Salt: f.Per100.Salt,
		Nutriscore: f.Nutriscore, Source: string(f.Source), SourceID: f.SourceID, SourceUpdatedAt: f.SourceUpdatedAt,
		SourceCheckedAt: f.SourceCheckedAt, ImageKey: f.ImageKey, Ingredients: f.Ingredients, Allergens: f.Allergens,
		CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt, DeletedAt: f.DeletedAt, ServerSeq: f.ServerSeq,
	}
}

func DocToFood(d FoodDoc, userID string) domain.Food {
	return domain.Food{
		ID: d.ID, UserID: userID, Barcode: d.Barcode, Name: d.Name, Brand: d.Brand, Quantity: d.Quantity,
		ServingSize: d.ServingSize, ServingGrams: d.ServingGrams,
		Per100: domain.Nutrients{
			Kcal: d.Kcal, Protein: d.Protein, Carbs: d.Carbs, Fat: d.Fat, Sugar: d.Sugar, SatFat: d.SatFat,
			Fiber: d.Fiber, Salt: d.Salt,
		},
		Nutriscore: d.Nutriscore, Source: domain.Source(d.Source), SourceID: d.SourceID,
		SourceUpdatedAt: d.SourceUpdatedAt, SourceCheckedAt: d.SourceCheckedAt, ImageKey: d.ImageKey,
		Ingredients: d.Ingredients, Allergens: d.Allergens, SearchName: domain.SearchName(d.Name + " " + d.Brand),
		CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt, DeletedAt: d.DeletedAt, ServerSeq: d.ServerSeq,
	}
}

func MealToDoc(m domain.SavedMeal) SavedMealDoc {
	items := make([]SavedMealItemDoc, 0, len(m.Items))
	for _, it := range m.Items {
		items = append(items, SavedMealItemDoc{
			ID: it.ID, FoodID: it.FoodID, Name: it.Name, Brand: it.Brand, Amount: it.Amount, Unit: string(it.Unit),
			Grams: it.Grams, Kcal: it.Snapshot.Kcal, Protein: it.Snapshot.Protein, Carbs: it.Snapshot.Carbs,
			Fat: it.Snapshot.Fat, Sugar: it.Snapshot.Sugar, SatFat: it.Snapshot.SatFat, Fiber: it.Snapshot.Fiber,
			Salt: it.Snapshot.Salt, Position: it.Position,
		})
	}
	return SavedMealDoc{
		ID: m.ID, Name: m.Name, Items: items, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
		DeletedAt: m.DeletedAt, ServerSeq: m.ServerSeq,
	}
}

func DocToMeal(d SavedMealDoc, userID string) domain.SavedMeal {
	items := make([]domain.SavedMealItem, 0, len(d.Items))
	for _, it := range d.Items {
		items = append(items, domain.SavedMealItem{
			ID: it.ID, SavedMealID: d.ID, FoodID: it.FoodID, Name: it.Name, Brand: it.Brand, Amount: it.Amount,
			Unit: domain.Unit(it.Unit), Grams: it.Grams, Position: it.Position,
			Snapshot: domain.Nutrients{
				Kcal: it.Kcal, Protein: it.Protein, Carbs: it.Carbs, Fat: it.Fat, Sugar: it.Sugar,
				SatFat: it.SatFat, Fiber: it.Fiber, Salt: it.Salt,
			},
		})
	}
	return domain.SavedMeal{
		ID: d.ID, UserID: userID, Name: d.Name, CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
		DeletedAt: d.DeletedAt, ServerSeq: d.ServerSeq, Items: items,
	}
}

func FavoriteToDoc(f domain.Favorite) FavoriteDoc {
	return FavoriteDoc{FoodID: f.FoodID, CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt, DeletedAt: f.DeletedAt, ServerSeq: f.ServerSeq}
}

func DocToFavorite(d FavoriteDoc, userID string) domain.Favorite {
	return domain.Favorite{
		UserID: userID, FoodID: d.FoodID, CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
		DeletedAt: d.DeletedAt, ServerSeq: d.ServerSeq,
	}
}
