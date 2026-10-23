// Reads a bill photo on the phone with Tesseract.js (loaded only when first needed).
import { parseBill } from './parse.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the bill reader. Check your internet for the first scan.'));
    document.head.appendChild(s);
  });
}

let progressCb = () => {};

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('eng', 1, {
        logger: (m) => progressCb(m),
      });
    })().catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

// Shrink and greyscale the photo: faster and usually more accurate.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.4 + 128)); // a little more contrast
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Scan a bill photo. onProgress(fraction 0..1, label). */
export async function scanBill(file, onProgress) {
  progressCb = (m) => {
    if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'Reading the bill…');
    else onProgress(Math.min(0.3, (m.progress || 0) * 0.3), 'Getting the bill reader ready…');
  };
  onProgress(0.02, 'Getting the bill reader ready…');
  const [worker, canvas] = await Promise.all([getWorker(), prepare(file)]);
  const { data } = await worker.recognize(canvas);
  onProgress(1, 'Done');
  return parseBill(data.text);
}
