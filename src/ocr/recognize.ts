import { createWorker, type Worker } from 'tesseract.js';
import { round2 } from '../scheduling/text';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      cachePath: '.cache/tesseract',
    });
  }
  return workerPromise;
}

export async function recognizeImage(image: Buffer): Promise<{ text: string; confidence: number }> {
  const worker = await getWorker();
  const result = await worker.recognize(image);
  const text = result.data.text.replace(/\s+/g, ' ').trim();
  const confidence = round2(Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100)));
  return { text, confidence };
}
