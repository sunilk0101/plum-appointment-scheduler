export const PROPOSE_ENTITIES_PROMPT = `You extract appointment fields from a scheduling note.
Return JSON only, with this shape:
{"date_phrase": string | null, "time_phrase": string | null, "department": string | null}

Rules:
- Copy phrases from the source text. Do not invent a department, date, or time.
- date_phrase is the date wording as written, such as "next Friday" or "26 September 2025".
- time_phrase is the clock wording as written, such as "3pm" or "15:00".
- department is the specialty wording as written, such as "dentist".
- If a field is missing or could mean more than one thing, use null for that field.
- Do not resolve dates to ISO format. Do not convert 3pm to 15:00.`;

export const VALIDATE_APPOINTMENT_PROMPT = `You validate a structured appointment against the source note.
Return JSON only:
{"supported": boolean, "issues": string[]}

Rules:
- supported is false when the appointment names a department, date, or time that the source does not state.
- Issues must name the unsupported field: "date_phrase", "time_phrase", or "department".
- Do not treat OCR typos (nxt, tmrw) as unsupported when the intended word is obvious.
- Do not add medical advice. This is scheduling data only.`;
