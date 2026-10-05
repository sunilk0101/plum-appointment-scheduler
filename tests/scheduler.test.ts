import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { groundProposal, proposalsConflict } from '../src/scheduling/validate';
import { extractEntities } from '../src/scheduling/entities';
import { normalizeEntities } from '../src/scheduling/normalize';
import { runPipeline } from '../src/scheduling/pipeline';
import { reviewEntities } from '../src/scheduling/review';
import { TZ } from '../src/config';

const REF = DateTime.fromISO('2025-09-19', { zone: TZ });
const SAMPLE = 'Book dentist next Friday at 3pm';

describe('appointment pipeline', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
  it('matches the assignment sample for 19 Sep 2025', async () => {
    const result = await runPipeline({ text: SAMPLE, referenceDate: REF });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.extraction).toEqual({
      raw_text: SAMPLE,
      confidence: 0.9,
    });
    expect(result.entities).toEqual({
      entities: {
        date_phrase: 'next Friday',
        time_phrase: '3pm',
        department: 'dentist',
      },
      entities_confidence: 0.85,
    });
    expect(result.normalization).toEqual({
      normalized: {
        date: '2025-09-26',
        time: '15:00',
        tz: 'Asia/Kolkata',
      },
      normalization_confidence: 0.9,
    });
    expect(result.appointment).toEqual({
      appointment: {
        department: 'Dentistry',
        date: '2025-09-26',
        time: '15:00',
        tz: 'Asia/Kolkata',
      },
      status: 'ok',
    });
    expect(result.validation.grounded).toBe(true);
    expect(result.ai.mode).toBe('deterministic');
  });

  it('normalizes the noisy OCR sample without rewriting raw text', async () => {
    const noisy = 'book dentist nxt Friday @ 3 pm';
    const result = await runPipeline({ text: noisy, referenceDate: REF });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.extraction.raw_text).toBe(noisy);
    expect(result.entities).toEqual({
      entities: {
        date_phrase: 'next Friday',
        time_phrase: '3pm',
        department: 'dentist',
      },
      entities_confidence: 0.85,
    });
    expect(result.ocr_repairs).toEqual(['nxt Friday -> next Friday', '3 pm -> 3pm']);
    expect(result.ai.chain.map((step) => step.step)).toEqual(['propose', 'validate']);
    expect(result.appointment.appointment).toMatchObject({
      department: 'Dentistry',
      date: '2025-09-26',
      time: '15:00',
      tz: 'Asia/Kolkata',
    });
  });

  it('reads an email-shaped note', async () => {
    const email = ['From: care@clinic.test', 'Subject: Booking', '', 'Hi team, please book dentist next Friday at 3pm.', 'Thanks'].join('\n');
    const result = await runPipeline({ text: email, referenceDate: REF });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appointment.appointment).toMatchObject({
      department: 'Dentistry',
      date: '2025-09-26',
      time: '15:00',
      tz: 'Asia/Kolkata',
    });
  });

  it('drops a model department that is not in the note', async () => {
    const result = await runPipeline({
      text: SAMPLE,
      referenceDate: REF,
      model: {
        name: 'fake-model',
        async propose() {
          return { date_phrase: 'next Friday', time_phrase: '3pm', department: 'cardiologist' };
        },
        async validate() {
          return { supported: true, issues: [] };
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appointment.appointment.department).toBe('Dentistry');
    expect(result.ai.chain[0]).toMatchObject({ step: 'propose', status: 'rejected' });
    expect(result.ai.chain[1]).toMatchObject({ step: 'validate', status: 'ok' });
  });

  it('resolves an explicit calendar date and a 24-hour time', async () => {
    const result = await runPipeline({
      text: 'Please book cardiologist on 26 September 2025 at 15:00',
      referenceDate: REF,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appointment.appointment).toMatchObject({
      department: 'Cardiology',
      date: '2025-09-26',
      time: '15:00',
    });
  });

  it('asks for clarification when the date, time, or department is ambiguous or missing', async () => {
    const cases = [
      'Book dentist next Friday',
      'Book appointment next Friday at 3pm',
      'Book dentist Friday or Monday at 3pm',
      'Book dentist next Friday at 3pm or 4pm',
      'Book dentist next Friday morning',
      'Book dentist next Friday at 3',
      'Book dentist and cardiologist next Friday at 3pm',
      'Book plumber next Friday at 3pm',
      'Book dentist today or next Friday at 3pm',
      'Book doctor next Friday at 3pm',
      'Book dentist on 01/02/2025 at 3pm',
      'Book dentist on 2020-01-01 at 3pm',
    ];

    for (const text of cases) {
      const result = await runPipeline({ text, referenceDate: REF });
      expect(result.ok, text).toBe(false);
      if (result.ok) continue;
      expect(result.clarification).toEqual({
        status: 'needs_clarification',
        message: 'Ambiguous date/time or department',
      });
    }
  });

  it('rolls an omitted year forward when that month-day has passed', async () => {
    const ref = DateTime.fromISO('2025-10-01', { zone: TZ });
    const result = await runPipeline({ text: 'Book dentist on 26 September at 3pm', referenceDate: ref });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appointment.appointment.date).toBe('2026-09-26');
  });

  it('rejects a model proposal that invents a department', async () => {
    const extracted = extractEntities(SAMPLE, REF);
    expect('entities' in extracted).toBe(true);
    if (!('entities' in extracted)) return;

    const review = await reviewEntities(SAMPLE, extracted, REF, {
      name: 'fake-model',
      async propose() {
        return { date_phrase: 'next Friday', time_phrase: '3pm', department: 'cardiologist' };
      },
      async validate() {
        return { supported: true, issues: [] };
      },
    });

    expect(review.clarification).toBeUndefined();
    expect(review.entities.entities.department).toBe('dentist');
    expect(review.ai.notes.join(' ')).toMatch(/Rejected model proposal/i);
    expect(groundProposal(SAMPLE, { date_phrase: 'next Monday', time_phrase: '3pm', department: 'dentist' }).ok).toBe(
      false,
    );
  });

  it('stops when a grounded model parse disagrees with the rules', async () => {
    const extracted = extractEntities(SAMPLE, REF);
    if (!('entities' in extracted)) throw new Error('expected entities');

    const source = 'Book dentist today or next Friday at 3pm';
    const proposal = { date_phrase: 'today', time_phrase: '3pm', department: 'dentist' };
    expect(proposalsConflict(extracted.entities, proposal, REF)).toBe(true);

    const review = await reviewEntities(source, extracted, REF, {
      name: 'fake-model',
      async propose() {
        return proposal;
      },
      async validate() {
        return { supported: true, issues: [] };
      },
    });

    expect(review.clarification?.reason).toBe('model_conflict');
    expect(review.ai.accepted_model_entities).toBe(false);
  });
});

describe('normalize step', () => {
  it('normalizes phrases without the original sentence', () => {
    const result = normalizeEntities(
      { date_phrase: 'next Friday', time_phrase: '3pm', department: 'dentist' },
      REF,
    );
    expect(result).toEqual({
      normalized: { date: '2025-09-26', time: '15:00', tz: 'Asia/Kolkata' },
      normalization_confidence: 0.9,
    });
  });
});
