// The family survey: features to rate and the answer options. Used by the survey page
// (js/survey.js) and by the server (api/survey.js) to check answers.

export const FEATURES = [
  { id: 'plan', name: 'Meal planning', what: 'Plan breakfast, lunch and dinner for the week. Copy last week in one tap.' },
  { id: 'check', name: 'Ingredient check', what: 'Before cooking, tap Have or Need for each ingredient. What you need goes on the list.' },
  { id: 'list', name: 'One shopping list', what: 'The whole family sees one list. Tap “I’ll buy” so two people don’t buy the same thing.' },
  { id: 'speak', name: 'Speak to add', what: 'Say “2 kg rice, milk, tomato” in English, Malayalam, Hindi or Tamil.' },
  { id: 'scan', name: 'Scan a bill', what: 'Photograph a shop bill. Items are marked bought and the spend is saved. The photo stays on your phone.' },
  { id: 'tasks', name: 'Shared tasks', what: 'Ask someone for a hand (“Pay electricity bill”). They accept or say “Can’t today”. Can repeat daily or weekly.' },
  { id: 'nutrition', name: 'Weekly nutrition', what: 'Calories, protein, carbs, fat and fibre the family ate this week, against the ICMR-NIN guide.' },
  { id: 'outside', name: 'Eating-out spend', what: 'Log restaurant, delivery, snacks and canteen food. See groceries vs eating out each week.' },
  { id: 'family', name: 'Family phones', what: 'Connect each person’s phone with a QR code, as “Can edit” or “View only”. No email or password.' },
];

export const EXTRAS = [
  'Works without internet and installs like an app',
  'Family recipes and favourite meals',
  'Bought history, with who bought what and when',
  'Download a backup of your home',
  'Send feedback from inside the app',
];

export const RATING = { useful: 'Useful', maybe: 'Maybe', no: 'Not for us' };

export const USED = { regular: 'Yes, we use it', tried: 'Tried it once or twice', not_yet: 'Not yet' };
export const SIZES = ['1-2', '3-4', '5-6', '7+'];
export const PLANNER = { me: 'Me', spouse: 'My spouse', parent: 'A parent', shared: 'We share it', help: 'Home help or cook' };
export const LANGS = { ml: 'Malayalam', en: 'English', hi: 'Hindi', ta: 'Tamil', other: 'Other' };
export const TODAY = {
  whatsapp: 'WhatsApp messages', paper: 'Paper list', memory: 'From memory',
  notes: 'Phone notes', app: 'Another app', nothing: 'We don’t plan',
};
export const PRICE = {
  free: 'Only if it’s free', m49: '₹49 a month', m99: '₹99 a month', y499: '₹499 a year', unsure: 'Not sure yet',
};
