// Small wrapper around the browser's speech recognition.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = !!Recognition;

const SILENCE_MS = 6000;   // stop after this long with no new words
const MAX_MS = 60_000;     // and never listen for more than a minute

/**
 * Keep listening until stop() is called (or a long pause), so a whole sentence like
 * "2 kg rice, 1 litre milk and 6 eggs" comes through. Browsers that end the session
 * after a short pause are restarted quietly while the person is still talking.
 * Calls onText(text) as words arrive and onEnd(finalText, error) once when done.
 * Returns a stop() function.
 */
export function listen(lang, { onText, onEnd }) {
  const finals = [];     // finished phrases from earlier sessions and this one
  let sessionFinals = []; // finished phrases in the current session
  let interim = '';
  let error = null;
  let stopped = false, done = false;
  let rec = null;
  const started = Date.now();
  let lastWord = Date.now();
  let silence = null;

  const text = () => [...finals, ...sessionFinals, interim].join(' ').replace(/\s+/g, ' ').trim();
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(silence);
    finals.push(...sessionFinals); sessionFinals = [];
    // Words still being recognised when the person tapped stop count too.
    if (interim) { finals.push(interim); interim = ''; }
    onEnd(text(), error);
  };

  const begin = () => {
    rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      // Rebuild from every result each time: some Android versions resend earlier ones.
      const fin = [];
      let live = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (!t) continue;
        if (e.results[i].isFinal) {
          // ...and some repeat a growing phrase ("rice", "rice milk"): keep the longest.
          if (fin.length && t.toLowerCase().startsWith(fin[fin.length - 1].toLowerCase())) fin[fin.length - 1] = t;
          else fin.push(t);
        } else live += (live ? ' ' : '') + t;
      }
      sessionFinals = fin;
      interim = live;
      lastWord = Date.now();
      onText(text());
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech' || !text()) error = e.error; };
    rec.onend = () => {
      finals.push(...sessionFinals); sessionFinals = [];
      if (interim) { finals.push(interim); interim = ''; }
      const keepGoing = !stopped && !error && Date.now() - started < MAX_MS && Date.now() - lastWord < SILENCE_MS;
      if (keepGoing) { try { begin(); return; } catch { /* fall through and finish */ } }
      finish();
    };
    rec.start();
  };

  try {
    begin();
  } catch {
    error = 'start-failed';
    finish();
    return () => {};
  }
  silence = setInterval(() => {
    const quiet = Date.now() - lastWord > (text() ? SILENCE_MS : SILENCE_MS + 2000);
    if (quiet || Date.now() - started > MAX_MS) stop();
  }, 500);

  function stop() {
    if (stopped) return;
    stopped = true;
    try { rec.stop(); } catch { finish(); }
    // Some browsers never fire onend after stop(); don't leave the sheet hanging.
    setTimeout(finish, 1500);
  }
  return stop;
}

export function speechError(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone is blocked. Allow it in browser settings, or type below.';
  if (code === 'no-speech') return 'Didn’t hear anything. Tap the mic and try again.';
  if (code === 'network') return 'Voice needs internet. Type below instead.';
  if (code) return 'Voice didn’t work this time. Type below instead.';
  return '';
}
