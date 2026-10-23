// Small wrapper around the browser's speech recognition.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = !!Recognition;

/**
 * Start listening. Calls onText(text, isFinal) as words arrive and
 * onEnd(finalText, error) once when done. Returns a stop() function.
 */
export function listen(lang, { onText, onEnd }) {
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  let error = null;
  let ended = false;

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    onText((finalText + interim).trim(), !interim);
  };
  rec.onerror = (e) => { error = e.error; };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    onEnd(finalText.trim(), error);
  };

  try {
    rec.start();
  } catch {
    ended = true;
    onEnd('', 'start-failed');
  }
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

export function speechError(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone is blocked. Allow it in browser settings, or type below.';
  if (code === 'no-speech') return 'Didn’t hear anything. Tap the mic and try again.';
  if (code === 'network') return 'Voice needs internet. Type below instead.';
  if (code) return 'Voice didn’t work this time. Type below instead.';
  return '';
}
