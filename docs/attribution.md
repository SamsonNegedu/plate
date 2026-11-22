# Data attribution and licenses

Plate shows these credits in the About screen and writes them into every export (`attribution`).

## Open Food Facts (ODbL 1.0)

Product data comes from [Open Food Facts](https://world.openfoodfacts.org), available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Individual contents are under the
[Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). Product images are licensed
[CC BY-SA](https://creativecommons.org/licenses/by-sa/3.0/) by their contributors.

What Plate does with it:

- **Live lookups.** The server fetches a product by barcode, normalizes it and caches the result. The browser never calls
  Open Food Facts; image requests go through the server's image proxy.
- **Catalog seed.** `make catalog` builds a derivative database from the Open Food Facts dump: German products with
  energy per 100 g, cleaned names, near-duplicates merged, ranked by scan count. Under the ODbL, a derivative database
  that is publicly used or distributed must be offered under the ODbL, and the credit must stay with it. The seed file's
  `catalog_meta.source` records this, and the About screen shows the dataset version.
- **Share-alike.** The seed is for the operator's own deployment. If you publish or give away the seed, publish it under the
  ODbL with the credit above. Plate does not redistribute the seed itself.

Not verified by the project: whether a small, self-hosted deployment counts as "public use" under the ODbL. The conservative
reading, which this project follows, is to keep the credit and the license notice with the data in the app and the export.

## Bundeslebensmittelschlüssel (BLS) 4.0 (CC BY 4.0)

Generic foods come from the Bundeslebensmittelschlüssel, version 4.0, released free of charge in December 2025.

> Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 — Deutsche Nährstoffdatenbank. Karlsruhe.
> DOI: 10.25826/Data20251217-134202-0. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Import: `PLATE_IMPORT_BLS_PATH=/data/BLS_4_0_Daten_2025_DE.xlsx`, restart once, then remove the variable. The importer reads
the official data file (7,140 foods, verified on the real file), keeps missing values as NULL, and never overwrites a food
you corrected. Plate changes nothing in the values except unit conversion (sodium to salt, kJ to kcal when kcal is absent).

## FAO/INFOODS Food Composition Table for Western Africa (WAFCT 2019)

About 1,000 West African foods (staples, soup ingredients, local dishes) come from the FAO/INFOODS table for Western Africa.

> Vincent, A., Grande, F., Compaoré, E., Amponsah Annor, G., Addy, P.A., Aburime, L.C., Ahmed, D., Bih Loh, A.M., Dahdouh Cabia, S., Deflache, N., Dembélé, F.M., Dieudonné, B., Edwige, O.B., Ene-Obong, H.N., Fanou Fogny, N., Ferreira, M., Omaghomi Jemide, J., Kouebou, P.C., Muller, C., Nájera Espinosa, S., Ouattara, F., Rittenschober, D., Schönfeldt, H., Stadlmayr, B., van Deventer, M., Razikou Yiagnigni, A. & Charrondière, U.R. 2020. FAO/INFOODS Food Composition Table for Western Africa (2019). Rome, FAO. © FAO, 2020.

Terms, as printed in the file: FAO "encourages the use, reproduction and dissemination of material in this information product", which "may be copied, downloaded and printed for private study, research and teaching purposes, or for use in non-commercial products or services, provided that appropriate acknowledgement of FAO as the source and copyright holder is given". Translation, adaptation, resale and other commercial use need FAO's permission (www.fao.org/contact-us/licence-request).

What Plate does with it, and the limits that follow:

- **Shipped, cleaned.** The repository holds the foods a person weighs (702 of the 1,028) as `internal/food/data/wafct_2019.csv`, built by `make wafct XLSX=WAFCT_2019.xlsx` and embedded in the binary; prepared dishes, beverages and packaged variants are left out. The server loads it into the shared `reference_foods` table on start (and again when the file changes). Plate tidies names and converts sodium to salt and nothing else; `internal/food/data/NOTICE.md` lists every change and travels with the file.
- **Non-commercial use only.** FAO allows use "in non-commercial products or services" and reserves adaptation, resale and commercial rights. Cleaning and reshaping is an adaptation. A deployment that charges for the app, or anyone who redistributes the file beyond personal, research or teaching use, needs FAO's permission first (www.fao.org/contact-us/licence-request). This is the operator's decision, not the project's.
- **Credit stays with the data.** The About screen and every export carry the citation above, and the NOTICE stays beside the CSV.

## USDA FoodData Central (public domain, CC0 1.0)

A short list of generic foods the FAO table lacks (turkey, semolina, cucumber, avocado, spices and similar, 42 in all) comes from USDA FoodData Central, SR Legacy.

> U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.

The data is public domain and free for any use, commercial included; USDA asks only that it is named as the source, which the About screen and every export do. The list is built by `make usda` and shipped as `internal/food/data/usda_sr_legacy.csv`.

## Operating the catalog

```
# build (needs the OFF CSV dump, about 1.5 GB gzipped)
make catalog DUMP=/path/to/en.openfoodfacts.org.products.csv.gz VERSION=2026-11-12

# import: Docker imports the bundled seed when the catalog is empty.
# To replace an existing catalog: PLATE_CATALOG_REIMPORT=true, restart once, then remove it.
```

The importer opens the file read-only, rejects triggers, views and unexpected tables, validates every row and replaces the
catalog in one transaction. A failed import keeps the previous catalog.
