import { DateTime } from 'luxon';
import { canonicalDepartment, findDepartments, hasGenericDepartmentWord } from './departments';
import { selectDate, selectTime } from './datetime';
import { clarification, type InternalClarification } from './guardrail';
import { repairPhrase } from './text';

export type Entities = {
  date_phrase: string;
  time_phrase: string;
  department: string;
};

export type EntitiesResult = {
  entities: Entities;
  entities_confidence: number;
};

export type ParsedEntities = EntitiesResult & {
  repairs: string[];
};

export function extractEntities(rawText: string, ref: DateTime): ParsedEntities | InternalClarification {
  const departments = findDepartments(rawText);
  const canonicals = [...new Set(departments.map((hit) => hit.canonical))];
  if (canonicals.length > 1) return clarification('ambiguous_department');

  let department: { phrase: string; noisy: boolean };
  if (canonicals.length === 0) {
    return clarification(hasGenericDepartmentWord(rawText) ? 'ambiguous_department' : 'missing_department');
  } else {
    const best = [...departments].sort((a, b) => b.phrase.length - a.phrase.length)[0];
    department = { phrase: best.phrase, noisy: best.noisy };
  }

  const date = selectDate(rawText, ref);
  if (date.status === 'missing') return clarification('missing_date');
  if (date.status === 'ambiguous') return clarification('ambiguous_date');
  if (date.status === 'past') return clarification('past_date');

  const time = selectTime(rawText);
  if (time.status === 'missing') return clarification('missing_time');
  if (time.status === 'ambiguous') return clarification('ambiguous_time');

  const datePhrase = repairPhrase('date', date.phrase);
  const timePhrase = repairPhrase('time', time.phrase);
  const departmentPhrase = repairPhrase('department', department.phrase);
  const repairs = [datePhrase.repair, timePhrase.repair, departmentPhrase.repair].filter((item): item is string => Boolean(item));

  return {
    entities: {
      date_phrase: datePhrase.phrase,
      time_phrase: timePhrase.phrase,
      department: departmentPhrase.phrase,
    },
    entities_confidence: 0.85,
    repairs,
  };
}

export function departmentCanonical(phrase: string): string | null {
  return canonicalDepartment(phrase)?.canonical ?? null;
}
