package food

// Attribution texts shown in the About screen and carried in every export.
const (
	OFFAttribution = "Food data from Open Food Facts (openfoodfacts.org), available under the Open Database License (ODbL 1.0). " +
		"Individual contents are under the Database Contents License. The product catalog in this app is a derivative database " +
		"of Open Food Facts and is shared under the same ODbL terms."
	BLSAttribution = "Generic food data from the Bundeslebensmittelschlüssel (BLS), Version 4.0, Max Rubner-Institut (2025): " +
		"Bundeslebensmittelschlüssel (BLS), Version 4.0 — Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0. " +
		"Licensed under CC BY 4.0."
)

// Attributions lists every required source credit.
func Attributions() []string { return []string{OFFAttribution, BLSAttribution} }
