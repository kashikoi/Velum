/* Velum — optional starter recipes (Settings → "Add starter recipes"). Ingredient lines go through the
   same parser users get when pasting a list, so they double as a parser smoke test. */
(function (V) {
  "use strict";
  const Un = V.units;

  const STARTERS = [
    {
      name: "Beef Tacos", categories: ["dinner"], cuisine: "Mexican", prepMin: 10, cookMin: 15, servings: 4, difficulty: "easy",
      tags: ["weeknight", "family"], description: "Crispy-edged seasoned beef, warm tortillas and all the toppings.",
      ingredients: ["1 lb ground beef", "1 medium onion, diced", "2 cloves garlic, minced", "1 tbsp olive oil", "2 tsp chili powder", "1 tsp ground cumin",
        "8 small corn tortillas", "1 cup shredded cheddar", "1 cup shredded lettuce", "2 tomatoes, diced", "1/2 cup sour cream (optional)", "Salt and pepper to taste"],
      steps: ["Heat the oil in a large skillet over medium-high heat. Add the onion and cook until soft, about 5 minutes.",
        "Add the beef and garlic; cook, breaking it up, until browned. Drain excess fat.",
        "Stir in chili powder, cumin, a splash of water, salt and pepper. Simmer 3 minutes.",
        "Warm the tortillas in a dry pan. Fill with beef and top with cheese, lettuce, tomato and sour cream."],
    },
    {
      name: "Weeknight Chili", categories: ["dinner", "lunch"], cuisine: "American", prepMin: 15, cookMin: 45, servings: 6, difficulty: "easy",
      tags: ["make-ahead", "freezer"], description: "A thick, smoky pot of chili that tastes even better the next day.",
      ingredients: ["1.5 lb ground beef", "1 large onion, chopped", "2 tbsp olive oil", "4 cloves garlic, minced", "1 red bell pepper, diced",
        "2 tbsp chili powder", "1 tbsp ground cumin", "1 tsp smoked paprika", "1 (28 oz) can crushed tomatoes", "2 (15 oz) cans kidney beans, drained",
        "1 cup beef broth", "Salt to taste"],
      steps: ["Warm the oil in a heavy pot. Cook onion and pepper until soft, 6–8 minutes.",
        "Add beef and garlic; brown well.",
        "Stir in the spices for 1 minute, then add tomatoes, beans and broth.",
        "Simmer partly covered for 35–45 minutes, stirring now and then. Season and serve."],
    },
    {
      name: "Overnight Oats", categories: ["breakfast"], cuisine: "", prepMin: 5, cookMin: 0, servings: 2, difficulty: "easy",
      tags: ["make-ahead", "no-cook"], description: "Stir together at night, grab in the morning.",
      ingredients: ["1 cup rolled oats", "1 cup milk", "1/2 cup Greek yogurt", "1 tbsp maple syrup", "1 tbsp chia seeds", "1 cup blueberries", "Pinch of salt"],
      steps: ["Stir oats, milk, yogurt, maple syrup, chia and salt in a jar.", "Cover and refrigerate overnight.", "Top with blueberries before serving."],
    },
    {
      name: "Buttermilk Pancakes", categories: ["breakfast"], cuisine: "American", prepMin: 10, cookMin: 15, servings: 4, difficulty: "easy",
      tags: ["weekend"], description: "Tall, tender pancakes for slow mornings.",
      ingredients: ["2 cups all-purpose flour", "2 tbsp sugar", "2 tsp baking powder", "1/2 tsp baking soda", "1/2 tsp salt", "2 cups buttermilk",
        "2 large eggs", "3 tbsp butter, melted", "Maple syrup, for serving"],
      steps: ["Whisk the dry ingredients in a large bowl.", "Whisk buttermilk, eggs and melted butter; pour into the dry ingredients and stir just until combined.",
        "Cook ¼-cup scoops on a buttered griddle over medium heat until bubbles form, then flip.", "Serve warm with maple syrup."],
    },
    {
      name: "Greek Salad", categories: ["lunch", "dinner"], cuisine: "Greek", prepMin: 15, cookMin: 0, servings: 4, difficulty: "easy",
      tags: ["vegetarian", "no-cook"], description: "Crunchy, briny and bright.",
      ingredients: ["3 tomatoes, cut into wedges", "1 cucumber, sliced", "1/2 red onion, thinly sliced", "1 green bell pepper, sliced", "1/2 cup Kalamata olives",
        "6 oz feta cheese", "3 tbsp olive oil", "1 tbsp red wine vinegar", "1 tsp dried oregano", "Salt and pepper to taste"],
      steps: ["Combine tomatoes, cucumber, onion, pepper and olives in a bowl.", "Whisk oil, vinegar, oregano, salt and pepper; toss with the salad.", "Top with feta."],
    },
    {
      name: "Chicken Stir-Fry", categories: ["dinner"], cuisine: "Chinese", prepMin: 15, cookMin: 12, servings: 4, difficulty: "medium",
      tags: ["weeknight", "quick"], description: "Glossy, garlicky and faster than takeout.",
      ingredients: ["1.5 lb chicken breast, sliced thin", "2 tbsp soy sauce", "1 tbsp cornstarch", "2 tbsp vegetable oil", "3 cloves garlic, minced",
        "1 tbsp fresh ginger, grated", "1 head broccoli, cut into florets", "1 red bell pepper, sliced", "3 tbsp oyster sauce", "2 cups cooked rice", "2 green onions, sliced"],
      steps: ["Toss chicken with 1 tbsp soy sauce and the cornstarch.", "Sear chicken in hot oil until golden; set aside.",
        "Stir-fry broccoli and pepper 3 minutes; add garlic and ginger for 30 seconds.", "Return chicken with oyster sauce and remaining soy sauce. Toss, top with green onions and serve over rice."],
    },
    {
      name: "Turkey Avocado Sandwich", categories: ["lunch"], cuisine: "American", prepMin: 5, cookMin: 0, servings: 1, difficulty: "easy",
      tags: ["quick", "no-cook"], description: "",
      ingredients: ["2 slices sourdough bread", "4 oz sliced turkey", "1/2 avocado", "1 slice Swiss cheese", "2 leaves lettuce", "1 tsp Dijon mustard"],
      steps: ["Toast the bread if you like.", "Spread mustard, mash avocado on the other slice, then layer turkey, cheese and lettuce."],
    },
    {
      name: "Spaghetti Bolognese", categories: ["dinner"], cuisine: "Italian", prepMin: 15, cookMin: 60, servings: 6, difficulty: "medium",
      tags: ["family", "make-ahead"], description: "A slow, rich meat sauce over spaghetti.",
      ingredients: ["1 lb ground beef", "1 onion, finely chopped", "1 carrot, finely chopped", "1 celery stalk, finely chopped", "3 cloves garlic, minced",
        "2 tbsp olive oil", "2 tbsp tomato paste", "1 (28 oz) can crushed tomatoes", "1/2 cup whole milk", "1/2 cup dry red wine", "1 lb spaghetti",
        "1/2 cup grated Parmesan", "Salt and pepper to taste"],
      steps: ["Soften onion, carrot and celery in oil for 8 minutes.", "Add beef and garlic; brown. Stir in tomato paste for 1 minute.",
        "Add wine and reduce, then milk, then tomatoes. Simmer gently 45 minutes.", "Cook spaghetti; toss with sauce and Parmesan."],
    },
    {
      name: "Chocolate Chip Cookies", categories: ["dessert", "snack"], cuisine: "American", prepMin: 15, cookMin: 12, servings: 24, difficulty: "easy",
      tags: ["baking"], description: "Chewy middles, crisp edges.",
      ingredients: ["2 1/4 cups all-purpose flour", "1 tsp baking soda", "1 tsp salt", "1 cup butter, softened", "3/4 cup sugar", "3/4 cup brown sugar",
        "2 large eggs", "2 tsp vanilla extract", "2 cups chocolate chips"],
      steps: ["Heat oven to 375°F.", "Cream butter and sugars; beat in eggs and vanilla.", "Mix in flour, baking soda and salt, then chips.",
        "Scoop onto sheets and bake 9–12 minutes."],
    },
  ];

  function starterRecipes() {
    return STARTERS.map((r) => Object.assign({}, r, {
      ingredients: r.ingredients.map((line, i) => Object.assign(Un.parseIngredientLine(line), { sortOrder: i })),
      steps: r.steps.map((text) => ({ text })),
    }));
  }

  V.demo = { starterRecipes };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
