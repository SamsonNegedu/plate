package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"plate/internal/domain"
	"plate/internal/food"
	"plate/internal/store"
)

const staleAfterDays = 90

// FoodView is a loggable food as the client sees it. Nutrients are per 100 g; null means not reported.
type FoodView struct {
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
	SourceCheckedAt *string  `json:"source_checked_at" nullable:"true"`
	Stale           bool     `json:"stale" doc:"Cached from Open Food Facts and not checked for 90 days."`
	ImagePath       *string  `json:"image_path" nullable:"true" doc:"Same-origin path of the product image."`
	Ingredients     string   `json:"ingredients"`
	Allergens       string   `json:"allergens"`
	UpdatedAt       string   `json:"updated_at"`
}

func imagePath(key *string) *string {
	if key == nil || *key == "" {
		return nil
	}
	p := APIPrefix + "/images/" + *key
	return &p
}

func (d Deps) foodView(f domain.Food) FoodView {
	v := FoodView{
		ID: f.ID, Barcode: f.Barcode, Name: f.Name, Brand: f.Brand, Quantity: f.Quantity, ServingSize: f.ServingSize,
		ServingGrams: f.ServingGrams, Kcal: f.Per100.Kcal, Protein: f.Per100.Protein, Carbs: f.Per100.Carbs, Fat: f.Per100.Fat,
		Sugar: f.Per100.Sugar, SatFat: f.Per100.SatFat, Fiber: f.Per100.Fiber, Salt: f.Per100.Salt, Nutriscore: f.Nutriscore,
		Source: string(f.Source), SourceID: f.SourceID, SourceCheckedAt: f.SourceCheckedAt, ImagePath: imagePath(f.ImageKey),
		Ingredients: f.Ingredients, Allergens: f.Allergens, UpdatedAt: f.UpdatedAt,
	}
	if f.Source == domain.SourceOFF && f.SourceCheckedAt != nil {
		if t, err := time.Parse(time.RFC3339, *f.SourceCheckedAt); err == nil && time.Since(t) > staleAfterDays*24*time.Hour {
			v.Stale = true
		}
	}
	return v
}

// SearchHit is one loggable search result. A catalog hit has no id until it is selected.
type SearchHit struct {
	ID           *string  `json:"id" nullable:"true" doc:"Null for catalog hits: look the barcode up to log it."`
	Barcode      *string  `json:"barcode" nullable:"true"`
	Name         string   `json:"name"`
	Brand        string   `json:"brand"`
	Kcal         float64  `json:"kcal"`
	ServingSize  string   `json:"serving_size"`
	ServingGrams *float64 `json:"serving_grams" nullable:"true"`
	Source       string   `json:"source" enum:"off,bls,user,catalog"`
	Nutriscore   *string  `json:"nutriscore" nullable:"true"`
	ImagePath    *string  `json:"image_path" nullable:"true"`
	Favorite     bool     `json:"favorite"`
}

func searchHit(r food.Result) SearchHit {
	h := SearchHit{
		ID: r.ID, Barcode: r.Barcode, Name: r.Name, Brand: r.Brand, Kcal: r.Kcal100, ServingSize: r.ServingSize,
		ServingGrams: r.ServingGrams, Source: string(r.Source), Nutriscore: r.Nutriscore, ImagePath: imagePath(r.ImageKey),
		Favorite: r.Favorite,
	}
	if r.CatalogImage && r.Barcode != nil && h.ImagePath == nil {
		p := APIPrefix + "/images/catalog/" + *r.Barcode
		h.ImagePath = &p
	}
	return h
}

type barcodeIn struct {
	Code string `path:"code" maxLength:"32" doc:"6 to 14 digits; other characters are ignored."`
}

type foodOut struct{ Body FoodView }

type searchIn struct {
	Q string `query:"q" maxLength:"100"`
}

type searchOut struct {
	Body struct {
		Query   string      `json:"query"`
		Results []SearchHit `json:"results"`
	}
}

type recentOut struct {
	Body struct {
		Foods []FoodView `json:"foods"`
	}
}

// FoodBody is a manual food or a correction. kcal per 100 g is mandatory.
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

type foodPutIn struct {
	ID   string `path:"id" format:"uuid"`
	Body FoodBody
}

type foodIDIn struct {
	ID string `path:"id" format:"uuid"`
}

type favoriteOut struct {
	Body struct {
		FoodID   string `json:"food_id"`
		Favorite bool   `json:"favorite"`
	}
}

type imageIn struct {
	Key string `path:"key" pattern:"^[0-9a-f]{32}$"`
}

type catalogImageIn struct {
	Barcode string `path:"barcode" pattern:"^[0-9]{8,14}$"`
}

type aboutOut struct {
	Body struct {
		Version      string   `json:"version"`
		Attributions []string `json:"attributions"`
		Catalog      struct {
			DatasetVersion string `json:"dataset_version"`
			Rows           int64  `json:"rows"`
			ImportedAt     string `json:"imported_at"`
		} `json:"catalog"`
	}
}

func (d Deps) foodError(ctx context.Context, err error) error {
	var nl *food.NotLoggableError
	var ue *food.UpstreamError
	switch {
	case errors.As(err, &nl):
		p := Err(http.StatusUnprocessableEntity, "not_loggable", "This product has no usable nutrition data, so it cannot be logged.")
		p.RequestID = RequestID(ctx)
		p.Reason = nl.Reason
		hint := &ProductHint{Name: nl.Name}
		if k := food.ImageKeyFor(nl.ImageURL); k != "" {
			hint.ImagePath = imagePath(&k)
		}
		p.Product = hint
		yes := true
		p.CanAddManually = &yes
		return p
	case errors.Is(err, domain.ErrNotFound) && !isImageErr(err):
		p := Err(http.StatusNotFound, "not_found", "No product with that barcode was found.")
		p.RequestID = RequestID(ctx)
		yes := true
		p.CanAddManually = &yes
		return p
	case errors.As(err, &ue):
		secs := int(ue.RetryAfter.Seconds()) + 1
		if ue.RetryAfter <= 0 {
			secs = 30
		}
		p := Err(http.StatusServiceUnavailable, "upstream_unavailable", "The food database is not reachable right now. You can add the food manually.")
		p.RequestID = RequestID(ctx)
		p.RetryAfter = &secs
		yes := true
		p.CanAddManually = &yes
		h := http.Header{}
		h.Set("Retry-After", strconv.Itoa(secs))
		return huma.ErrorWithHeaders(p, h)
	}
	return d.toAPIError(ctx, err)
}

func isImageErr(err error) bool { return errors.Is(err, food.ErrBadImage) }

func (d Deps) registerFoods(api huma.API) {
	if d.Food == nil {
		return
	}
	repo := store.NewRepo(d.DB)

	huma.Register(api, huma.Operation{
		OperationID: "lookup-barcode", Method: http.MethodGet, Path: "/foods/barcode/{code}", Tags: []string{"foods"},
		Summary:     "Resolve a barcode to a loggable food",
		Description: "Your foods first, then the catalog seed, then Open Food Facts. A product without kcal returns 422 not_loggable.",
		Security:    sessionSecurity,
		Errors:      []int{http.StatusNotFound, http.StatusUnprocessableEntity, http.StatusTooManyRequests, http.StatusServiceUnavailable},
	}, func(ctx context.Context, in *barcodeIn) (*foodOut, error) {
		if ok, wait := d.Auth.Lookups.Allow(UserID(ctx)); !ok {
			h := http.Header{}
			h.Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			return nil, huma.ErrorWithHeaders(Err(http.StatusTooManyRequests, "rate_limited", "Too many barcode lookups. Try again shortly."), h)
		}
		f, err := d.Food.Barcode(ctx, UserID(ctx), in.Code)
		if err != nil {
			return nil, d.foodError(ctx, err)
		}
		return &foodOut{Body: d.foodView(f)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "search-foods", Method: http.MethodGet, Path: "/foods/search", Tags: []string{"foods"},
		Summary: "Search foods by name, brand or barcode", Security: sessionSecurity,
	}, func(ctx context.Context, in *searchIn) (*searchOut, error) {
		res, err := d.Food.Search(ctx, UserID(ctx), in.Q)
		if err != nil {
			return nil, d.foodError(ctx, err)
		}
		out := &searchOut{}
		out.Body.Query = in.Q
		out.Body.Results = make([]SearchHit, 0, len(res))
		for _, r := range res {
			out.Body.Results = append(out.Body.Results, searchHit(r))
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "recent-foods", Method: http.MethodGet, Path: "/foods/recent", Tags: []string{"foods"},
		Summary: "Distinct foods logged most recently", Security: sessionSecurity,
	}, func(ctx context.Context, _ *struct{}) (*recentOut, error) {
		foods, err := d.Food.Recent(ctx, UserID(ctx), 30)
		if err != nil {
			return nil, d.foodError(ctx, err)
		}
		out := &recentOut{}
		out.Body.Foods = make([]FoodView, 0, len(foods))
		for _, f := range foods {
			out.Body.Foods = append(out.Body.Foods, d.foodView(f))
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "put-food", Method: http.MethodPut, Path: "/foods/{id}", Tags: []string{"foods"},
		Summary:     "Create a custom food or correct an existing one",
		Description: "A correction updates the row in place and sets source=user. If a live food already owns the barcode, that row is corrected and returned; use its id.",
		Security:    sessionSecurity,
		Errors:      []int{http.StatusConflict, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, in *foodPutIn) (*foodOut, error) {
		b := in.Body
		f, err := d.Food.SaveCustom(ctx, UserID(ctx), in.ID, food.FoodInput{
			Barcode: b.Barcode, Name: b.Name, Brand: b.Brand, Quantity: b.Quantity, ServingSize: b.ServingSize, ServingGrams: b.ServingGrams,
			Per100: domain.Nutrients{
				Kcal: b.Kcal, Protein: b.Protein, Carbs: b.Carbs, Fat: b.Fat, Sugar: b.Sugar, SatFat: b.SatFat, Fiber: b.Fiber, Salt: b.Salt,
			},
			Nutriscore: b.Nutriscore,
		})
		if err != nil {
			return nil, d.foodError(ctx, err)
		}
		return &foodOut{Body: d.foodView(f)}, nil
	})

	favorite := func(id, op, summary, method string, on *bool) {
		huma.Register(api, huma.Operation{
			OperationID: op, Method: method, Path: "/foods/{id}/favorite", Tags: []string{"foods"}, Summary: summary,
			Security: sessionSecurity, Errors: []int{http.StatusNotFound},
		}, func(ctx context.Context, in *foodIDIn) (*favoriteOut, error) {
			out := &favoriteOut{}
			out.Body.FoodID = in.ID
			if on == nil {
				fav, err := d.Food.IsFavorite(ctx, UserID(ctx), in.ID)
				if err != nil {
					return nil, d.foodError(ctx, err)
				}
				out.Body.Favorite = fav
				return out, nil
			}
			if _, err := d.Food.SetFavorite(ctx, UserID(ctx), in.ID, *on); err != nil {
				return nil, d.foodError(ctx, err)
			}
			out.Body.Favorite = *on
			return out, nil
		})
	}
	yes, no := true, false
	favorite("", "get-favorite", "Is this food a favorite?", http.MethodGet, nil)
	favorite("", "set-favorite", "Mark a food as a favorite (idempotent)", http.MethodPut, &yes)
	favorite("", "clear-favorite", "Remove a favorite (idempotent)", http.MethodDelete, &no)

	imageResponses := map[string]*huma.Response{
		"200": {Description: "The product image", Content: map[string]*huma.MediaType{"image/*": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}},
	}
	serveImage := func(img food.Image) *huma.StreamResponse {
		return &huma.StreamResponse{Body: func(ctx huma.Context) {
			b, err := readFile(img.Path)
			if err != nil {
				ctx.SetStatus(http.StatusNotFound)
				return
			}
			ctx.SetHeader("Content-Type", img.ContentType)
			ctx.SetHeader("Cache-Control", "public, max-age=31536000, immutable")
			ctx.SetHeader("X-Content-Type-Options", "nosniff")
			_, _ = ctx.BodyWriter().Write(b)
		}}
	}
	huma.Register(api, huma.Operation{
		OperationID: "get-image", Method: http.MethodGet, Path: "/images/{key}", Tags: []string{"images"},
		Summary: "A cached product image by server-generated key", Security: sessionSecurity,
		Responses: imageResponses, Errors: []int{http.StatusNotFound, http.StatusBadGateway},
	}, func(ctx context.Context, in *imageIn) (*huma.StreamResponse, error) {
		img, err := d.Images.Get(ctx, in.Key)
		if err != nil {
			return nil, d.imageError(ctx, err)
		}
		return serveImage(img), nil
	})
	huma.Register(api, huma.Operation{
		OperationID: "get-catalog-image", Method: http.MethodGet, Path: "/images/catalog/{barcode}", Tags: []string{"images"},
		Summary: "The image of a catalog product by barcode", Security: sessionSecurity,
		Responses: imageResponses, Errors: []int{http.StatusNotFound, http.StatusBadGateway},
	}, func(ctx context.Context, in *catalogImageIn) (*huma.StreamResponse, error) {
		img, err := d.Images.ForCatalog(ctx, in.Barcode)
		if err != nil {
			return nil, d.imageError(ctx, err)
		}
		return serveImage(img), nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "about", Method: http.MethodGet, Path: "/about", Tags: []string{"meta"},
		Summary: "Version, data source attribution and catalog release", Security: sessionSecurity,
	}, func(ctx context.Context, _ *struct{}) (*aboutOut, error) {
		out := &aboutOut{}
		out.Body.Version = appVersion
		out.Body.Attributions = food.Attributions()
		if n, err := repo.CountCatalog(ctx); err == nil {
			out.Body.Catalog.Rows = n
		}
		out.Body.Catalog.DatasetVersion, _ = repo.CatalogMeta(ctx, "dataset_version")
		out.Body.Catalog.ImportedAt, _ = repo.CatalogMeta(ctx, "imported_at")
		return out, nil
	})
}

func (d Deps) imageError(ctx context.Context, err error) error {
	var ue *food.UpstreamError
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return Err(http.StatusNotFound, "not_found", "No such image.")
	case errors.Is(err, food.ErrBadImage), errors.As(err, &ue):
		return Err(http.StatusBadGateway, "image_unavailable", "The image could not be fetched.")
	}
	return d.toAPIError(ctx, err)
}
