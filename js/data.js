// Built-in catalog. Each item: [Name, Category, default unit, ...aliases]
// Aliases cover English, romanised Malayalam/Hindi, Malayalam script and Hindi script.
// Add more aliases freely; matching ignores case and plural "s".

export const CATEGORIES = [
  'Vegetables', 'Fruits', 'Dairy & eggs', 'Grains & flour', 'Pulses',
  'Spices & masala', 'Oil & essentials', 'Meat & fish', 'Bakery & snacks',
  'Drinks', 'Household', 'Personal care', 'Other',
];

const RAW = [
  // Vegetables
  ['Onion', 'Vegetables', 'kg', 'onions', 'savala', 'സവാള', 'ഉള്ളി', 'pyaz', 'pyaaz', 'प्याज'],
  ['Small onion', 'Vegetables', 'kg', 'shallot', 'shallots', 'cheriya ulli', 'kunjulli', 'ചെറിയ ഉള്ളി', 'ചുവന്നുള്ളി'],
  ['Tomato', 'Vegetables', 'kg', 'tomatoes', 'thakkali', 'തക്കാളി', 'tamatar', 'टमाटर'],
  ['Potato', 'Vegetables', 'kg', 'potatoes', 'urulakizhangu', 'ഉരുളക്കിഴങ്ങ്', 'aloo', 'आलू'],
  ['Green chilli', 'Vegetables', 'g', 'green chillies', 'green chili', 'pachamulaku', 'പച്ചമുളക്', 'hari mirch', 'हरी मिर्च'],
  ['Ginger', 'Vegetables', 'g', 'inji', 'ഇഞ്ചി', 'adrak', 'अदरक'],
  ['Garlic', 'Vegetables', 'g', 'veluthulli', 'വെളുത്തുള്ളി', 'lahsun', 'लहसुन'],
  ['Curry leaves', 'Vegetables', 'pkt', 'curry leaf', 'kariveppila', 'കറിവേപ്പില'],
  ['Coriander leaves', 'Vegetables', 'pkt', 'coriander leaf', 'malli ila', 'മല്ലിയില', 'dhania patta', 'dhaniya', 'धनिया'],
  ['Carrot', 'Vegetables', 'kg', 'carrots', 'ക്യാരറ്റ്', 'gajar', 'गाजर'],
  ['Beans', 'Vegetables', 'kg', 'ബീൻസ്'],
  ['Cabbage', 'Vegetables', 'pcs', 'കാബേജ്', 'patta gobhi', 'पत्ता गोभी'],
  ['Cauliflower', 'Vegetables', 'pcs', 'gobi', 'gobhi', 'ഗോബി', 'फूलगोभी'],
  ['Drumstick', 'Vegetables', 'pcs', 'drumsticks', 'muringakka', 'മുരിങ്ങക്കായ'],
  ['Raw banana', 'Vegetables', 'kg', 'raw plantain', 'pachakaya', 'പച്ചക്കായ', 'kaya', 'കായ'],
  ['Brinjal', 'Vegetables', 'kg', 'eggplant', 'vazhuthananga', 'വഴുതനങ്ങ', 'baingan', 'बैंगन'],
  ['Ladies finger', 'Vegetables', 'kg', 'okra', 'bhindi', 'vendakka', 'വെണ്ടയ്ക്ക', 'भिंडी'],
  ['Cucumber', 'Vegetables', 'kg', 'vellarikka', 'വെള്ളരിക്ക', 'വെള്ളരി', 'kheera', 'खीरा'],
  ['Pumpkin', 'Vegetables', 'kg', 'mathanga', 'മത്തങ്ങ', 'kaddu', 'कद्दू'],
  ['Ash gourd', 'Vegetables', 'kg', 'kumbalanga', 'കുമ്പളങ്ങ'],
  ['Yam', 'Vegetables', 'kg', 'chena', 'ചേന'],
  ['Colocasia', 'Vegetables', 'kg', 'chembu', 'ചേമ്പ്', 'arbi'],
  ['Bitter gourd', 'Vegetables', 'kg', 'pavakka', 'പാവയ്ക്ക', 'karela', 'करेला'],
  ['Snake gourd', 'Vegetables', 'kg', 'padavalanga', 'പടവലങ്ങ'],
  ['Long beans', 'Vegetables', 'kg', 'payar', 'achinga', 'അച്ചിങ്ങ', 'പയർ'],
  ['Beetroot', 'Vegetables', 'kg', 'beet', 'ബീറ്റ്റൂട്ട്'],
  ['Capsicum', 'Vegetables', 'kg', 'bell pepper', 'shimla mirch'],
  ['Spinach', 'Vegetables', 'pkt', 'cheera', 'ചീര', 'palak', 'पालक'],
  ['Mushroom', 'Vegetables', 'pkt', 'mushrooms', 'koon', 'കൂൺ'],
  ['Peas', 'Vegetables', 'kg', 'green peas', 'matar', 'मटर'],
  ['Lemon', 'Vegetables', 'pcs', 'lemons', 'lime', 'naranga', 'നാരങ്ങ', 'nimbu', 'नींबू'],
  ['Mint', 'Vegetables', 'pkt', 'mint leaves', 'pudina', 'പുതിന', 'पुदीना'],
  ['Sweet potato', 'Vegetables', 'kg', 'madhurakizhangu', 'shakarkandi'],
  ['Tapioca', 'Vegetables', 'kg', 'kappa', 'cassava', 'കപ്പ', 'മരച്ചീനി'],

  // Fruits
  ['Banana', 'Fruits', 'dozen', 'bananas', 'pazham', 'പഴം', 'kela', 'केला'],
  ['Nendran banana', 'Fruits', 'kg', 'nendran', 'nenthrapazham', 'നേന്ത്രപ്പഴം'],
  ['Apple', 'Fruits', 'kg', 'apples', 'ആപ്പിൾ', 'seb', 'सेब'],
  ['Orange', 'Fruits', 'kg', 'oranges', 'ഓറഞ്ച്', 'santra'],
  ['Mango', 'Fruits', 'kg', 'mangoes', 'manga', 'മാങ്ങ', 'aam', 'आम'],
  ['Grapes', 'Fruits', 'kg', 'grape', 'munthiri', 'മുന്തിരി', 'angoor', 'अंगूर'],
  ['Papaya', 'Fruits', 'pcs', 'kappalanga', 'pappaya', 'പപ്പായ', 'papita'],
  ['Pineapple', 'Fruits', 'pcs', 'kaithachakka', 'പൈനാപ്പിൾ'],
  ['Watermelon', 'Fruits', 'pcs', 'tharbooza', 'തണ്ണിമത്തൻ', 'tarbooz'],
  ['Pomegranate', 'Fruits', 'kg', 'mathalanaranga', 'anar', 'अनार'],
  ['Guava', 'Fruits', 'kg', 'pera', 'പേരക്ക', 'amrood'],

  // Dairy & eggs
  ['Milk', 'Dairy & eggs', 'L', 'paal', 'pal', 'പാൽ', 'doodh', 'dudh', 'दूध'],
  ['Curd', 'Dairy & eggs', 'pkt', 'yogurt', 'yoghurt', 'thairu', 'തൈര്', 'dahi', 'दही'],
  ['Buttermilk', 'Dairy & eggs', 'pkt', 'moru', 'മോര്', 'chaas', 'छाछ'],
  ['Eggs', 'Dairy & eggs', 'pcs', 'egg', 'mutta', 'മുട്ട', 'anda', 'ande', 'अंडा', 'अंडे'],
  ['Butter', 'Dairy & eggs', 'pkt', 'venna', 'വെണ്ണ', 'makhan', 'मक्खन'],
  ['Ghee', 'Dairy & eggs', 'bottle', 'neyyu', 'ney', 'നെയ്യ്', 'घी'],
  ['Paneer', 'Dairy & eggs', 'pkt', 'cottage cheese', 'പനീർ', 'पनीर'],
  ['Cheese', 'Dairy & eggs', 'pkt', 'ചീസ്'],

  // Grains & flour
  ['Rice', 'Grains & flour', 'kg', 'ari', 'അരി', 'chawal', 'chaval', 'चावल'],
  ['Matta rice', 'Grains & flour', 'kg', 'kerala rice', 'red rice', 'rose matta', 'kuthari', 'കുത്തരി', 'മട്ട അരി'],
  ['Basmati rice', 'Grains & flour', 'kg', 'basmati', 'biryani rice', 'ബസ്മതി'],
  ['Raw rice', 'Grains & flour', 'kg', 'pachari', 'പച്ചരി'],
  ['Wheat flour', 'Grains & flour', 'kg', 'atta', 'gothambu podi', 'ഗോതമ്പ് പൊടി', 'ആട്ട', 'आटा'],
  ['Maida', 'Grains & flour', 'kg', 'all purpose flour', 'മൈദ', 'मैदा'],
  ['Rava', 'Grains & flour', 'kg', 'sooji', 'suji', 'semolina', 'റവ', 'सूजी'],
  ['Puttu podi', 'Grains & flour', 'kg', 'puttu flour', 'puttupodi', 'പുട്ടുപൊടി', 'പുട്ട് പൊടി'],
  ['Appam podi', 'Grains & flour', 'kg', 'appam flour', 'palappam podi', 'അപ്പം പൊടി', 'അപ്പപ്പൊടി'],
  ['Idiyappam podi', 'Grains & flour', 'kg', 'idiyappam flour', 'ഇടിയപ്പം പൊടി'],
  ['Dosa batter', 'Grains & flour', 'pkt', 'idli batter', 'idli dosa batter', 'maavu', 'മാവ്'],
  ['Poha', 'Grains & flour', 'kg', 'aval', 'അവൽ', 'पोहा'],
  ['Oats', 'Grains & flour', 'pkt', 'ഓട്സ്'],
  ['Vermicelli', 'Grains & flour', 'pkt', 'semiya', 'സേമിയ', 'सेवई'],
  ['Ragi', 'Grains & flour', 'kg', 'ragi flour', 'muthari', 'മുത്താറി', 'finger millet'],
  ['Corn flour', 'Grains & flour', 'pkt', 'cornflour'],
  ['Besan', 'Grains & flour', 'kg', 'gram flour', 'kadala podi', 'കടലമാവ്', 'बेसन'],

  // Pulses
  ['Toor dal', 'Pulses', 'kg', 'dal', 'daal', 'parippu', 'thuvara parippu', 'പരിപ്പ്', 'तूर दाल', 'दाल', 'arhar dal'],
  ['Moong dal', 'Pulses', 'kg', 'cherupayar parippu', 'ചെറുപയർ പരിപ്പ്', 'मूंग दाल'],
  ['Green gram', 'Pulses', 'kg', 'cherupayar', 'ചെറുപയർ', 'moong', 'मूंग'],
  ['Urad dal', 'Pulses', 'kg', 'uzhunnu', 'ഉഴുന്ന്', 'उड़द दाल'],
  ['Black chana', 'Pulses', 'kg', 'kadala', 'kala chana', 'കടല', 'काला चना'],
  ['Chickpeas', 'Pulses', 'kg', 'kabuli chana', 'chole', 'vella kadala', 'വെള്ളക്കടല', 'छोले'],
  ['Masoor dal', 'Pulses', 'kg', 'red lentils', 'masoor', 'मसूर'],
  ['Rajma', 'Pulses', 'kg', 'kidney beans', 'राजमा'],
  ['Cowpea', 'Pulses', 'kg', 'van payar', 'vanpayar', 'വൻപയർ', 'lobia'],

  // Spices & masala
  ['Salt', 'Spices & masala', 'kg', 'uppu', 'ഉപ്പ്', 'namak', 'नमक'],
  ['Turmeric powder', 'Spices & masala', 'pkt', 'turmeric', 'manjal', 'manjal podi', 'മഞ്ഞൾ', 'മഞ്ഞൾപ്പൊടി', 'haldi', 'हल्दी'],
  ['Chilli powder', 'Spices & masala', 'pkt', 'chili powder', 'mulaku podi', 'മുളകുപൊടി', 'lal mirch', 'mirchi powder', 'मिर्च'],
  ['Kashmiri chilli powder', 'Spices & masala', 'pkt', 'kashmiri chilli', 'kashmiri mulaku'],
  ['Coriander powder', 'Spices & masala', 'pkt', 'malli podi', 'മല്ലിപ്പൊടി', 'dhania powder'],
  ['Garam masala', 'Spices & masala', 'pkt', 'गरम मसाला'],
  ['Chicken masala', 'Spices & masala', 'pkt'],
  ['Fish masala', 'Spices & masala', 'pkt', 'meen masala'],
  ['Sambar powder', 'Spices & masala', 'pkt', 'sambar masala', 'സാമ്പാർ പൊടി'],
  ['Rasam powder', 'Spices & masala', 'pkt'],
  ['Mustard seeds', 'Spices & masala', 'pkt', 'mustard', 'kaduku', 'കടുക്', 'rai', 'राई'],
  ['Cumin', 'Spices & masala', 'pkt', 'cumin seeds', 'jeerakam', 'ജീരകം', 'jeera', 'जीरा'],
  ['Pepper', 'Spices & masala', 'pkt', 'black pepper', 'kurumulaku', 'കുരുമുളക്', 'kali mirch'],
  ['Dry red chilli', 'Spices & masala', 'pkt', 'red chilli', 'vattal mulaku', 'വറ്റൽമുളക്'],
  ['Fenugreek', 'Spices & masala', 'pkt', 'uluva', 'ഉലുവ', 'methi', 'मेथी'],
  ['Cardamom', 'Spices & masala', 'pkt', 'elakka', 'ഏലയ്ക്ക', 'elaichi', 'इलायची'],
  ['Cinnamon', 'Spices & masala', 'pkt', 'karuvapatta', 'കറുവപ്പട്ട', 'dalchini'],
  ['Cloves', 'Spices & masala', 'pkt', 'grambu', 'ഗ്രാമ്പൂ', 'laung'],
  ['Tamarind', 'Spices & masala', 'pkt', 'puli', 'kudampuli', 'പുളി', 'imli', 'इमली'],
  ['Asafoetida', 'Spices & masala', 'pkt', 'hing', 'kayam', 'കായം', 'हींग'],

  // Oil & essentials
  ['Coconut', 'Oil & essentials', 'pcs', 'coconuts', 'thenga', 'തേങ്ങ', 'nariyal', 'नारियल'],
  ['Coconut oil', 'Oil & essentials', 'L', 'velichenna', 'വെളിച്ചെണ്ണ', 'nariyal tel'],
  ['Sunflower oil', 'Oil & essentials', 'L', 'cooking oil', 'refined oil'],
  ['Gingelly oil', 'Oil & essentials', 'L', 'sesame oil', 'nallenna', 'നല്ലെണ്ണ', 'til oil'],
  ['Mustard oil', 'Oil & essentials', 'L', 'sarson tel', 'सरसों तेल'],
  ['Oil', 'Oil & essentials', 'L', 'enna', 'എണ്ണ', 'tel', 'तेल'],
  ['Sugar', 'Oil & essentials', 'kg', 'panchasara', 'പഞ്ചസാര', 'cheeni', 'chini', 'चीनी'],
  ['Jaggery', 'Oil & essentials', 'kg', 'sharkkara', 'sarkara', 'ശർക്കര', 'gud', 'गुड़'],
  ['Tea powder', 'Oil & essentials', 'pkt', 'tea', 'chaya podi', 'ചായപ്പൊടി', 'chai patti', 'चाय पत्ती'],
  ['Coffee powder', 'Oil & essentials', 'pkt', 'coffee', 'kaapi', 'കാപ്പിപ്പൊടി', 'कॉफी'],
  ['Honey', 'Oil & essentials', 'bottle', 'തേൻ', 'shahad'],
  ['Pickle', 'Oil & essentials', 'bottle', 'achar', 'achaar', 'അച്ചാർ', 'अचार'],
  ['Pappadam', 'Oil & essentials', 'pkt', 'pappad', 'papad', 'pappadum', 'പപ്പടം', 'पापड़'],
  ['Ketchup', 'Oil & essentials', 'bottle', 'tomato sauce'],
  ['Vinegar', 'Oil & essentials', 'bottle', 'സുർക്ക'],

  // Meat & fish
  ['Chicken', 'Meat & fish', 'kg', 'kozhi', 'കോഴി', 'ചിക്കൻ', 'murgi', 'मुर्गी', 'चिकन'],
  ['Fish', 'Meat & fish', 'kg', 'meen', 'മീൻ', 'machli', 'मछली'],
  ['Sardine', 'Meat & fish', 'kg', 'mathi', 'chaala', 'മത്തി', 'ചാള'],
  ['Mackerel', 'Meat & fish', 'kg', 'ayala', 'അയല'],
  ['Prawns', 'Meat & fish', 'kg', 'prawn', 'shrimp', 'chemmeen', 'ചെമ്മീൻ', 'jhinga'],
  ['Beef', 'Meat & fish', 'kg', 'ബീഫ്', 'pothu', 'പോത്ത്'],
  ['Mutton', 'Meat & fish', 'kg', 'goat meat', 'aadu', 'ആട്', 'मटन'],

  // Bakery & snacks
  ['Bread', 'Bakery & snacks', 'pkt', 'ബ്രെഡ്', 'pav', 'ब्रेड'],
  ['Biscuits', 'Bakery & snacks', 'pkt', 'biscuit', 'cookies', 'ബിസ്കറ്റ്', 'बिस्कुट'],
  ['Rusk', 'Bakery & snacks', 'pkt', 'toast'],
  ['Banana chips', 'Bakery & snacks', 'pkt', 'chips', 'upperi', 'ഉപ്പേരി'],
  ['Noodles', 'Bakery & snacks', 'pkt', 'maggi', 'നൂഡിൽസ്'],

  // Drinks
  ['Juice', 'Drinks', 'bottle', 'ജ്യൂസ്'],
  ['Soft drink', 'Drinks', 'bottle', 'cool drink', 'soda', 'coke', 'pepsi'],
  ['Health drink', 'Drinks', 'pkt', 'horlicks', 'boost', 'bournvita'],
  ['Water bottle', 'Drinks', 'bottle', 'drinking water', 'mineral water'],

  // Household
  ['Dishwash liquid', 'Household', 'bottle', 'dishwash', 'vim', 'dish soap', 'pathram kazhukunna'],
  ['Detergent', 'Household', 'kg', 'washing powder', 'surf', 'tide', 'ariel', 'detergent powder', 'സോപ്പുപൊടി'],
  ['Floor cleaner', 'Household', 'bottle', 'lizol', 'phenyl'],
  ['Toilet cleaner', 'Household', 'bottle', 'harpic'],
  ['Garbage bags', 'Household', 'pkt', 'garbage bag', 'dustbin bags', 'waste bags'],
  ['Tissue', 'Household', 'pkt', 'tissues', 'tissue paper', 'napkins'],
  ['Matchbox', 'Household', 'pcs', 'match box', 'theeppetti', 'തീപ്പെട്ടി'],
  ['Mosquito repellent', 'Household', 'pcs', 'good knight', 'all out', 'mosquito coil'],
  ['Scrubber', 'Household', 'pcs', 'scrub', 'steel wool'],
  ['Aluminium foil', 'Household', 'pcs', 'foil'],
  ['Gas cylinder', 'Household', 'pcs', 'cylinder', 'lpg', 'gas'],

  // Personal care
  ['Bath soap', 'Personal care', 'pcs', 'soap', 'soaps', 'സോപ്പ്', 'sabun', 'साबुन'],
  ['Shampoo', 'Personal care', 'bottle', 'ഷാമ്പൂ'],
  ['Toothpaste', 'Personal care', 'pcs', 'paste', 'colgate', 'ടൂത്ത്പേസ്റ്റ്'],
  ['Toothbrush', 'Personal care', 'pcs', 'brush'],
  ['Hair oil', 'Personal care', 'bottle'],
  ['Sanitary pads', 'Personal care', 'pkt', 'pads', 'whisper', 'stayfree'],
  ['Diapers', 'Personal care', 'pkt', 'diaper', 'pampers'],
  ['Handwash', 'Personal care', 'bottle', 'hand wash'],
];

export const CATALOG = RAW.map(([name, cat, unit, ...aliases]) => ({ name, cat, unit, aliases }));

// Household meals. Quantities are for 4 people and scale with portions.
// `slots`: b = breakfast, l = lunch, d = dinner. `ing`: "Catalog name qty unit; …"
const R = (name, mins, slots, ing, veg = true) => ({ name, mins, slots, veg, ing });
export const RECIPES = [
  // Breakfast
  R('Puttu + kadala curry', 40, 'b', 'Puttu podi 500 g; Black chana 250 g; Coconut 1 pcs; Onion 2 pcs; Coconut oil 50 ml'),
  R('Appam + veg stew', 45, 'bd', 'Appam podi 500 g; Coconut 1 pcs; Potato 3 pcs; Carrot 2 pcs; Onion 1 pcs; Ginger 20 g; Green chilli 3 pcs'),
  R('Appam + egg curry', 40, 'bd', 'Appam podi 500 g; Eggs 6 pcs; Onion 3 pcs; Tomato 2 pcs; Coconut 1 pcs', false),
  R('Idiyappam + egg curry', 40, 'bd', 'Idiyappam podi 500 g; Eggs 6 pcs; Onion 3 pcs; Tomato 2 pcs; Coconut 1 pcs', false),
  R('Dosa + chutney', 20, 'bd', 'Dosa batter 1 kg; Coconut 1 pcs; Green chilli 3 pcs; Small onion 100 g'),
  R('Dosa + sambar', 25, 'bd', 'Dosa batter 1 kg; Toor dal 150 g; Sambar powder 30 g; Tomato 2 pcs; Small onion 150 g'),
  R('Idli + sambar', 35, 'b', 'Dosa batter 1 kg; Toor dal 150 g; Sambar powder 30 g; Tomato 2 pcs; Small onion 150 g; Drumstick 2 pcs'),
  R('Upma', 20, 'b', 'Rava 300 g; Onion 1 pcs; Green chilli 2 pcs; Curry leaves 1 pkt'),
  R('Poha', 20, 'b', 'Poha 300 g; Onion 2 pcs; Potato 1 pcs; Peas 100 g'),
  R('Aloo paratha', 40, 'bd', 'Wheat flour 500 g; Potato 4 pcs; Curd 200 g; Butter 50 g'),
  R('Bread + omelette', 15, 'b', 'Bread 1 pkt; Eggs 6 pcs; Onion 1 pcs', false),
  R('Oats porridge', 10, 'b', 'Oats 200 g; Milk 1 L; Banana 4 pcs'),
  // Lunch
  R('Rice + sambar', 45, 'l', 'Matta rice 600 g; Toor dal 150 g; Sambar powder 30 g; Drumstick 2 pcs; Tomato 2 pcs; Small onion 150 g; Tamarind 30 g'),
  R('Rice + avial + thoran', 60, 'l', 'Matta rice 600 g; Raw banana 2 pcs; Yam 250 g; Carrot 2 pcs; Beans 250 g; Coconut 2 pcs; Curd 200 g; Cabbage 0.5 pcs'),
  R('Rice + fish curry', 45, 'ld', 'Matta rice 600 g; Fish 500 g; Tamarind 30 g; Chilli powder 30 g; Coconut 1 pcs; Coconut oil 50 ml', false),
  R('Rice + fish fry', 30, 'l', 'Matta rice 600 g; Sardine 500 g; Chilli powder 20 g; Turmeric powder 5 g; Coconut oil 100 ml', false),
  R('Rice + moru curry', 30, 'l', 'Matta rice 600 g; Buttermilk 500 ml; Green chilli 2 pcs; Pappadam 1 pkt'),
  R('Rice + parippu', 30, 'l', 'Matta rice 600 g; Moong dal 150 g; Coconut 1 pcs; Ghee 30 ml; Pappadam 1 pkt'),
  R('Rice + dal', 30, 'ld', 'Rice 500 g; Toor dal 200 g; Tomato 2 pcs; Onion 1 pcs'),
  R('Rice + rasam', 30, 'l', 'Rice 500 g; Tomato 3 pcs; Tamarind 20 g; Rasam powder 20 g; Garlic 30 g'),
  R('Rice + chicken curry', 60, 'ld', 'Matta rice 600 g; Chicken 1 kg; Onion 4 pcs; Tomato 2 pcs; Chicken masala 30 g; Coconut 1 pcs', false),
  R('Kanji + cherupayar', 40, 'ld', 'Matta rice 400 g; Green gram 200 g; Coconut 1 pcs; Pappadam 1 pkt'),
  R('Kappa + meen curry', 60, 'ld', 'Tapioca 1 kg; Fish 500 g; Tamarind 30 g; Chilli powder 30 g; Coconut oil 50 ml', false),
  R('Curd rice', 20, 'ld', 'Rice 400 g; Curd 500 g; Green chilli 2 pcs'),
  R('Lemon rice', 25, 'l', 'Rice 500 g; Lemon 3 pcs; Curry leaves 1 pkt'),
  R('Chicken biryani', 75, 'ld', 'Basmati rice 1 kg; Chicken 1 kg; Onion 5 pcs; Tomato 2 pcs; Curd 200 g; Ghee 100 ml; Garam masala 20 g', false),
  R('Veg biryani', 60, 'ld', 'Basmati rice 750 g; Carrot 2 pcs; Beans 200 g; Peas 150 g; Onion 4 pcs; Curd 200 g; Ghee 75 ml'),
  R('Ghee rice + chicken roast', 60, 'ld', 'Basmati rice 750 g; Ghee 100 ml; Chicken 1 kg; Onion 4 pcs', false),
  R('Rajma chawal', 50, 'ld', 'Rajma 250 g; Rice 500 g; Onion 2 pcs; Tomato 3 pcs'),
  R('Dal khichdi', 35, 'ld', 'Rice 300 g; Moong dal 200 g; Ghee 30 ml'),
  // Dinner
  R('Chapati + chana', 30, 'd', 'Wheat flour 400 g; Chickpeas 250 g; Tomato 500 g; Onion 2 pcs'),
  R('Chapati + chicken curry', 50, 'd', 'Wheat flour 400 g; Chicken 750 g; Onion 3 pcs; Tomato 2 pcs; Chicken masala 25 g', false),
  R('Chapati + dal', 30, 'd', 'Wheat flour 400 g; Toor dal 200 g; Tomato 2 pcs; Onion 1 pcs'),
  R('Chapati + paneer', 35, 'd', 'Wheat flour 400 g; Paneer 200 g; Onion 2 pcs; Tomato 3 pcs; Capsicum 1 pcs'),
  R('Chapati + veg kurma', 45, 'bd', 'Wheat flour 500 g; Potato 2 pcs; Carrot 2 pcs; Peas 150 g; Coconut 1 pcs'),
  R('Porotta + beef fry', 60, 'd', 'Maida 500 g; Beef 1 kg; Onion 3 pcs; Coconut 1 pcs; Pepper 10 g', false),
  R('Fried rice', 30, 'ld', 'Basmati rice 500 g; Carrot 2 pcs; Beans 150 g; Cabbage 0.5 pcs; Eggs 4 pcs', false),
  R('Veg noodles', 20, 'd', 'Noodles 2 pkt; Carrot 1 pcs; Cabbage 0.5 pcs; Capsicum 1 pcs'),
  R('Egg roast', 30, 'ld', 'Eggs 8 pcs; Onion 4 pcs; Tomato 2 pcs; Coconut oil 50 ml', false),
  R('Prawns roast', 40, 'ld', 'Prawns 500 g; Onion 3 pcs; Tomato 2 pcs', false),
  R('Mutton curry', 75, 'ld', 'Mutton 1 kg; Onion 4 pcs; Tomato 2 pcs; Garam masala 20 g', false),
];

// Usual dinners offered during setup.
export const SETUP_DINNERS = ['Chapati + chana', 'Rice + dal', 'Dosa + sambar', 'Appam + veg stew', 'Rice + fish curry', 'Kanji + cherupayar'];

// One-tap chips on the list when history is still empty.
export const QUICK_ADD = ['Milk', 'Eggs', 'Bread', 'Tomato', 'Onion', 'Curd', 'Coconut', 'Banana', 'Dishwash liquid', 'Bath soap'];
