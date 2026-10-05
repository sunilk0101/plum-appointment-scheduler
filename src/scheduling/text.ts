/** Collapse OCR noise so grounding checks compare meaning, not spelling. */
export function soften(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\bnxt\b/g, 'next')
    .replace(/\btmrw\b/g, 'tomorrow')
    .replace(/\btommorow\b/g, 'tomorrow')
    .replace(/\btommorrow\b/g, 'tomorrow')
    .replace(/@/g, ' at ')
    .replace(/(\d)\s*([ap])\.?\s*m\b/g, '$1$2m')
    .replace(/[.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function phraseInSource(source: string, phrase: string): boolean {
  const haystack = soften(source);
  const needle = soften(phrase);
  return needle.length > 0 && haystack.includes(needle);
}

/** Undo unambiguous OCR typos so entity phrases match the source meaning. */
export function repairPhrase(kind: 'date' | 'time' | 'department', phrase: string): { phrase: string; repair?: string } {
  const original = phrase.replace(/\s+/g, ' ').trim();
  let repaired = original;

  if (kind === 'date' || kind === 'department') {
    repaired = repaired
      .replace(/\bnxt\b/gi, 'next')
      .replace(/\btmrw\b/gi, 'tomorrow')
      .replace(/\btommorow\b/gi, 'tomorrow')
      .replace(/\btommorrow\b/gi, 'tomorrow')
      .replace(/\bdentlst\b/gi, 'dentist')
      .replace(/\bdentst\b/gi, 'dentist');
  }

  if (kind === 'time') {
    const compact = original.replace(/\./g, '').replace(/\s+/g, '');
    if (/^\d{1,2}(?::\d{2})?(?:am|pm)$/i.test(compact) || /^\d{1,2}:\d{2}$/.test(compact)) {
      repaired = compact.replace(/AM$/, 'am').replace(/PM$/, 'pm');
    }
  }

  if (repaired === original) return { phrase: original };
  return { phrase: repaired, repair: `${original} -> ${repaired}` };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
