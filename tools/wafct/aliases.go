package main

// aliases adds the names people actually search for, by WAFCT food code. They go into the shipped CSV (local_names). They are Plate's own curation, not part
// of the FAO table: Nigerian local names (Igbo, Yoruba, Hausa, Pidgin) and common kitchen words. Only names that
// identify the same food are listed; a food the table does not hold (ugu, stockfish) is left out rather than mapped to
// a different plant or fish.
var aliases = map[string]string{
	// Soup thickeners, seeds and nuts
	"06_008": "ogbono apon bush mango seed irvingia",
	"06_013": "egusi egusi melon agusi",
	"06_035": "egusi egusi melon agusi",
	"06_036": "egusi egusi melon agusi",
	"06_037": "egusi egusi melon agusi",
	"06_031": "ukwa african breadfruit breadnut",
	"06_033": "orogbo aki ilu bitter kola",
	"06_019": "kola nut obi oji goro",
	"06_039": "beniseed benniseed sesame ridi",
	"03_010": "azama african yam bean",
	"13_020": "ehuru ariwo calabash nutmeg african nutmeg monodora",
	"13_026": "uda negro pepper ethiopian pepper xylopia",
	// Fermented seasoning and legumes
	"03_042": "iru dawadawa soumbala locust bean fermented",
	"03_009": "locust bean dawadawa seeds",
	"03_004": "beans black eyed beans cowpea ewa wake",
	"03_005": "beans black eyed beans cowpea ewa wake",
	"03_006": "beans black eyed beans cowpea ewa wake",
	"03_027": "beans brown beans cowpea ewa wake",
	"03_045": "beans peeled beans cowpea ewa wake",
	"03_001": "bambara nut okpa gurjiya",
	// Leaves and vegetables used in soups
	"04_022": "bitter leaf bitterleaf onugbu ewuro shiwaka",
	"04_078": "waterleaf gbure",
	"04_038": "ewedu jute leaves molokhia",
	"04_075": "ewedu jute leaves molokhia dried",
	"04_017": "okra okro ila kubewa",
	"04_077": "dried okra okro kubewa",
	"04_080": "afang okazi ukazi gnetum",
	"04_023": "efo tete tete inine amaranth callaloo green",
	"04_001": "baobab leaves kuka",
	"04_002": "baobab leaves kuka dried",
	"04_016": "yakuwa roselle sorrel leaves zobo leaves",
	"04_084": "tafasa sicklepod",
	"04_071": "tafasa sicklepod dried",
	"04_011": "moringa zogale",
	"04_047": "tatashe red bell pepper",
	"04_046": "chilli pepper ata rodo scotch bonnet",
	"13_006": "dried chilli pepper cayenne",
	// Roots, plantain and cassava products
	"02_005": "cocoyam ede koko",
	"02_043": "cocoyam ede koko",
	"02_042": "ripe plantain ogede agbagba dodo",
	"02_044": "ripe plantain ogede agbagba dodo",
	"02_045": "unripe plantain ogede",
	"02_046": "unripe plantain ogede",
	"02_047": "unripe plantain ogede",
	"02_038": "cassava flour lafun elubo",
	"02_039": "garri gari",
	"02_040": "fufu flour dry fufu",
	"02_041": "fufu wet fufu akpu",
	"02_019": "yam isu",
	"02_034": "yam isu",
	"02_036": "yam flour elubo isu",
	"01_100": "ogi akamu pap koko fermented maize porridge",
	// Protein
	"07_021": "shaki tripe",
	"07_083": "snail igbin ejuna giant african snail",
	"07_084": "snail igbin ejuna giant african snail cooked",
	"09_057": "crayfish dried crayfish ground crayfish",
	"13_008": "stock cube bouillon cube seasoning cube maggi",
	// Fats and fruit
	"11_004": "red palm oil epo pupa",
	"05_053": "agbalumo udara african star apple cherry",
}
