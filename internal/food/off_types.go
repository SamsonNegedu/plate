// Package food owns every external food source: the Open Food Facts client, normalization, the catalog seed,
// BLS import, the image proxy and barcode lookup.
package food

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
)

// flexNum reads a JSON number or a numeric string. Anything else becomes nil, never zero.
type flexNum struct{ v *float64 }

func (f *flexNum) UnmarshalJSON(b []byte) error {
	f.v = nil
	b = bytes.TrimSpace(b)
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return nil //nolint:nilerr // a malformed value is treated as absent, not as an error
		}
		v, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(s), ",", "."), 64)
		if err != nil {
			return nil //nolint:nilerr // a malformed value is treated as absent, not as an error
		}
		f.v = &v
		return nil
	}
	var v float64
	if err := json.Unmarshal(b, &v); err != nil {
		return nil //nolint:nilerr // a malformed value is treated as absent, not as an error
	}
	f.v = &v
	return nil
}

// textList reads a JSON string or an array of strings. The product API sends brands as a string and the
// search API sends an array.
type textList []string

func (t *textList) UnmarshalJSON(b []byte) error {
	*t = nil
	b = bytes.TrimSpace(b)
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return nil //nolint:nilerr // malformed text is treated as absent
		}
		*t = textList{s}
		return nil
	}
	var list []string
	if err := json.Unmarshal(b, &list); err != nil {
		return nil //nolint:nilerr // malformed text is treated as absent
	}
	*t = list
	return nil
}

// OFFProduct is the subset of an Open Food Facts product that Plate reads.
type OFFProduct struct {
	Code            string                     `json:"code"`
	ProductName     string                     `json:"product_name"`
	ProductNameDE   string                     `json:"product_name_de"`
	GenericName     string                     `json:"generic_name"`
	Brands          textList                   `json:"brands"`
	Quantity        string                     `json:"quantity"`
	ServingSize     string                     `json:"serving_size"`
	ServingQuantity flexNum                    `json:"serving_quantity"`
	Nutriments      map[string]json.RawMessage `json:"nutriments"`
	NutriscoreGrade string                     `json:"nutriscore_grade"`
	ImageFrontURL   string                     `json:"image_front_url"`
	ImageURL        string                     `json:"image_url"`
	IngredientsText string                     `json:"ingredients_text"`
	Allergens       string                     `json:"allergens"`
	LastModifiedT   flexNum                    `json:"last_modified_t"`
	CountriesTags   []string                   `json:"countries_tags"`
}

// nutriment returns one nutriments value, or nil when it is absent or not numeric.
func (p OFFProduct) nutriment(key string) *float64 {
	raw, ok := p.Nutriments[key]
	if !ok {
		return nil
	}
	var f flexNum
	_ = f.UnmarshalJSON(raw)
	return f.v
}

func (p OFFProduct) nutrimentText(key string) string {
	raw, ok := p.Nutriments[key]
	if !ok {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return s
}

// rawJSON aliases json.RawMessage so tests can build nutriments maps tersely.
type rawJSON = json.RawMessage
