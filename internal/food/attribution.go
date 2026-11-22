package food

// Attribution texts shown in the About screen and carried in every export.
const (
	OFFAttribution = "Food data from Open Food Facts (openfoodfacts.org), available under the Open Database License (ODbL 1.0). " +
		"Individual contents are under the Database Contents License. The product catalog in this app is a derivative database " +
		"of Open Food Facts and is shared under the same ODbL terms."
	BLSAttribution = "Generic food data from the Bundeslebensmittelschlüssel (BLS), Version 4.0, Max Rubner-Institut (2025): " +
		"Bundeslebensmittelschlüssel (BLS), Version 4.0 — Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0. " +
		"Licensed under CC BY 4.0."
	WAFCTAttribution = "West African food data from the FAO/INFOODS Food Composition Table for Western Africa (2019): " +
		"Vincent, A., Grande, F., Compaoré, E. et al. 2020. FAO/INFOODS Food Composition Table for Western Africa (2019). Rome, FAO. © FAO, 2020. " +
		"Used for non-commercial purposes with acknowledgement of FAO as the source; FAO does not endorse Plate."
	USDAAttribution = "A short list of generic foods from U.S. Department of Agriculture, Agricultural Research Service. " +
		"FoodData Central, 2019. fdc.nal.usda.gov (SR Legacy, public domain, CC0 1.0)."
)

// Attributions lists every required source credit.
func Attributions() []string {
	return []string{OFFAttribution, BLSAttribution, WAFCTAttribution, USDAAttribution}
}
