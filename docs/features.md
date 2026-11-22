# What Plate does

A guide to the features, written for someone using the app. Each section says where the details live.

## Logging food

- **Scan a barcode** with the camera, or type the digits; when the camera cannot start, upload a photo of the code. The product opens with its nutrition and a portion to confirm; nothing is added until you say so ([food-and-search.md](food-and-search.md)).
- **Search by name** across your own foods, favourites, recents, the bundled German catalogue and Open Food Facts. A recipe matches by name too and is listed first.
- **Quick add** calories with no label, **add a food** by hand or from a photo of the nutrition table, or **copy yesterday** into an empty day.
- **Usual for this meal** tops the add-food sheet with the foods you log most for that meal, then recents. An empty meal offers "Repeat yesterday's breakfast". A food's last portion is remembered.
- Every entry keeps the nutrition it was logged with, so correcting a food later never rewrites your history ([data-model.md](data-model.md)).
- Missing nutrition is shown as missing, never as zero.

## Today

- The big number is the **calories eaten**, with "left of your goal" or "over your goal" on one line beside it, a meter, and protein, carbs, fat and fibre against your targets.
- **All nutrients**, or any meal heading, opens one table with tabs for the day and each meal. The day shows every nutrient against its goal; a meal shows each nutrient's share of the day.
- A one-line reminder appears for someone who tracks a medication or weight: a dose due or overdue, or no weight for a week. There are no push notifications.

## Recipes

- Build a recipe from ingredients found by search or by scanning, say how many portions it makes, and log a portion, a half, or any amount as one entry. No cooked weight is needed: calories do not change when food cooks, so a portion is the ingredient total over the portions made ([client.md](client.md)).
- The recipe shows where its calories come from, per portion and per 100 g, and marks a nutrient that only some ingredients report as a minimum.
- **Share a recipe** with the share icon on its row or in its title. It sends a copy as a file and as readable text. **Import** on the Recipes page adds one someone sent you as your own recipe. There are no invites and no links: accounts stay isolated.

## History

- A chart per day for calories, protein, carbs, fat, fibre, sugar, saturated fat or salt, each with its unit in the title, a goal line where there is a goal, and a 7-day average line. Days you did not log are gaps, not zeros.
- Dose days are marked under the chart. Top foods and a weekday pattern note come from your own logs, and the days list opens in place to show where a day's calories came from.
- The range and the nutrient are in the address, so a view can be linked and reloaded.

## Body and medication

- **Weight** with the change since you started, progress to an optional goal, and a trend chart. **Measurements** for waist, hips, chest, upper arm, thigh and neck are added with one button, and only the ones you use are listed.
- **Medication**: pick your pen from a list (Wegovy, Ozempic, Mounjaro, Zepbound, Trulicity, Bydureon, Saxenda, Victoza, Rybelsus) or name your own, then log doses with their strength, injection site (the next in rotation is suggested) and time. See the next dose due and the doses left. Switching medication keeps the earlier doses.
- **How you feel**: appetite and nausea, 0 to 5, in two taps a day.
- **Insights** from your own logs: average eating by days since a dose, intake before and since you started (and by medication once you have used more than one), and protein for your weight.
- Plate records and reports what you log. It never suggests or changes a dose and makes no claim about a medication ([client.md](client.md)).

## Goals and settings

- Calories, and optional protein, carbs, fat and fibre targets. Macros can be entered as grams or as a share of the calories; Plate shows how they split the calories and whether they add up to your goal.
- **Suggest my goals**: a calorie and macro starting point from sex, age, height, weight and activity (no BMI), accepted or ignored by the person.
- A weight goal and the day-start hour (so late meals count toward the day before).
- Light, dark or automatic theme, and scan sound and vibration.

## Your data

- Everything works offline and syncs when there is a connection, with a visible sync status and a way to retry or discard a change the server refused ([sync.md](sync.md)).
- It can be installed to the home screen. After a few logs Plate offers this once, so the log opens faster and stays available offline.
- **Export a backup** (entries, foods, recipes, health records and goals) and **import** it back; delete your account and all of its data ([accounts.md](accounts.md), [runbook.md](runbook.md)).
- Development builds also offer **sample data** (recipes, foods, a month of history, a fortnight of weight and doses) that can be removed again. It is not in the built app.
