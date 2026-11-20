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

## Operating the catalog

```
# build (needs the OFF CSV dump, about 1.5 GB gzipped)
make catalog DUMP=/path/to/en.openfoodfacts.org.products.csv.gz VERSION=2026-11-12

# import: Docker imports the bundled seed when the catalog is empty.
# To replace an existing catalog: PLATE_CATALOG_REIMPORT=true, restart once, then remove it.
```

The importer opens the file read-only, rejects triggers, views and unexpected tables, validates every row and replaces the
catalog in one transaction. A failed import keeps the previous catalog.
