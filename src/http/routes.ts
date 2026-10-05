import { Router, type Request } from 'express';
import multer from 'multer';
import { HttpError } from '../errors';
import { extractContent, runPipeline, type Extraction, type PipelineResult } from '../scheduling/pipeline';
import { parseRequestBody } from './parse';

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|bmp|tiff)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

type Uploaded = { buffer: Buffer; mimetype: string };

export const appointmentsRouter = Router();

appointmentsRouter.post('/extract', asyncHandler(async (req, res) => {
  const { prepared, request } = await readInput(req);
  if (!prepared && !request.text?.trim()) {
    throw new HttpError(400, 'Provide text or an image.');
  }
  const extraction = prepared ?? (await extractContent({ text: request.text }));
  res.json(extraction);
}));

appointmentsRouter.post('/entities', asyncHandler(async (req, res) => {
  const result = await schedule(req);
  if (!result.ok) {
    res.json(result.clarification);
    return;
  }
  res.json(result.entities);
}));

appointmentsRouter.post('/normalize', asyncHandler(async (req, res) => {
  const result = await schedule(req);
  if (!result.ok) {
    res.json(result.clarification);
    return;
  }
  res.json(result.normalization);
}));

appointmentsRouter.post('/appointments', asyncHandler(async (req, res) => {
  const result = await schedule(req);
  if (!result.ok) {
    res.json(result.clarification);
    return;
  }
  res.json(result.appointment);
}));

appointmentsRouter.post('/pipeline', asyncHandler(async (req, res) => {
  const result = await schedule(req);
  if (!result.ok) {
    res.json({
      ...result.clarification,
      failure_reason: result.reason,
      ...(result.extraction ? { extraction: result.extraction } : {}),
      ...(result.entities ? { entities: result.entities } : {}),
      ...(result.ai ? { ai: result.ai } : {}),
    });
    return;
  }
  res.json({
    extraction: result.extraction,
    entities: result.entities,
    normalization: result.normalization,
    appointment: result.appointment,
    validation: result.validation,
    ai: result.ai,
    ...(result.ocr_repairs.length > 0 ? { ocr_repairs: result.ocr_repairs } : {}),
  });
}));

async function schedule(req: Request): Promise<PipelineResult> {
  const { prepared, request } = await readInput(req);
  if (!prepared && !request.text?.trim() && !request.entities) {
    throw new HttpError(400, 'Provide text, an image, or entities.');
  }
  return runPipeline({
    text: prepared ? undefined : request.text,
    prepared,
    entities: prepared || request.text?.trim() ? undefined : request.entities,
    referenceDate: request.referenceDate,
  });
}

async function readInput(req: Request): Promise<{ prepared?: Extraction; request: ReturnType<typeof parseRequestBody> }> {
  const request = parseRequestBody(req.body);
  const file = readImage(req);
  if (file && request.text?.trim()) {
    throw new HttpError(400, 'Send either text or an image, not both.');
  }
  if (!file) return { request };
  if (!IMAGE_MIME.test(file.mimetype)) {
    throw new HttpError(415, 'Upload a png, jpeg, webp, gif, bmp, or tiff image.');
  }
  const prepared = await extractContent({ image: file.buffer });
  if (!prepared.raw_text) {
    throw new HttpError(422, 'No text found in the image.');
  }
  return { prepared, request };
}

function readImage(req: Request): Uploaded | undefined {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file = files?.image?.[0] ?? files?.file?.[0];
  if (!file) return undefined;
  return { buffer: file.buffer, mimetype: file.mimetype };
}

function asyncHandler(
  handler: (req: Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>,
) {
  return (req: Request, res: import('express').Response, next: import('express').NextFunction) => {
    const type = req.header('content-type') ?? '';
    const run = () => {
      handler(req, res, next).catch(next);
    };
    if (!type.includes('multipart/form-data')) {
      run();
      return;
    }
    upload(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      run();
    });
  };
}
