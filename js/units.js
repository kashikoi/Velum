/* Velum — units, quantities, ingredient-line parsing, name normalization and grocery-category guessing.
   Pure functions, no DOM. Volume and weight are only ever converted within their own dimension;
   crossing volume -> weight needs an ingredient-specific density (catalog `gramsPerCup`). */
(function (V) {
  "use strict";

  // ---------- Units ----------
  // dim: volume (base ml) | mass (base g) | count (never converted between different count units)
  const UNITS = {
    tsp:    { dim: "volume", f: 4.92892, sys: "us", one: "tsp", many: "tsp", label: "teaspoon" },
    tbsp:   { dim: "volume", f: 14.7868, sys: "us", one: "tbsp", many: "tbsp", label: "tablespoon" },
    floz:   { dim: "volume", f: 29.5735, sys: "us", one: "fl oz", many: "fl oz", label: "fluid ounce" },
    cup:    { dim: "volume", f: 236.588, sys: "us", one: "cup", many: "cups", label: "cup" },
    pint:   { dim: "volume", f: 473.176, sys: "us", one: "pint", many: "pints", label: "pint" },
    quart:  { dim: "volume", f: 946.353, sys: "us", one: "quart", many: "quarts", label: "quart" },
    gallon: { dim: "volume", f: 3785.41, sys: "us", one: "gallon", many: "gallons", label: "gallon" },
    ml:     { dim: "volume", f: 1, sys: "metric", one: "ml", many: "ml", label: "milliliter" },
    l:      { dim: "volume", f: 1000, sys: "metric", one: "l", many: "l", label: "liter" },
    mg:     { dim: "mass", f: 0.001, sys: "metric", one: "mg", many: "mg", label: "milligram" },
    g:      { dim: "mass", f: 1, sys: "metric", one: "g", many: "g", label: "gram" },
    kg:     { dim: "mass", f: 1000, sys: "metric", one: "kg", many: "kg", label: "kilogram" },
    oz:     { dim: "mass", f: 28.3495, sys: "us", one: "oz", many: "oz", label: "ounce" },
    lb:     { dim: "mass", f: 453.592, sys: "us", one: "lb", many: "lb", label: "pound" },
  };
  // Count-style units: kept as-is and only summed with the same unit.
  const COUNT_UNITS = {
    "":       { one: "", many: "" },
    clove:    { one: "clove", many: "cloves" },
    can:      { one: "can", many: "cans" },
    jar:      { one: "jar", many: "jars" },
    package:  { one: "package", many: "packages" },
    bag:      { one: "bag", many: "bags" },
    box:      { one: "box", many: "boxes" },
    bottle:   { one: "bottle", many: "bottles" },
    bunch:    { one: "bunch", many: "bunches" },
    head:     { one: "head", many: "heads" },
    slice:    { one: "slice", many: "slices" },
    stick:    { one: "stick", many: "sticks" },
    sprig:    { one: "sprig", many: "sprigs" },
    stalk:    { one: "stalk", many: "stalks" },
    piece:    { one: "piece", many: "pieces" },
    fillet:   { one: "fillet", many: "fillets" },
    sheet:    { one: "sheet", many: "sheets" },
    leaf:     { one: "leaf", many: "leaves" },
    ear:      { one: "ear", many: "ears" },
    loaf:     { one: "loaf", many: "loaves" },
    dozen:    { one: "dozen", many: "dozen" },
    handful:  { one: "handful", many: "handfuls" },
    pinch:    { one: "pinch", many: "pinches" },
    dash:     { one: "dash", many: "dashes" },
  };
  const ALIASES = {
    teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", tsps: "tsp", tspn: "tsp",
    tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp", tbls: "tbsp", tblsp: "tbsp",
    cup: "cup", cups: "cup", c: "cup",
    "fluid ounce": "floz", "fluid ounces": "floz", "fl oz": "floz", "fl. oz": "floz", "fl.oz": "floz", floz: "floz",
    pint: "pint", pints: "pint", pt: "pint", pts: "pint",
    quart: "quart", quarts: "quart", qt: "quart", qts: "quart",
    gallon: "gallon", gallons: "gallon", gal: "gallon", gals: "gallon",
    milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml", ml: "ml", mls: "ml",
    liter: "l", liters: "l", litre: "l", litres: "l", l: "l",
    milligram: "mg", milligrams: "mg", mg: "mg",
    gram: "g", grams: "g", g: "g", gr: "g", grs: "g",
    kilogram: "kg", kilograms: "kg", kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg",
    ounce: "oz", ounces: "oz", oz: "oz",
    pound: "lb", pounds: "lb", lb: "lb", lbs: "lb",
    each: "", ea: "", whole: "", pc: "piece", pcs: "piece",
  };
  Object.keys(COUNT_UNITS).forEach((k) => {
    if (!k) return;
    ALIASES[k] = k;
    ALIASES[COUNT_UNITS[k].many] = k;
  });
  ALIASES.cloves = "clove"; ALIASES.packages = "package"; ALIASES.pkg = "package"; ALIASES.pkgs = "package";
  ALIASES.packet = "package"; ALIASES.packets = "package"; ALIASES.pieces = "piece"; ALIASES.loaves = "loaf";

  const UNIT_CHOICES = ["", "tsp", "tbsp", "cup", "floz", "pint", "quart", "gallon", "ml", "l", "g", "kg", "oz", "lb",
    "clove", "can", "jar", "package", "bag", "bottle", "bunch", "head", "slice", "stick", "sprig", "stalk", "piece", "fillet", "leaf", "ear", "loaf", "dozen", "handful", "pinch", "dash"];

  function unitInfo(key) {
    if (UNITS[key]) return Object.assign({ key }, UNITS[key]);
    if (Object.prototype.hasOwnProperty.call(COUNT_UNITS, key)) return Object.assign({ key, dim: "count", f: 1, sys: "" }, COUNT_UNITS[key]);
    return { key, dim: "count", f: 1, sys: "", one: key, many: key };
  }
  // Maps free text ("Tbsp", "cups", "T") to a unit key; returns null if it isn't a known unit.
  function canonicalUnit(text) {
    if (text == null) return "";
    const raw = String(text).trim();
    if (!raw) return "";
    if (raw === "T" || raw === "Tb" || raw === "Tbs" || raw === "TB") return "tbsp";
    if (raw === "t") return "tsp";
    const t = raw.toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
    if (Object.prototype.hasOwnProperty.call(ALIASES, t)) return ALIASES[t];
    if (Object.prototype.hasOwnProperty.call(UNITS, t) || Object.prototype.hasOwnProperty.call(COUNT_UNITS, t)) return t;
    return null;
  }
  // Normalizes a stored unit: known units map to their key; unknown short words are kept verbatim (lowercase).
  function normalizeUnit(text) {
    const c = canonicalUnit(text);
    if (c !== null) return c;
    return String(text || "").trim().toLowerCase().slice(0, 20);
  }
  function unitLabel(key, qty) {
    const u = unitInfo(key);
    return qty != null && qty <= 1 + 1e-9 ? u.one : u.many;
  }
  function toBase(qty, unit) { return qty * unitInfo(unit).f; }
  function dimOf(unit) { return unitInfo(unit).dim; }

  // ---------- Quantities ----------
  const VULGAR = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6 };
  const VULGAR_RE = "[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]";
  // One number: "1", "1.5", "1,5", "1/2", "1 1/2", "1½", "½"
  const NUM_RE = "(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+\\s*" + VULGAR_RE + "|" + VULGAR_RE + "|\\d+(?:[.,]\\d+)?)";
  const QTY_RE = new RegExp("^(" + NUM_RE + ")(?:\\s*(?:-|–|—|to|or)\\s*(" + NUM_RE + "))?");

  function parseNumber(s) {
    s = String(s).trim();
    let m;
    if ((m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s))) return +m[3] ? +m[1] + +m[2] / +m[3] : null;
    if ((m = /^(\d+)\s*\/\s*(\d+)$/.exec(s))) return +m[2] ? +m[1] / +m[2] : null;
    if ((m = new RegExp("^(\\d+)\\s*(" + VULGAR_RE + ")$").exec(s))) return +m[1] + VULGAR[m[2]];
    if (VULGAR[s] !== undefined) return VULGAR[s];
    if (/^\d+(?:[.,]\d+)?$/.test(s)) return parseFloat(s.replace(",", "."));
    return null;
  }
  // Parses a quantity field. Ranges ("2-3") resolve to the upper bound so shopping never comes up short.
  function parseQuantity(text) {
    if (text == null) return null;
    if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? text : null;
    const s = String(text).trim();
    if (!s) return null;
    const m = QTY_RE.exec(s);
    if (!m || m[0].length !== s.length) return null;
    const a = parseNumber(m[1]);
    const b = m[2] ? parseNumber(m[2]) : null;
    const v = b != null ? Math.max(a, b) : a;
    return v != null && Number.isFinite(v) && v >= 0 ? v : null;
  }

  const FRACTIONS = [[0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"], [1, ""]];
  // Kitchen-friendly display: fractions for US volume and counts, tidy decimals for metric and weights.
  function formatQty(qty, unit) {
    if (qty == null || !Number.isFinite(qty)) return "";
    const u = unitInfo(unit || "");
    const useFractions = u.sys !== "metric" && unit !== "oz" && unit !== "lb";
    if (useFractions) {
      const whole = Math.floor(qty + 1e-9);
      const frac = qty - whole;
      let best = null;
      FRACTIONS.forEach(([v, glyph]) => { if (Math.abs(frac - v) < 0.035 && (!best || Math.abs(frac - v) < Math.abs(frac - best[0]))) best = [v, glyph]; });
      if (best) {
        const w = best[0] === 1 ? whole + 1 : whole;
        if (!best[1]) return String(w);
        return (w ? w : "") + best[1];
      }
    }
    if (u.sys === "metric" && (unit === "g" || unit === "ml" || unit === "mg") && qty >= 10) return String(Math.round(qty));
    return String(Math.round(qty * 100) / 100);
  }
  function formatAmount(qty, unit) {
    if (qty == null) return "";
    const q = formatQty(qty, unit);
    const lbl = unitLabel(unit || "", qty);
    return lbl ? q + " " + lbl : q;
  }

  // Picks a readable unit for a summed base amount (e.g. 7 tsp -> 2⅓ tbsp; 40 oz -> 2.5 lb).
  function bestUnit(dim, base, system) {
    if (dim === "volume") {
      if (system === "metric") return base >= 1000 ? "l" : "ml";
      if (base >= UNITS.cup.f / 4 - 0.5) return "cup";
      if (base >= UNITS.tbsp.f - 0.05) return "tbsp";
      return "tsp";
    }
    if (dim === "mass") {
      if (system === "metric") return base >= 1000 ? "kg" : "g";
      return base >= UNITS.lb.f - 0.5 ? "lb" : "oz";
    }
    return "";
  }

  // ---------- Ingredient names ----------
  const DROP_WORDS = new Set(["fresh", "freshly", "large", "medium", "small", "extra-large", "xl", "jumbo", "organic", "ripe",
    "chopped", "minced", "sliced", "peeled", "finely", "roughly", "coarsely", "thinly", "about", "approx", "approximately", "good-quality", "good", "quality", "best"]);
  const NO_SINGULAR = new Set(["molasses", "hummus", "asparagus", "couscous", "swiss", "citrus", "octopus", "grits", "greens", "brussels",
    "lettuce", "bass", "series", "species", "chips", "oats", "jus", "nachos", "glass", "watercress", "cress", "schnapps", "lentils", "peas", "sprinkles"]);
  const IRREGULAR = { leaves: "leaf", halves: "half", loaves: "loaf", cookies: "cookie", brownies: "brownie", pies: "pie", smoothies: "smoothie",
    veggies: "veggie", ties: "tie", knives: "knife", calves: "calf", lentils: "lentil", peas: "pea", oats: "oat", chips: "chip" };
  const SYNONYMS = {
    scallion: "green onion", "spring onion": "green onion",
    "garbanzo bean": "chickpea", "confectioners sugar": "powdered sugar", "confectioner's sugar": "powdered sugar", "icing sugar": "powdered sugar",
    "all purpose flour": "all-purpose flour", "ap flour": "all-purpose flour", "plain flour": "all-purpose flour",
    "extra virgin olive oil": "olive oil", "extra-virgin olive oil": "olive oil", evoo: "olive oil",
    "kosher salt": "salt", "sea salt": "salt", "table salt": "salt", "ground black pepper": "black pepper", "cracked black pepper": "black pepper",
    "garlic clove": "garlic", "bell pepper": "bell pepper", "coriander leaf": "cilantro", "minced meat": "ground beef", "beef mince": "ground beef",
    "egg": "egg", "eggs": "egg",
  };
  function singularize(word) {
    const w = word.toLowerCase();
    if (NO_SINGULAR.has(w)) return IRREGULAR[w] || w;
    if (IRREGULAR[w]) return IRREGULAR[w];
    if (w.length <= 3) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + "y";
    if (/oes$/.test(w)) return w.slice(0, -2);
    if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (/ves$/.test(w)) return w.slice(0, -1);
    if (/(ss|us|is)$/.test(w)) return w;
    if (/s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  // Strips a count unit embedded in the name ("cloves of garlic", "garlic cloves" -> garlic + clove).
  function splitUnitFromName(name, unit) {
    if (unit) return { name, unit };
    const s = String(name || "").trim();
    let m = /^(\w+)\s+of\s+(.+)$/i.exec(s);
    if (m) {
      const u = canonicalUnit(m[1]);
      if (u && dimOf(u) === "count" && u !== "") return { name: m[2], unit: u };
    }
    m = /^(.+?)\s+(cloves?|stalks?|sprigs?|heads?|bunch(?:es)?|leaves|leaf|ears?|fillets?)$/i.exec(s);
    if (m) {
      const u = canonicalUnit(m[2]);
      if (u) return { name: m[1], unit: u };
    }
    return { name: s, unit: "" };
  }
  // Canonical comparison key for an ingredient name. "Fresh garlic", "garlic cloves", "Cloves of garlic" -> "garlic";
  // meaningful qualifiers (dried, ground, whole, skim, smoked, …) are kept so different products stay apart.
  function normalizeName(name) {
    let s = String(name || "").toLowerCase();
    s = s.replace(/\([^)]*\)/g, " ").split(",")[0];
    s = s.replace(/[’']/g, "'").replace(/[^a-z0-9'&\- ]+/g, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/^(\w+)\s+of\s+/, (all, w) => (canonicalUnit(w) !== null && dimOf(canonicalUnit(w)) === "count" ? "" : all));
    s = s.replace(/\s+(cloves?|stalks?|sprigs?)$/, "");
    s = s.replace(/\ball purpose\b/, "all-purpose").replace(/\bextra large\b/, "extra-large");
    let words = s.split(" ").filter((w) => w && !DROP_WORDS.has(w));
    if (!words.length) words = s.split(" ").filter(Boolean);
    if (!words.length) return "";
    words[words.length - 1] = singularize(words[words.length - 1]);
    let out = words.join(" ");
    if (SYNONYMS[out]) out = SYNONYMS[out];
    return out;
  }
  function displayName(normalized) {
    const s = String(normalized || "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  // ---------- Ingredient line parsing ("2 cups all-purpose flour, sifted") ----------
  function parseIngredientLine(line) {
    let s = String(line || "").replace(/\s+/g, " ").trim();
    s = s.replace(/^[-•*·▢☐□]\s*/, "");
    if (!s) return null;
    const out = { qty: null, unit: "", name: "", prep: "", group: "", optional: false };
    const jz = new RegExp("^(juice|zest)\\s+(?:and\\s+zest\\s+)?of\\s+(" + NUM_RE + ")?\\s*(.+)$", "i").exec(s);
    if (jz) {
      out.qty = jz[2] ? parseQuantity(jz[2]) : 1;
      out.name = jz[3].trim();
      out.prep = jz[1].toLowerCase() === "juice" ? "juiced" : "zested";
      return out;
    }
    if (/\(optional\)|,\s*optional\s*$|^optional:?\s+/i.test(s)) {
      out.optional = true;
      s = s.replace(/\s*\(optional\)\s*/i, " ").replace(/,\s*optional\s*$/i, "").replace(/^optional:?\s+/i, "").trim();
    }
    const qm = QTY_RE.exec(s);
    if (qm) {
      out.qty = parseQuantity(qm[0]);
      s = s.slice(qm[0].length).trim();
    }
    // Package size like "1 (14 oz) can tomatoes" -> keep the size as prep.
    let size = "";
    const pm = /^\(([^)]*)\)\s*/.exec(s);
    if (pm) { size = pm[1]; s = s.slice(pm[0].length); }
    const two = /^([A-Za-z.]+\s+[A-Za-z.]+)\s+/.exec(s);
    const one = /^([A-Za-z.]+)\.?(?:\s+|$)/.exec(s);
    if (two && canonicalUnit(two[1]) !== null && canonicalUnit(two[1]) !== "" && /\s/.test(two[1]) && UNITS[canonicalUnit(two[1])]) {
      out.unit = canonicalUnit(two[1]);
      s = s.slice(two[0].length);
    } else if (one && canonicalUnit(one[1]) !== null && canonicalUnit(one[1]) !== "" && (out.qty != null || UNITS[canonicalUnit(one[1])]) && s.length > one[0].length) {
      out.unit = canonicalUnit(one[1]);
      s = s.slice(one[0].length);
    }
    s = s.replace(/^of\s+/i, "");
    if (/\bto taste\b/i.test(s)) {
      s = s.replace(/,?\s*\bto taste\b/i, "").trim();
      out.prep = "to taste";
    }
    const comma = s.indexOf(",");
    let name = comma >= 0 ? s.slice(0, comma) : s;
    let prep = comma >= 0 ? s.slice(comma + 1).trim() : "";
    const paren = /\s*\(([^)]*)\)\s*/.exec(name);
    if (paren) { prep = [paren[1], prep].filter(Boolean).join(", "); name = name.replace(paren[0], " "); }
    const split = splitUnitFromName(name.trim(), out.unit);
    out.name = split.name.trim().slice(0, 160);
    out.unit = split.unit;
    out.prep = [size, prep, out.prep].filter(Boolean).join(", ").slice(0, 160);
    if (!out.name) return null;
    return out;
  }

  // ---------- Grocery categories ----------
  const CATEGORY_RULES = [
    ["household", ["paper towel", "aluminum foil", "foil", "plastic wrap", "parchment", "dish soap", "detergent", "trash bag", "napkin", "sponge", "toilet paper", "zip bag", "ziploc"]],
    ["frozen", ["frozen", "ice cream", "sorbet"]],
    ["pantry", ["broth", "stock", "bouillon", "sauce", "paste", "canned", "peanut butter", "almond butter", "coconut milk", "cream of",
      "black bean", "kidney bean", "pinto bean", "cannellini", "chickpea", "lentil", "refried", "evaporated milk", "condensed milk", "powdered milk"]],
    ["meat", ["beef", "chicken", "pork", "turkey", "lamb", "bacon", "sausage", "ham", "steak", "salmon", "shrimp", "prawn", "tuna", "fish",
      "cod", "tilapia", "halibut", "trout", "prosciutto", "chorizo", "pancetta", "veal", "crab", "lobster", "scallop", "mussel", "clam",
      "anchovy", "venison", "duck", "brisket", "rib", "pepperoni", "salami", "meatball", "mince", "thigh", "drumstick", "tenderloin"]],
    ["dairy", ["milk", "butter", "cheese", "cream", "yogurt", "yoghurt", "egg", "buttermilk", "parmesan", "parmigiano", "mozzarella", "cheddar",
      "feta", "ricotta", "half-and-half", "half and half", "ghee", "mascarpone", "brie", "gouda", "gruyere", "monterey jack", "queso", "kefir", "creme fraiche"]],
    ["produce", ["bell pepper", "jalapeno", "jalapeño", "poblano", "serrano", "habanero", "chili pepper", "chile pepper", "red pepper", "green pepper", "yellow pepper", "sweet pepper"]],
    ["spices", ["salt", "pepper", "peppercorn", "paprika", "cumin", "cinnamon", "nutmeg", "oregano", "chili powder", "chilli powder", "curry powder",
      "garlic powder", "onion powder", "turmeric", "cardamom", "clove", "coriander", "cayenne", "bay leaf", "allspice", "seasoning", "spice",
      "dried", "ground", "red pepper flake", "pepper flake", "za'atar", "sumac", "saffron", "star anise", "fennel seed", "mustard seed", "garam masala", "herbes", "msg"]],
    ["bakery", ["bread", "bun", "roll", "bagel", "tortilla", "pita", "baguette", "croissant", "naan", "english muffin", "ciabatta", "brioche", "sourdough", "flatbread", "muffin"]],
    ["produce", ["onion", "garlic", "tomato", "potato", "carrot", "celery", "lettuce", "spinach", "kale", "cabbage", "broccoli", "cauliflower",
      "zucchini", "squash", "cucumber", "avocado", "lemon", "lime", "orange", "apple", "banana", "berry", "grape", "mango", "pineapple",
      "peach", "pear", "cherry", "plum", "melon", "kiwi", "basil", "cilantro", "parsley", "mint", "dill", "rosemary", "thyme", "sage", "chive",
      "ginger", "mushroom", "corn", "green bean", "scallion", "green onion", "shallot", "leek", "beet", "radish", "arugula", "asparagus",
      "pea", "eggplant", "fennel", "salad", "sprout", "lemongrass", "chili", "chile", "jicama", "bok choy", "chard", "collard", "herb",
      "yam", "turnip", "parsnip", "okra", "artichoke", "tomatillo", "fig", "date", "pomegranate", "grapefruit", "watermelon", "apricot", "nectarine", "rhubarb", "romaine"]],
    ["beverages", ["juice", "coffee", "tea", "soda", "wine", "beer", "sparkling", "kombucha", "seltzer", "lemonade", "cider", "sake", "vermouth", "brandy", "rum", "vodka", "whiskey", "bourbon", "tequila", "mineral water"]],
    ["pantry", ["flour", "sugar", "rice", "pasta", "spaghetti", "penne", "macaroni", "noodle", "oil", "vinegar", "honey", "syrup", "oat", "cereal",
      "quinoa", "baking soda", "baking powder", "yeast", "cornstarch", "starch", "vanilla", "chocolate", "nut", "almond", "walnut", "pecan",
      "peanut", "cashew", "pistachio", "cocoa", "breadcrumb", "panko", "cracker", "chip", "jam", "jelly", "mustard", "ketchup", "mayonnaise",
      "mayo", "salsa", "olive", "caper", "pickle", "bean", "tahini", "soy", "miso", "sriracha", "hot sauce", "worcestershire", "raisin",
      "seed", "coconut", "gelatin", "extract", "molasses", "couscous", "barley", "polenta", "cornmeal", "lasagna", "ramen", "granola"]],
  ];
  // Things you never need to buy.
  const NEVER_SHOP = new Set(["water", "ice", "hot water", "cold water", "warm water", "boiling water", "ice water", "lukewarm water", "tap water", "ice cube"]);

  function guessCategory(name, unit) {
    if (unit === "can" || unit === "jar") return "pantry";
    const n = " " + normalizeName(name).replace(/-/g, " ") + " ";
    for (let i = 0; i < CATEGORY_RULES.length; i++) {
      const [cat, words] = CATEGORY_RULES[i];
      for (let j = 0; j < words.length; j++) {
        const w = words[j].replace(/-/g, " ");
        const re = new RegExp("(^|[^a-z])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(e?s)?([^a-z]|$)");
        if (re.test(n)) return cat;
      }
    }
    return "other";
  }
  function isNeverShop(name) { return NEVER_SHOP.has(normalizeName(name)); }

  V.units = {
    UNITS, COUNT_UNITS, UNIT_CHOICES, unitInfo, canonicalUnit, normalizeUnit, unitLabel, toBase, dimOf, bestUnit,
    parseQuantity, formatQty, formatAmount,
    singularize, normalizeName, displayName, splitUnitFromName, parseIngredientLine,
    guessCategory, isNeverShop,
  };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
