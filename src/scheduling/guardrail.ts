export const CLARIFICATION_MESSAGE = 'Ambiguous date/time or department';

export type Clarification = {
  status: 'needs_clarification';
  message: typeof CLARIFICATION_MESSAGE;
};

export type FailureReason =
  | 'missing_date'
  | 'missing_time'
  | 'missing_department'
  | 'ambiguous_date'
  | 'ambiguous_time'
  | 'ambiguous_department'
  | 'past_date'
  | 'model_conflict'
  | 'ungrounded';

export type InternalClarification = Clarification & { reason: FailureReason };

export function clarification(reason: FailureReason): InternalClarification {
  return {
    status: 'needs_clarification',
    message: CLARIFICATION_MESSAGE,
    reason,
  };
}

export function toPublicClarification(result: InternalClarification): Clarification {
  return { status: result.status, message: result.message };
}

export function isClarification(value: object): value is InternalClarification {
  return 'status' in value && value.status === 'needs_clarification';
}
