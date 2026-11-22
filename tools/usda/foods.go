package main

// pick is one USDA food to ship. Description is the exact SR Legacy description; Name is what people see; Local adds
// search words for the same food. Only foods the FAO table (which comes first for West African foods) does not hold
// well are listed: no stand-ins, so no "ugu" on a Cucurbita leaf and no "stockfish" on salted cod.
type pick struct {
	Description string
	Name        string
	Local       string
	Category    string
}

var picks = []pick{
	// Meat, dairy and eggs
	{"Turkey, whole, meat only, raw", "Turkey, meat only, raw", "turkey meat", "Meat"},
	{"Beef, ground, 80% lean meat / 20% fat, raw", "Beef, minced, 80% lean, raw", "ground beef minced beef", "Meat"},
	{"Pork, fresh, loin, whole, separable lean and fat, raw", "Pork loin, raw", "pork", "Meat"},
	{"Milk, whole, 3.25% milkfat, with added vitamin D", "Milk, whole", "whole milk fresh milk", "Milk"},
	{"Yogurt, plain, whole milk", "Yogurt, plain, whole milk", "yoghurt", "Milk"},
	{"Cheese, cheddar, sharp, sliced", "Cheese, cheddar", "cheddar cheese", "Milk"},
	{"Butter, salted", "Butter, salted", "butter", "Fats and oils"},
	// Fish
	{"Fish, cod, Atlantic, dried and salted", "Cod, Atlantic, dried and salted", "dried salted cod saltfish bacalao", "Fish"},
	// Vegetables
	{"Cucumber, with peel, raw", "Cucumber, raw", "cucumber", "Vegetables"},
	{"Beans, snap, green, raw", "Green beans, raw", "string beans snap beans", "Vegetables"},
	{"Cabbage, raw", "Cabbage, raw", "cabbage", "Vegetables"},
	{"Lettuce, cos or romaine, raw", "Lettuce, romaine, raw", "lettuce salad", "Vegetables"},
	{"Peppers, sweet, green, raw", "Pepper, sweet, green, raw", "green bell pepper", "Vegetables"},
	{"Onions, spring or scallions (includes tops and bulb), raw", "Spring onion, raw", "scallion green onion", "Vegetables"},
	// Fruit
	{"Avocados, raw, California", "Avocado, raw", "pear avocado pear", "Fruit"},
	{"Watermelon, raw", "Watermelon, raw", "watermelon", "Fruit"},
	{"Pineapple, raw, traditional varieties", "Pineapple, raw", "pineapple", "Fruit"},
	{"Mangos, raw", "Mango, raw", "mango", "Fruit"},
	{"Papayas, raw", "Papaya, raw", "pawpaw papaya", "Fruit"},
	{"Lemons, raw, without peel", "Lemon, raw, without peel", "lemon", "Fruit"},
	{"Limes, raw", "Lime, raw", "lime", "Fruit"},
	{"Nuts, cashew nuts, raw", "Cashew nuts, raw", "cashew", "Nuts and seeds"},
	{"Seeds, watermelon seed kernels, dried", "Watermelon seed kernels, dried", "watermelon seeds", "Nuts and seeds"},
	// Grains, pulses and baking
	{"Wheat flour, white, all-purpose, enriched, bleached", "Wheat flour, white", "plain flour all purpose flour", "Cereals"},
	{"Semolina, enriched", "Semolina", "semo semovita", "Cereals"},
	{"Rice, brown, long-grain, raw (Includes foods for USDA's Food Distribution Program)", "Rice, brown, long-grain, raw", "brown rice", "Cereals"},
	{"Oats (Includes foods for USDA's Food Distribution Program)", "Oats, rolled, dry", "oatmeal porridge oats", "Cereals"},
	{"Lentils, raw", "Lentils, raw", "lentils", "Legumes"},
	{"Chickpeas (garbanzo beans, bengal gram), mature seeds, raw", "Chickpeas, dry", "garbanzo", "Legumes"},
	{"Beans, kidney, all types, mature seeds, raw", "Kidney beans, dry", "red beans", "Legumes"},
	{"Sugars, granulated", "Sugar, granulated", "white sugar", "Miscellaneous"},
	{"Salt, table", "Salt, table", "salt", "Miscellaneous"},
	// Spices
	{"Spices, pepper, black", "Black pepper, ground", "pepper", "Spices"},
	{"Spices, pepper, red or cayenne", "Cayenne pepper, ground", "ground chilli cayenne", "Spices"},
	{"Spices, paprika", "Paprika", "paprika", "Spices"},
	{"Spices, turmeric, ground", "Turmeric, ground", "turmeric", "Spices"},
	{"Spices, cumin seed", "Cumin seed", "cumin", "Spices"},
	{"Spices, coriander seed", "Coriander seed", "coriander", "Spices"},
	{"Spices, ginger, ground", "Ginger, ground", "dried ginger ginger powder", "Spices"},
	{"Spices, garlic powder", "Garlic powder", "garlic powder", "Spices"},
	{"Spices, onion powder", "Onion powder", "onion powder", "Spices"},
	{"Spices, bay leaf", "Bay leaf, dried", "bay leaves", "Spices"},
}
