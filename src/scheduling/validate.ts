import { DateTime } from 'luxon';
import { departmentCanonical, type Entities } from './entities';
import { selectDate, selectTime } from './datetime';
import { phraseInSource } from './text';
import type { AppointmentResult, Normalization } from './normalize';

export type Proposal = {
  date_phrase: string | null;
  time_phrase: string | null;
  department: string | null;
};

export function groundProposal(source: string, proposal: Proposal): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!proposal.date_phrase || !phraseInSource(source, proposal.date_phrase)) issues.push('date_phrase');
  if (!proposal.time_phrase || !phraseInSource(source, proposal.time_phrase)) issues.push('time_phrase');
  if (!proposal.department || !phraseInSource(source, proposal.department)) issues.push('department');
  return { ok: issues.length === 0, issues };
}

export function proposalsConflict(rules: Entities, proposal: Proposal, ref: DateTime): boolean {
  if (!proposal.date_phrase || !proposal.time_phrase || !proposal.department) return false;

  const ruleDate = selectDate(rules.date_phrase, ref);
  const modelDate = selectDate(proposal.date_phrase, ref);
  if (ruleDate.status === 'ok' && modelDate.status === 'ok' && ruleDate.iso !== modelDate.iso) {
    if (!sameSpan(rules.date_phrase, proposal.date_phrase)) return true;
  }

  const ruleTime = selectTime(rules.time_phrase);
  const modelTime = selectTime(proposal.time_phrase);
  if (ruleTime.status === 'ok' && modelTime.status === 'ok' && ruleTime.time !== modelTime.time) {
    if (!sameSpan(rules.time_phrase, proposal.time_phrase)) return true;
  }

  const ruleDepartment = departmentCanonical(rules.department);
  const modelDepartment = departmentCanonical(proposal.department);
  if (ruleDepartment && modelDepartment && ruleDepartment !== modelDepartment) {
    if (!sameSpan(rules.department, proposal.department)) return true;
  }

  return false;
}

export function validateAppointment(
  source: string | null,
  entities: Entities,
  normalization: Normalization,
  appointment: AppointmentResult,
  ref: DateTime,
): { ok: boolean; checks: string[] } {
  const checks: string[] = [];
  const failures: string[] = [];

  const record = (name: string, passed: boolean) => {
    if (passed) checks.push(name);
    else failures.push(name);
  };

  if (source !== null) {
    record('date_phrase_in_source', phraseInSource(source, entities.date_phrase));
    record('time_phrase_in_source', phraseInSource(source, entities.time_phrase));
    record('department_in_source', phraseInSource(source, entities.department));
  }

  const date = selectDate(entities.date_phrase, ref);
  record('date_matches_phrase', date.status === 'ok' && date.iso === normalization.normalized.date);
  const time = selectTime(entities.time_phrase);
  record('time_matches_phrase', time.status === 'ok' && time.time === normalization.normalized.time);
  record(
    'department_is_canonical',
    departmentCanonical(entities.department) === appointment.appointment.department,
  );
  record('timezone_is_asia_kolkata', appointment.appointment.tz === 'Asia/Kolkata');
  record(
    'appointment_matches_normalization',
    appointment.appointment.date === normalization.normalized.date &&
      appointment.appointment.time === normalization.normalized.time,
  );

  return { ok: failures.length === 0, checks };
}

function sameSpan(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a.includes(b) || b.includes(a);
}
