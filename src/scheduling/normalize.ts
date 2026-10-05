import { DateTime } from 'luxon';
import { TZ } from '../config';
import { departmentCanonical } from './entities';
import { isPastDate, selectDate, selectTime } from './datetime';
import { clarification, type InternalClarification } from './guardrail';
import type { Entities } from './entities';

export type Normalization = {
  normalized: {
    date: string;
    time: string;
    tz: typeof TZ;
  };
  normalization_confidence: number;
};

export type AppointmentResult = {
  appointment: {
    department: string;
    date: string;
    time: string;
    tz: typeof TZ;
  };
  status: 'ok';
};

export function normalizeEntities(entities: Entities, ref: DateTime): Normalization | InternalClarification {
  const date = selectDate(entities.date_phrase, ref);
  if (date.status === 'missing') return clarification('missing_date');
  if (date.status === 'ambiguous') return clarification('ambiguous_date');
  if (date.status === 'past') return clarification('past_date');

  const time = selectTime(entities.time_phrase);
  if (time.status === 'missing') return clarification('missing_time');
  if (time.status === 'ambiguous') return clarification('ambiguous_time');

  if (!departmentCanonical(entities.department)) return clarification('ambiguous_department');
  if (isPastDate(date.iso, ref)) return clarification('past_date');

  return {
    normalized: {
      date: date.iso,
      time: time.time,
      tz: TZ,
    },
    normalization_confidence: date.specificity >= 2 ? 0.9 : 0.8,
  };
}

export function toAppointment(entities: Entities, normalization: Normalization): AppointmentResult | InternalClarification {
  const department = departmentCanonical(entities.department);
  if (!department) return clarification('ambiguous_department');
  return {
    appointment: {
      department,
      date: normalization.normalized.date,
      time: normalization.normalized.time,
      tz: TZ,
    },
    status: 'ok',
  };
}
