import { DateTime } from 'luxon';
import { TZ } from '../config';

export type DateResolution = { status: 'ok'; iso: string } | { status: 'ambiguous' } | { status: 'invalid' };

export type TimeResolution =
  | { status: 'ok'; time: string }
  | { status: 'ambiguous' }
  | { status: 'invalid' };

type DateHit = {
  phrase: string;
  start: number;
  end: number;
  specificity: number;
  resolve: (ref: DateTime) => DateResolution;
};

type TimeHit = {
  phrase: string;
  start: number;
  end: number;
  vague: string | null;
  resolve: () => TimeResolution;
};

const WEEKDAY =
  'sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat';

const MONTH =
  'january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 7,
  sun: 7,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export function referenceInstant(referenceDate?: string): DateTime {
  if (!referenceDate) return DateTime.now().setZone(TZ);
  const parsed = DateTime.fromISO(referenceDate, { zone: TZ });
  if (!parsed.isValid) {
    throw new Error(`Invalid reference_date: ${referenceDate}`);
  }
  return parsed.startOf('day');
}

export function findDateHits(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const source = text;

  collect(source, new RegExp(`\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'gi'), (match) => {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return hit(source, match, 4, () => explicitDate(year, month, day));
  }, hits);

  collect(source, new RegExp(`\\b(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{2,4})\\b`, 'g'), (match) => {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = expandYear(Number(match[3]));
    return hit(source, match, 4, () => numericDate(first, second, year));
  }, hits);

  collect(
    source,
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH})(?:\\s*,?\\s*(\\d{4}))?\\b`, 'gi'),
    (match) => {
      const day = Number(match[1]);
      const month = MONTH_INDEX[match[2].toLowerCase()];
      const year = match[3] ? Number(match[3]) : undefined;
      return hit(source, match, year ? 4 : 3, (ref) => calendarDate(ref, year, month, day));
    },
    hits,
  );

  collect(
    source,
    new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`, 'gi'),
    (match) => {
      const month = MONTH_INDEX[match[1].toLowerCase()];
      const day = Number(match[2]);
      const year = match[3] ? Number(match[3]) : undefined;
      return hit(source, match, year ? 4 : 3, (ref) => calendarDate(ref, year, month, day));
    },
    hits,
  );

  collect(source, /\bday after tomorrow\b/gi, (match) => {
    return hit(source, match, 2, (ref) => ok(ref.startOf('day').plus({ days: 2 })));
  }, hits);

  collect(source, /\b(tomorrow|tmrw|tommorow|tommorrow)\b/gi, (match) => {
    return hit(source, match, 2, (ref) => ok(ref.startOf('day').plus({ days: 1 })));
  }, hits);

  collect(source, /\btoday\b/gi, (match) => {
    return hit(source, match, 2, (ref) => ok(ref.startOf('day')));
  }, hits);

  collect(source, /\bin\s+(\d+)\s+days?\b/gi, (match) => {
    const days = Number(match[1]);
    return hit(source, match, 2, (ref) => ok(ref.startOf('day').plus({ days })));
  }, hits);

  collect(source, new RegExp(`\\b(next|this|coming|nxt)\\s+(${WEEKDAY})\\b`, 'gi'), (match) => {
    const qualifier = match[1].toLowerCase();
    const weekday = WEEKDAY_INDEX[match[2].toLowerCase()];
    return hit(source, match, 2, (ref) => {
      if (qualifier === 'this') return ok(thisWeekday(ref, weekday));
      return ok(upcomingWeekday(ref, weekday, false));
    });
  }, hits);

  collect(source, new RegExp(`\\b(${WEEKDAY})\\b`, 'gi'), (match) => {
    const weekday = WEEKDAY_INDEX[match[1].toLowerCase()];
    return hit(source, match, 1, (ref) => ok(upcomingWeekday(ref, weekday, true)));
  }, hits);

  return dropContained(hits);
}

export function findTimeHits(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const re =
    /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)|\d{1,2}:\d{2}|noon|midnight|morning|afternoon|evening|night)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const phrase = text.slice(match.index, match.index + match[0].length).replace(/\s+/g, ' ');
    const vague = /^(morning|afternoon|evening|night)$/i.test(phrase) ? phrase.toLowerCase() : null;
    hits.push({
      phrase,
      start: match.index,
      end: match.index + match[0].length,
      vague,
      resolve: () => parseClock(phrase),
    });
  }
  return hits;
}

export type SelectedDate =
  | { status: 'ok'; phrase: string; iso: string; specificity: number; noisy: boolean }
  | { status: 'missing' }
  | { status: 'ambiguous' }
  | { status: 'past' };

export function selectDate(text: string, ref: DateTime): SelectedDate {
  const hits = findDateHits(text);
  if (hits.length === 0) return { status: 'missing' };

  const resolved = hits.map((item) => ({ item, resolution: item.resolve(ref) }));
  if (resolved.some((item) => item.resolution.status === 'ambiguous')) return { status: 'ambiguous' };

  const okHits = resolved.filter(
    (item): item is { item: DateHit; resolution: { status: 'ok'; iso: string } } => item.resolution.status === 'ok',
  );
  if (okHits.length === 0) return { status: 'ambiguous' };

  const dates = new Set(okHits.map((item) => item.resolution.iso));
  if (dates.size > 1) return { status: 'ambiguous' };

  const iso = okHits[0].resolution.iso;
  const today = ref.startOf('day').toISODate();
  if (!today || iso < today) return { status: 'past' };

  const best = [...okHits].sort((a, b) => b.item.specificity - a.item.specificity || b.item.phrase.length - a.item.phrase.length)[0];
  return {
    status: 'ok',
    phrase: best.item.phrase,
    iso,
    specificity: best.item.specificity,
    noisy: /\b(nxt|tmrw|tommorow|tommorrow)\b/i.test(best.item.phrase),
  };
}

export type SelectedTime =
  | { status: 'ok'; phrase: string; time: string }
  | { status: 'missing' }
  | { status: 'ambiguous' };

export function selectTime(text: string): SelectedTime {
  const hits = findTimeHits(text);
  if (hits.length === 0) {
    if (/\b(?:at|@)\s*\d{1,2}\b(?!\s*(?::\d{2}|[ap]\.?m))/i.test(text)) {
      return { status: 'ambiguous' };
    }
    return { status: 'missing' };
  }

  const concrete = hits.filter((hit) => hit.vague === null);
  const vague = hits.filter((hit) => hit.vague !== null);

  if (concrete.length === 0) return { status: 'ambiguous' };

  const resolved = concrete.map((hit) => ({ hit, resolution: hit.resolve() }));
  if (resolved.some((item) => item.resolution.status !== 'ok')) return { status: 'ambiguous' };

  const times = new Set(
    resolved.map((item) => (item.resolution.status === 'ok' ? item.resolution.time : '')),
  );
  if (times.size !== 1) return { status: 'ambiguous' };

  const time = [...times][0];
  if (vague.some((hit) => hit.vague && !vagueAgrees(hit.vague, time))) return { status: 'ambiguous' };

  const phrase = resolved.sort((a, b) => b.hit.phrase.length - a.hit.phrase.length)[0].hit.phrase;
  return { status: 'ok', phrase, time };
}

export function isPastDate(iso: string, ref: DateTime): boolean {
  const today = ref.startOf('day').toISODate();
  return Boolean(today && iso < today);
}

function upcomingWeekday(ref: DateTime, weekday: number, includeToday: boolean): DateTime {
  let delta = (weekday - ref.weekday + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return ref.startOf('day').plus({ days: delta });
}

function thisWeekday(ref: DateTime, weekday: number): DateTime {
  const monday = ref.startOf('day').minus({ days: ref.weekday - 1 });
  return monday.plus({ days: weekday - 1 });
}

function explicitDate(year: number, month: number, day: number): DateResolution {
  const dt = DateTime.fromObject({ year, month, day }, { zone: TZ });
  if (!dt.isValid || dt.day !== day || dt.month !== month) return { status: 'invalid' };
  return { status: 'ok', iso: dt.toISODate()! };
}

function calendarDate(ref: DateTime, year: number | undefined, month: number, day: number): DateResolution {
  const resolvedYear = year ?? ref.year;
  let dt = DateTime.fromObject({ year: resolvedYear, month, day }, { zone: TZ });
  if (!dt.isValid || dt.day !== day) return { status: 'invalid' };
  if (year === undefined && dt.startOf('day') < ref.startOf('day')) {
    dt = dt.plus({ years: 1 });
    if (!dt.isValid || dt.day !== day) return { status: 'invalid' };
  }
  return { status: 'ok', iso: dt.toISODate()! };
}

function numericDate(first: number, second: number, year: number): DateResolution {
  if (first > 12 && second > 12) return { status: 'invalid' };
  if (first <= 12 && second <= 12) return { status: 'ambiguous' };
  const day = first > 12 ? first : second;
  const month = first > 12 ? second : first;
  return explicitDate(year, month, day);
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function parseClock(phrase: string): TimeResolution {
  const compact = phrase.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (compact === 'noon') return { status: 'ok', time: '12:00' };
  if (compact === 'midnight') return { status: 'ok', time: '00:00' };
  if (/^(morning|afternoon|evening|night)$/.test(compact)) return { status: 'ambiguous' };

  const match = compact.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return { status: 'invalid' };

  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3];
  if (minute > 59 || hour > 23) return { status: 'invalid' };

  if (meridiem) {
    if (hour < 1 || hour > 12) return { status: 'invalid' };
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else if (hour !== 12) hour += 12;
  } else if (hour >= 1 && hour <= 12) {
    return { status: 'ambiguous' };
  }

  return { status: 'ok', time: formatTime(hour, minute) };
}

function vagueAgrees(vague: string, time: string): boolean {
  const hour = Number(time.slice(0, 2));
  if (vague === 'morning') return hour >= 5 && hour < 12;
  if (vague === 'afternoon') return hour >= 12 && hour < 17;
  if (vague === 'evening') return hour >= 17 && hour < 21;
  return hour >= 21 || hour < 5;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function ok(dt: DateTime): DateResolution {
  const iso = dt.toISODate();
  return iso ? { status: 'ok', iso } : { status: 'invalid' };
}

function hit(
  source: string,
  match: RegExpExecArray,
  specificity: number,
  resolve: (ref: DateTime) => DateResolution,
): DateHit {
  return {
    phrase: source.slice(match.index, match.index + match[0].length).replace(/\s+/g, ' '),
    start: match.index,
    end: match.index + match[0].length,
    specificity,
    resolve,
  };
}

function collect(
  source: string,
  re: RegExp,
  build: (match: RegExpExecArray) => DateHit,
  into: DateHit[],
): void {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const pattern = new RegExp(re.source, flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    into.push(build(match));
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
}

function dropContained<T extends { start: number; end: number }>(items: T[]): T[] {
  return items.filter(
    (item) =>
      !items.some(
        (other) =>
          other !== item &&
          other.start <= item.start &&
          other.end >= item.end &&
          other.end - other.start > item.end - item.start,
      ),
  );
}
