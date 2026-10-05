# AI-Powered Appointment Scheduler

This is a small backend for the Plum SDE intern assignment, problem 1.

You give it a sentence or a photo of a note. It reads the note and returns a booking: which department, which date, and what time, in India time (`Asia/Kolkata`).

Example. Suppose today is Friday, 19 September 2025, and the note says:

```text
Book dentist next Friday at 3pm
```

The service answers:

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

`dentist` becomes Dentistry. `next Friday` becomes 26 September 2025. `3pm` becomes 15:00.

If the note is unclear, for example "Friday or Monday", it does not guess. It returns:

```json
{
  "status": "needs_clarification",
  "message": "Ambiguous date/time or department"
}
```

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. You should see a short list of the endpoints. Health check: http://localhost:3000/health

To run the same calls from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File examples/demo.ps1
```

Tests:

```bash
npm test
```

The first photo request downloads the English OCR model into `.cache/tesseract`. Later photo requests reuse it.

To show the API to someone outside your laptop:

```bash
ngrok http 3000
```

## What happens to a note

Four steps, in this order.

1. **Read the text.** A typed note is kept as you sent it. A photo is read with Tesseract OCR. The reply is `raw_text` and a confidence score.
2. **Find the three fields.** The date words, the time words, and the department. For the sample above those are `next Friday`, `3pm`, and `dentist`. Small OCR mistakes are fixed here: `nxt` is read as `next`, and `3 pm` is read as `3pm`. The original photo text is not rewritten.
3. **Turn words into a real date and time.** This is done in code, in `Asia/Kolkata`, not by a language model. `3pm` becomes `15:00`. `next Friday` is counted from `reference_date`, or from today if you omit that field.
4. **Return the booking.** `dentist` is stored as Dentistry. If a required field is missing or could mean two things, the reply is `needs_clarification` instead of a booking.

`POST /api/v1/pipeline` runs all four steps and also shows the checks. The other endpoints return one step each, in the shape the assignment asks for.

## Try the sample

`reference_date` is the "today" used for words like "next Friday". Use `2025-09-19` if you want the assignment's date, 26 September 2025. Leave it out to use the real current date in India.

### 1. Read the text

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

### 2. Find the fields

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

### 3. Convert to a calendar date

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

### 4. Final booking

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

PowerShell, if `curl` is awkward:

```powershell
$body = @{ text = "Book dentist next Friday at 3pm"; reference_date = "2025-09-19" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/v1/appointments -ContentType "application/json" -Body $body
```

The same requests are in `examples/curl.sh` and `examples/appointment-scheduler.postman_collection.json`.

## A messy note, and a photo

The assignment's OCR sample is:

```text
book dentist nxt Friday @ 3 pm
```

Step 1 returns that string as it was read. Step 2 still returns `next Friday`, `3pm`, and `dentist`. The booking is the same Dentistry appointment. `POST /api/v1/pipeline` also lists the repairs, for example `nxt Friday -> next Friday`.

A photo of that line is in `samples/ocr-note.png`.

```bash
curl -s -X POST http://localhost:3000/api/v1/pipeline \
  -F "reference_date=2025-09-19" \
  -F "image=@samples/ocr-note.png"
```

On Windows, use `curl.exe`, not the `curl` alias:

```powershell
curl.exe -s -X POST http://localhost:3000/api/v1/pipeline -F "reference_date=2025-09-19" -F "image=@samples/ocr-note.png"
```

Send either text or an image, not both. The file field can be named `image` or `file`.

## When it will not book

This body means the note is not safe to book:

```json
{
  "status": "needs_clarification",
  "message": "Ambiguous date/time or department"
}
```

That happens when:

- the date, the time, or the department is missing
- the note says two days, two times, or two departments
- the time is only "morning", or a number with no am/pm, like "at 3"
- the date is `01/02/2025`, because that could be 1 February or 2 January
- the date is already in the past
- it only says "doctor", with no specialty

Try it:

```bash
curl -s -X POST http://localhost:3000/api/v1/appointments \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Book dentist Friday or Monday at 3pm\",\"reference_date\":\"2025-09-19\"}"
```

Other failures are normal HTTP errors, with `{ "error": "..." }`:

| Situation | Status |
| --- | --- |
| Empty body, bad JSON, or a date that is not a real day | 400 |
| The upload is not an image | 415 |
| The image has no readable text | 422 |
| The image is larger than 5 MB | 413 |

## How dates and times are read

- The clock is always `Asia/Kolkata`.
- `next Friday` means the coming Friday. If today is already Friday, it means seven days later.
- `this Friday` means Friday of this week. If that Friday has passed, the service asks instead of booking the past.
- `today`, `tomorrow`, `day after tomorrow`, and `in 3 days` work.
- `26 September 2025`, `September 26, 2025`, and `2025-09-26` are exact dates.
- `26/09/2025` is read as day/month/year. If both numbers are 12 or less, it asks, because the order is unclear.
- `3pm`, `3 pm`, and `3 p.m.` all become `15:00`. `noon` is `12:00`. `midnight` is `00:00`.
- `dentist` and `dental` become Dentistry. A department that is not on the list is not guessed.

## Where a model fits

The date math does not go through a model. A model can suggest the words it sees, and a second call checks those words. A suggestion is kept only when the words are actually in the note. If the model names a department or a day that the note does not contain, that suggestion is thrown away. If the model and the code disagree on a real date, the service asks for clarification instead of picking one.

No API key is required. Without a key, the same two checks run on the built-in reader, so the sample result does not change between machines.

To use a model, copy `.env.example` to `.env` and set:

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

`OPENAI_BASE_URL` can be any OpenAI-compatible API. With a key, `/api/v1/pipeline` sets `ai.mode` to `llm`. The booking JSON stays the same when the model agrees with the note.

## Project files

```text
src/http         routes and request checks
src/ocr          photo text recognition
src/ai           prompts and the model client
src/scheduling   reading, dates, checks, and the pipeline
tests            sample JSON, guardrails, and a rejected model field
examples         curl, PowerShell demo, and Postman
samples          the note image used for OCR
```

## What this does not do

It does not confirm that a clinic has a free slot. It does not store the request. It does not give a medical opinion. It only turns a note into structured booking fields, or asks for a clearer note.
