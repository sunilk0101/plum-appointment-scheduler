import { DateTime } from 'luxon';
import { createLanguageModel, type LanguageModel } from '../ai/model';
import { TZ } from '../config';
import { recognizeImage } from '../ocr/recognize';
import { extractEntities, type Entities, type EntitiesResult } from './entities';
import { clarification, isClarification, toPublicClarification, type Clarification, type FailureReason } from './guardrail';
import { normalizeEntities, toAppointment, type AppointmentResult, type Normalization } from './normalize';
import { reviewEntities, type AiTrace } from './review';
import { round2 } from './text';
import { validateAppointment } from './validate';

export type Extraction = {
  raw_text: string;
  confidence: number;
};

export type PipelineInput = {
  text?: string;
  image?: Buffer;
  prepared?: Extraction;
  entities?: Entities;
  referenceDate?: DateTime;
  model?: LanguageModel | null;
};

export type PipelineSuccess = {
  ok: true;
  extraction: Extraction;
  entities: EntitiesResult;
  normalization: Normalization;
  appointment: AppointmentResult;
  ai: AiTrace;
  ocr_repairs: string[];
  validation: { grounded: true; checks: string[] };
};

export type PipelineFailure = {
  ok: false;
  clarification: Clarification;
  reason: FailureReason;
  extraction?: Extraction;
  entities?: EntitiesResult;
  ai?: AiTrace;
};

export type PipelineResult = PipelineSuccess | PipelineFailure;

export async function extractContent(input: PipelineInput): Promise<Extraction> {
  if (input.image) {
    const ocr = await recognizeImage(input.image);
    return {
      raw_text: ocr.text.replace(/\s+/g, ' ').trim(),
      confidence: round2(ocr.confidence),
    };
  }
  const text = input.text?.trim() ?? '';
  return { raw_text: text, confidence: text ? 0.9 : 0 };
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const ref = input.referenceDate ?? DateTime.now().setZone(TZ);
  const hasSource = Boolean(input.prepared || input.image || (input.text && input.text.trim()));
  const extraction = input.prepared ?? (hasSource ? await extractContent(input) : null);

  if (input.image && extraction && !extraction.raw_text) {
    return fail(clarification('missing_date'), extraction);
  }

  const source = extraction?.raw_text ?? '';
  let entities: EntitiesResult;
  let ocrRepairs: string[] = [];
  if (input.entities && !hasSource) {
    entities = { entities: input.entities, entities_confidence: 0.85 };
  } else {
    const parsed = extractEntities(source, ref);
    if (isClarification(parsed)) {
      return fail(parsed, extraction ?? undefined);
    }
    ocrRepairs = parsed.repairs;
    entities = { entities: parsed.entities, entities_confidence: parsed.entities_confidence };
  }

  let ai: AiTrace | undefined;
  if (hasSource) {
    const model = input.model === undefined ? createLanguageModel() : input.model;
    const review = await reviewEntities(source, entities, ref, model);
    ai = review.ai;
    if (review.clarification) return fail(review.clarification, extraction ?? undefined, entities, ai);
    entities = review.entities;
  }

  const normalization = normalizeEntities(entities.entities, ref);
  if (isClarification(normalization)) {
    return fail(normalization, extraction ?? undefined, entities, ai);
  }

  const appointment = toAppointment(entities.entities, normalization);
  if (isClarification(appointment)) {
    return fail(appointment, extraction ?? undefined, entities, ai);
  }

  const validation = validateAppointment(hasSource ? source : null, entities.entities, normalization, appointment, ref);
  if (!validation.ok) {
    return fail(clarification('ungrounded'), extraction ?? undefined, entities, ai);
  }

  return {
    ok: true,
    extraction: extraction ?? { raw_text: source, confidence: 0.9 },
    entities,
    normalization,
    appointment,
    ai: ai ?? {
      mode: 'deterministic',
      model: 'deterministic-guard',
      grounded: true,
      accepted_model_entities: false,
      notes: ['Entities were supplied directly, so source grounding was skipped.'],
      chain: [
        {
          step: 'propose',
          provider: 'caller',
          status: 'ok',
          detail: 'Entities were supplied by the caller.',
        },
        {
          step: 'validate',
          provider: 'deterministic-guard',
          status: 'ok',
          detail: 'Phrases normalized without a source note to ground against.',
        },
      ],
    },
    ocr_repairs: ocrRepairs,
    validation: { grounded: true, checks: validation.checks },
  };
}

function fail(
  result: ReturnType<typeof clarification>,
  extraction?: Extraction,
  entities?: EntitiesResult,
  ai?: AiTrace,
): PipelineFailure {
  return {
    ok: false,
    clarification: toPublicClarification(result),
    reason: result.reason,
    extraction,
    entities,
    ai,
  };
}
