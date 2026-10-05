import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ocr/recognize', () => ({
  recognizeImage: vi.fn(async () => ({
    text: 'book dentist nxt Friday @ 3 pm',
    confidence: 0.8,
  })),
}));

import { createApp } from '../src/http/app';

const app = createApp();
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('HTTP API', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('serves health and the endpoint index', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });

    const index = await request(app).get('/');
    expect(index.status).toBe(200);
    expect(index.body.endpoints).toContain('POST /api/v1/appointments');
  });

  it('returns each step schema for the sample sentence', async () => {
    const body = { text: 'Book dentist next Friday at 3pm', reference_date: '2025-09-19' };

    const extracted = await request(app).post('/api/v1/extract').send(body);
    expect(extracted.status).toBe(200);
    expect(extracted.body).toEqual({ raw_text: body.text, confidence: 0.9 });

    const entities = await request(app).post('/api/v1/entities').send(body);
    expect(entities.status).toBe(200);
    expect(Object.keys(entities.body)).toEqual(['entities', 'entities_confidence']);
    expect(entities.body.entities).toEqual({
      date_phrase: 'next Friday',
      time_phrase: '3pm',
      department: 'dentist',
    });

    const normalized = await request(app).post('/api/v1/normalize').send({
      entities: entities.body.entities,
      reference_date: '2025-09-19',
    });
    expect(normalized.status).toBe(200);
    expect(normalized.body).toEqual({
      normalized: { date: '2025-09-26', time: '15:00', tz: 'Asia/Kolkata' },
      normalization_confidence: 0.9,
    });

    const appointment = await request(app).post('/api/v1/appointments').send(body);
    expect(appointment.status).toBe(200);
    expect(appointment.body).toEqual({
      appointment: {
        department: 'Dentistry',
        date: '2025-09-26',
        time: '15:00',
        tz: 'Asia/Kolkata',
      },
      status: 'ok',
    });
  });

  it('returns the guardrail object with only the specified keys', async () => {
    const response = await request(app).post('/api/v1/appointments').send({
      text: 'Book dentist Friday or Monday at 3pm',
      reference_date: '2025-09-19',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'needs_clarification',
      message: 'Ambiguous date/time or department',
    });
  });

  it('parses an uploaded note image through OCR', async () => {
    const response = await request(app)
      .post('/api/v1/pipeline')
      .field('reference_date', '2025-09-19')
      .attach('image', png, { filename: 'note.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    expect(response.body.extraction.raw_text).toBe('book dentist nxt Friday @ 3 pm');
    expect(response.body.appointment.status).toBe('ok');
    expect(response.body.appointment.appointment.department).toBe('Dentistry');
    expect(response.body.validation.checks).toContain('date_phrase_in_source');
  });

  it('rejects a non-image upload, an empty OCR result, and broken JSON', async () => {
    const { recognizeImage } = await import('../src/ocr/recognize');
    vi.mocked(recognizeImage).mockResolvedValueOnce({ text: '   ', confidence: 0.1 });

    const emptyImage = await request(app)
      .post('/api/v1/extract')
      .attach('image', png, { filename: 'blank.png', contentType: 'image/png' });
    expect(emptyImage.status).toBe(422);

    const wrongType = await request(app)
      .post('/api/v1/extract')
      .attach('image', Buffer.from('not an image'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(wrongType.status).toBe(415);

    const broken = await request(app)
      .post('/api/v1/appointments')
      .set('Content-Type', 'application/json')
      .send('{"text":');
    expect(broken.status).toBe(400);
  });

  it('returns the published entity JSON for the OCR sample text', async () => {
    const response = await request(app).post('/api/v1/entities').send({
      text: 'book dentist nxt Friday @ 3 pm',
      reference_date: '2025-09-19',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      entities: {
        date_phrase: 'next Friday',
        time_phrase: '3pm',
        department: 'dentist',
      },
      entities_confidence: 0.85,
    });
  });

  it('rejects a bad reference date and an empty body', async () => {
    const badDate = await request(app).post('/api/v1/appointments').send({
      text: 'Book dentist next Friday at 3pm',
      reference_date: '2025-02-31',
    });
    expect(badDate.status).toBe(400);

    const empty = await request(app).post('/api/v1/appointments').send({});
    expect(empty.status).toBe(400);
  });
});
