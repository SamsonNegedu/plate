# Sources and terms of the shipped generic foods

Two files, both per 100 g, both in the shape `internal/food/reference_data.go` reads:

| File | Source | Foods | Terms |
|---|---|---|---|
| `wafct_2019.csv` | FAO/INFOODS Food Composition Table for Western Africa (2019) | 702 of the table's 1,028 | FAO: non-commercial use with credit (below) |
| `usda_sr_legacy.csv` | USDA FoodData Central, SR Legacy | 42 | Public domain (CC0 1.0), credit requested |

## `wafct_2019.csv`: FAO/INFOODS West African table

Cleaned and reshaped for Plate by `tools/wafct` (`make wafct XLSX=WAFCT_2019.xlsx`).

> Vincent, A., Grande, F., Compaoré, E., Amponsah Annor, G., Addy, P.A., Aburime, L.C., Ahmed, D., Bih Loh, A.M.,
> Dahdouh Cabia, S., Deflache, N., Dembélé, F.M., Dieudonné, B., Edwige, O.B., Ene-Obong, H.N., Fanou Fogny, N.,
> Ferreira, M., Omaghomi Jemide, J., Kouebou, P.C., Muller, C., Nájera Espinosa, S., Ouattara, F., Rittenschober, D.,
> Schönfeldt, H., Stadlmayr, B., van Deventer, M., Razikou Yiagnigni, A. & Charrondière, U.R. 2020. FAO/INFOODS Food
> Composition Table for Western Africa (2019). Rome, FAO. © FAO, 2020.

### Terms, as printed in the source file

FAO "encourages the use, reproduction and dissemination of material in this information product. Except where otherwise
indicated, material may be copied, downloaded and printed for private study, research and teaching purposes, or for use
in non-commercial products or services, provided that appropriate acknowledgement of FAO as the source and copyright
holder is given and that FAO's endorsement of users' views, products or services is not implied in any way. All requests
for translation and adaptation rights, and for resale and other commercial use rights should be addressed to
www.fao.org/contact-us/licence-request or to copyright@fao.org."

**Use this file only in a non-commercial product or service, and keep this notice with it.** Cleaning and reshaping is an
adaptation; FAO reserves adaptation rights, so anyone who charges for Plate or redistributes this file beyond personal,
research or teaching use must get FAO's permission first. FAO does not endorse Plate.

### What was kept and what was changed

- **Kept: foods a person weighs.** Raw, dried, boiled and flour forms of roots, tubers, plantain, legumes, grains, leaves,
  seeds, nuts, meat, fish, eggs, dairy, oils and spices. **Left out (326 rows):** prepared dishes and sauces (mostly
  Burkinabè), beverages, vitamin-fortified and canned variants (packaged goods have barcodes), and one-sample varieties
  from Ghana and Benin. The one-sample Nigerian yam cultivars stay.
- Names are tidied: footnote stars and sample counts are removed, "(as part of a recipe)" rows are dropped when a plain
  "boiled, drained" twin exists (76 rows), and a repeated name gets its code.
- Values are unchanged except units: sodium (mg) becomes salt (g, sodium × 2.5 / 1000), and kJ is used for energy only
  when kcal is missing. Square brackets (another analytical method) are dropped; "tr" (trace) is 0. A value that is not a
  number stays empty, never 0. The table has no sugar column, so sugar is empty.
- `estimated` is 1 where the source says the value was calculated from other foods or from a recipe.
- `local_names` is Plate's own: Nigerian names (Igbo, Yoruba, Hausa, Pidgin) and kitchen words for the same food, plus
  the French name from the source. They are in `tools/wafct/aliases.go`.

## `usda_sr_legacy.csv`: USDA FoodData Central

> U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.

USDA FoodData Central is in the public domain (CC0 1.0 Universal); USDA asks that it is named as the source. The list is
built by `tools/usda` (`make usda ZIP=FoodData_Central_sr_legacy_food_csv_2018-04.zip`) from exact SR Legacy
descriptions in `tools/usda/foods.go`. It holds only foods the FAO file lacks or holds poorly (turkey, semolina, cucumber,
avocado, spices and the like), with USDA's own values; sodium is converted to salt. The FAO file comes first for West
African foods, so no food is in both, and nothing is mapped to a different plant or fish.
