# AI-Powered Appointment Scheduler

Backend for **Plum SDE Intern Assignment — Problem Statement 1**.

It turns a typed note or a photo of a note into a scheduling JSON object:

`OCR / text -> entity extraction -> Asia/Kolkata normalization -> guardrails -> appointment`

The sample sentence `Book dentist next Friday at 3pm`, read on **Friday 19 September 2025**, becomes Dentistry on **2025-09-26** at **15:00** in `Asia/Kolkata`.

## Why this problem

Plum's product work is about getting people to care without the usual friction. An appointment request is a small version of that: the input is messy (a sentence, a photo, an email), and the output has to be structured, local to India, and honest when the request is unclear. The other problem statements are valid. This one is the closest to a feature a care team would actually ship, and it exercises every item in the rubric: schema correctness, OCR, guardrails, and an AI chain that is not allowed to invent fields.

## Architecture

```text
text or image
    |
    v
Step 1  Extract
        typed text is kept as-is
        images go through Tesseract OCR
    |
    v
Step 2  Propose entities
        date phrase, time phrase, department
        deterministic extractor, optionally an LLM
    |
    v
        Validate
        every phrase must occur in the source
        LLM output that adds a field is discarded
        a grounded model parse that disagrees with the rules stops the request
    |
    v
Step 3  Normalize
        phrases -> ISO date + 24-hour time in Asia/Kolkata
        date math does not go through the model
    |
    v
Step 4  Appointment
        department alias -> canonical name (dentist -> Dentistry)
        status ok, or needs_clarification
```

Date math stays in code on purpose. A model is useful for reading messy language. It is a bad clock. The validator is the guardrail that keeps a fluent model from booking a department or a day the note never mentioned.

Without `OPENAI_API_KEY`, the same two-step chain runs on a deterministic proposer and a source-text validator, so the demo and the tests are reproducible. With a key, propose and validate are real chat completions. Ungrounded or conflicting model output never becomes the response.

## Setup

Node.js 20 or newer.

```bash
cd plum-appointment-scheduler
npm install
copy .env.example .env   # Windows
# cp .env.example .env   # macOS / Linux
npm start
```

The server listens on `http://localhost:3000`.

Optional model settings in `.env`:

```bash
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

`OPENAI_BASE_URL` can point at any OpenAI-compatible API (OpenAI, Groq, OpenRouter). Leave the key empty to run fully offline.

The first image request downloads the English Tesseract model into `.cache/tesseract`.

Check the suite:

```bash
npm test
npm run typecheck
```

Expose it for review:

```bash
ngrok http 3000
```

## API

| Method | Path | Success body |
| --- | --- | --- |
| `POST` | `/api/v1/extract` | Step 1 `{ raw_text, confidence }` |
| `POST` | `/api/v1/entities` | Step 2 `{ entities, entities_confidence }` |
| `POST` | `/api/v1/normalize` | Step 3 `{ normalized, normalization_confidence }` |
| `POST` | `/api/v1/appointments` | Step 4 `{ appointment, status }` |
| `POST` | `/api/v1/pipeline` | All four steps, plus validation checks and the AI trace |
| `GET` | `/health` | `{ "status": "ok" }` |

Send JSON:

```json
{
  "text": "Book dentist next Friday at 3pm",
  "reference_date": "2025-09-19"
}
```

`reference_date` is optional. It is the "today" used for phrases like `next Friday`, interpreted in `Asia/Kolkata`. Omit it to use the current date. The assignment's `2025-09-26` is what `next Friday` means when today is Friday `2025-09-19`.

`/api/v1/normalize` can also take entities from step 2:

```json
{
  "entities": {
    "date_phrase": "next Friday",
    "time_phrase": "3pm",
    "department": "dentist"
  },
  "reference_date": "2025-09-19"
}
```

Images are multipart form data. Use the field name `image` (or `file`) and an optional `reference_date` field. Do not send `text` and a file in the same request.

Business guardrails return HTTP 200 and this body, on `/entities`, `/normalize`, `/appointments`, and `/pipeline`:

```json
{
  "status": "needs_clarification",
  "message": "Ambiguous date/time or department"
}
```

`/pipeline` adds `failure_reason` (`missing_date`, `ambiguous_time`, `past_date`, `model_conflict`, and so on) so a reviewer can see which check fired. The four step endpoints stay on the assignment schema and do not add that field.

Malformed JSON, a bad `reference_date`, an empty body, or a non-image upload returns `400` or `415` with `{ "error": "..." }`. An image with no readable text returns `422`.

## Sample requests

These reproduce the assignment's expected appointment. JSON numbers drop the trailing zero, so `0.90` is `0.9`.

### Step 1 — text extraction

```bash
curl -s -X POST http://localhost:3000/api/v1/extract \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Book dentist next Friday at 3pm\",\"reference_date\":\"2025-09-19\"}"
```

```json
{
  "raw_text": "Book dentist next Friday at 3pm",
  "confidence": 0.9
}
```

### Step 2 — entities

```bash
curl -s -X POST http://localhost:3000/api/v1/entities \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Book dentist next Friday at 3pm\",\"reference_date\":\"2025-09-19\"}"
```

```json
{
  "entities": {
    "date_phrase": "next Friday",
    "time_phrase": "3pm",
    "department": "dentist"
  },
  "entities_confidence": 0.85
}
```

### Step 3 — normalization

```bash
curl -s -X POST http://localhost:3000/api/v1/normalize \
  -H "Content-Type: application/json" \
  -d "{\"entities\":{\"date_phrase\":\"next Friday\",\"time_phrase\":\"3pm\",\"department\":\"dentist\"},\"reference_date\":\"2025-09-19\"}"
```

```json
{
  "normalized": {
    "date": "2025-09-26",
    "time": "15:00",
    "tz": "Asia/Kolkata"
  },
  "normalization_confidence": 0.9
}
```

### Step 4 — appointment

```bash
curl -s -X POST http://localhost:3000/api/v1/appointments \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Book dentist next Friday at 3pm\",\"reference_date\":\"2025-09-19\"}"
```

```json
{
  "appointment": {
    "department": "Dentistry",
    "date": "2025-09-26",
    "time": "15:00",
    "tz": "Asia/Kolkata"
  },
  "status": "ok"
}
```

### Noisy OCR text

Step 1 keeps the recognized string. It does not invent a cleaner sentence. Step 2 repairs only unambiguous OCR tokens, so the published entity JSON is the same for both inputs: `nxt` becomes `next`, and `3 pm` becomes `3pm`. The pipeline response lists those edits in `ocr_repairs`. Step 3 then produces the same Dentistry appointment.

```bash
curl -s -X POST http://localhost:3000/api/v1/pipeline \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"book dentist nxt Friday @ 3 pm\",\"reference_date\":\"2025-09-19\"}"
```

The appointment block is the same Dentistry / 2025-09-26 / 15:00 result. `entities.date_phrase` is `"next Friday"` and `entities.time_phrase` is `"3pm"`, matching the assignment sample. `extraction.raw_text` stays `"book dentist nxt Friday @ 3 pm"`.

### Image

`samples/ocr-note.png` is a rendered note with that noisy line. Generate it with `examples/generate-sample-image.ps1` if it is missing, then:

```bash
curl -s -X POST http://localhost:3000/api/v1/pipeline \
  -F "reference_date=2025-09-19" \
  -F "image=@samples/ocr-note.png"
```

PowerShell:

```powershell
curl.exe -s -X POST http://localhost:3000/api/v1/pipeline -F "reference_date=2025-09-19" -F "image=@samples/ocr-note.png"
```

### Guardrail

```bash
curl -s -X POST http://localhost:3000/api/v1/appointments \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Book dentist Friday or Monday at 3pm\",\"reference_date\":\"2025-09-19\"}"
```

```json
{
  "status": "needs_clarification",
  "message": "Ambiguous date/time or department"
}
```

The same body is returned for:

- no date, no time, or no known department
- two departments, or two different clocks
- "Friday or Monday", "3pm or 4pm"
- a clock hour with no am/pm, or only "morning" / "evening"
- `01/02/2025`, because day/month and month/day are both possible
- a date in the past
- the word "doctor" with no specialty
- a model result that is grounded in the text but disagrees with the deterministic parse

`examples/demo.ps1` runs the full set against a server on port 3000. Import `examples/appointment-scheduler.postman_collection.json` for the same calls.

## Normalization rules

- Time zone is always `Asia/Kolkata`.
- `next Friday` / `coming Friday` / `nxt Friday` is the next Friday. If today is Friday, that is seven days later.
- `this Friday` is Friday of the current week. If that day has passed, the request needs clarification.
- A bare weekday means the soonest one, including today.
- `today`, `tomorrow`, `day after tomorrow`, and `in N days` are supported.
- `26 September 2025`, `September 26, 2025`, and `2025-09-26` are explicit.
- A numeric date such as `26/09/2025` is day/month/year when one side is greater than 12. If both are 12 or less, the service asks.
- A month and day with no year uses the reference year, or the next year if that day has already passed.
- `3pm`, `3 pm`, and `3 p.m.` are `15:00`. `15:00` stays `15:00`. `noon` is `12:00`. `midnight` is `00:00`.
- `1` through `12` with no am/pm is ambiguous. `13:00` through `23:59` is 24-hour time.
- Department aliases map to a canonical specialty. `dentist` and `dental` become `Dentistry`. Unknown words are not guessed.

## AI chain

1. **Propose.** The deterministic extractor returns source phrases. If a model is configured, it is asked for the same JSON and told not to invent fields.
2. **Ground.** Each phrase must appear in the OCR or typed text. `nxt` is accepted as `next` for this check. A model department that is not in the note is thrown away.
3. **Compare.** If both parses are grounded and they resolve to a different day, time, or specialty, the response is `needs_clarification` instead of a silent pick.
4. **Validate.** A second model call checks that the entities are supported. A flag is honored only when the source check agrees. Date and time values still come from the normalizer, not from the model.

The pipeline response includes the trace:

```json
{
  "ai": {
    "mode": "deterministic",
    "model": "deterministic-guard",
    "grounded": true,
    "accepted_model_entities": false,
    "notes": [
      "Propose step used the deterministic extractor.",
      "Validate step confirmed every phrase appears in the source text."
    ]
  },
  "validation": {
    "grounded": true,
    "checks": [
      "date_phrase_in_source",
      "time_phrase_in_source",
      "department_in_source",
      "date_matches_phrase",
      "time_matches_phrase",
      "department_is_canonical",
      "timezone_is_asia_kolkata",
      "appointment_matches_normalization"
    ]
  }
}
```

## Project layout

```text
src/http            Express routes and request parsing
src/ocr             Tesseract worker
src/ai              Prompts and OpenAI-compatible client
src/scheduling      Extract, normalize, validate, pipeline
tests               Schema, guardrail, OCR, and model-rejection tests
examples            curl script and Postman collection
samples             Rendered note used for the OCR demo
```

## Recording the demo

1. `npm start`
2. Open `http://localhost:3000` so the endpoint list is visible.
3. Run `examples/demo.ps1`, or the curl commands above.
4. Show, in order: the clean sample appointment, the noisy sentence, the image upload, and one `needs_clarification` response.
5. Optionally set `OPENAI_API_KEY` and call `/api/v1/pipeline` again. The appointment JSON stays the same when the model agrees. The `ai.mode` field changes to `llm`.

## Assumptions

- This schedules a request. It does not confirm a slot, diagnose anything, or store patient data.
- "Next Friday" means the upcoming Friday, not "Friday of the week after next". The assignment resolves the phrase to one date, so the service does too, and documents the rule.
- Clinical aliases cover common outpatient specialties. Anything outside that list needs a clearer department instead of a guess.
- Entity confidence is `0.85` when date, time, and department are all found, including after an unambiguous OCR repair. Typed text uses extraction confidence `0.9`. Image confidence comes from Tesseract.
