// The app's words in the family's language: English, Malayalam, Hindi or Tamil.
// The English text is the key, so anything not translated yet simply stays in English.
// Placeholders look like {n} or {name}: t('{n} need you', { n: 3 }).
import ml from './lang/ml.js';
import hi from './lang/hi.js';
import ta from './lang/ta.js';

export const UI_LANGS = { en: 'English', ml: 'മലയാളം', hi: 'हिंदी', ta: 'தமிழ்' };
const TABLES = { ml, hi, ta };
const LOCALES = { en: 'en-IN', ml: 'ml-IN', hi: 'hi-IN', ta: 'ta-IN' };

let lang = 'en';

/** Use this language for every screen from now on. Unknown codes fall back to English. */
export function setLang(code) {
  lang = LOCALES[code] ? code : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
export const getLang = () => lang;
/** For dates: 'ml-IN', 'hi-IN'… */
export const locale = () => LOCALES[lang];
/** The app language that fits a voice language ('ml-IN' → 'ml'). */
export const langOfVoice = (voice) => (LOCALES[String(voice || '').slice(0, 2)] ? String(voice).slice(0, 2) : 'en');

/** The text in the current language, with {placeholders} filled in. */
export function t(text, vars) {
  const s = (lang !== 'en' && TABLES[lang]?.[text]) || text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}

/** Every key a table has that English doesn't use any more (for the tests). */
export const tables = () => TABLES;
