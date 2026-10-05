import { DateTime } from 'luxon';
import { z } from 'zod';
import { TZ } from '../config';
import { HttpError } from '../errors';
import type { Entities } from '../scheduling/entities';

const entitiesSchema = z.object({
  date_phrase: z.string().min(1).max(200),
  time_phrase: z.string().min(1).max(200),
  department: z.string().min(1).max(200),
});

const bodySchema = z.object({
  text: z.string().max(10_000).optional(),
  raw_text: z.string().max(10_000).optional(),
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entities: z.union([entitiesSchema, z.string()]).optional(),
});

export type ParsedRequest = {
  text?: string;
  entities?: Entities;
  referenceDate?: DateTime;
};

export function parseRequestBody(body: unknown): ParsedRequest {
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, 'Request body is invalid. Check text, entities, and reference_date.');
  }

  let entities: Entities | undefined;
  if (typeof parsed.data.entities === 'string') {
    try {
      entities = entitiesSchema.parse(JSON.parse(parsed.data.entities));
    } catch {
      throw new HttpError(400, 'entities must be JSON with date_phrase, time_phrase, and department.');
    }
  } else {
    entities = parsed.data.entities;
  }

  return {
    text: parsed.data.text ?? parsed.data.raw_text,
    entities,
    referenceDate: parseReferenceDate(parsed.data.reference_date),
  };
}

export function parseReferenceDate(value: string | undefined): DateTime | undefined {
  if (!value) return undefined;
  const parsed = DateTime.fromISO(value, { zone: TZ });
  if (!parsed.isValid || parsed.toISODate() !== value) {
    throw new HttpError(400, 'reference_date must be a real YYYY-MM-DD date.');
  }
  return parsed.startOf('day');
}
