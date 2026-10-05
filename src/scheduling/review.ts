import { DateTime } from 'luxon';
import type { LanguageModel } from '../ai/model';
import type { EntitiesResult } from './entities';
import { clarification, type InternalClarification } from './guardrail';
import { groundProposal, proposalsConflict } from './validate';

export type ChainStep = {
  step: 'propose' | 'validate';
  provider: string;
  status: 'ok' | 'rejected';
  detail: string;
};

export type AiTrace = {
  mode: 'deterministic' | 'llm';
  model: string;
  grounded: boolean;
  accepted_model_entities: boolean;
  notes: string[];
  chain: ChainStep[];
};

export type Review = {
  entities: EntitiesResult;
  ai: AiTrace;
  clarification?: InternalClarification;
};

export async function reviewEntities(
  source: string,
  extracted: EntitiesResult,
  ref: DateTime,
  model: LanguageModel | null,
): Promise<Review> {
  const grounding = groundProposal(source, extracted.entities);
  if (!grounding.ok) {
    return {
      entities: extracted,
      clarification: clarification('ungrounded'),
      ai: {
        mode: model ? 'llm' : 'deterministic',
        model: model?.name ?? 'deterministic-guard',
        grounded: false,
        accepted_model_entities: false,
        notes: [`Rejected ungrounded fields: ${grounding.issues.join(', ')}`],
        chain: [
          {
            step: 'propose',
            provider: model?.name ?? 'deterministic-guard',
            status: 'rejected',
            detail: `Fields not present in the source: ${grounding.issues.join(', ')}.`,
          },
          {
            step: 'validate',
            provider: 'deterministic-guard',
            status: 'rejected',
            detail: 'Validation failed closed. No appointment was booked.',
          },
        ],
      },
    };
  }

  if (!model) {
    return {
      entities: extracted,
      ai: {
        mode: 'deterministic',
        model: 'deterministic-guard',
        grounded: true,
        accepted_model_entities: false,
        notes: [
          'Propose step used the deterministic extractor.',
          'Validate step confirmed every phrase appears in the source text.',
        ],
        chain: [
          {
            step: 'propose',
            provider: 'deterministic-guard',
            status: 'ok',
            detail: 'Extracted date_phrase, time_phrase, and department from the source.',
          },
          {
            step: 'validate',
            provider: 'deterministic-guard',
            status: 'ok',
            detail: 'Every phrase is present in the source text.',
          },
        ],
      },
    };
  }

  const notes: string[] = [];
  try {
    const proposal = await model.propose(source);
    const proposedGrounding = groundProposal(source, proposal);
    if (!proposedGrounding.ok) {
      notes.push(`Rejected model proposal. Missing or invented fields: ${proposedGrounding.issues.join(', ')}.`);
    } else if (proposalsConflict(extracted.entities, proposal, ref)) {
      notes.push('Model proposal is grounded but disagrees with the deterministic parse.');
      return {
        entities: extracted,
        clarification: clarification('model_conflict'),
        ai: {
          mode: 'llm',
          model: model.name,
          grounded: false,
          accepted_model_entities: false,
          notes,
          chain: [
            {
              step: 'propose',
              provider: model.name,
              status: 'rejected',
              detail: 'The model phrase is in the note, but it resolves to a different appointment.',
            },
            {
              step: 'validate',
              provider: model.name,
              status: 'rejected',
              detail: 'Validation stopped the booking instead of choosing between the two parses.',
            },
          ],
        },
      };
    } else {
      notes.push('Model proposal agrees with the deterministic parse. Kept the source phrases.');
    }

    const verdict = await model.validate(source, extracted.entities);
    if (!verdict.supported) {
      notes.push(
        `Model validation flagged ${verdict.issues.join(', ') || 'the parse'}. The source check still holds, so the deterministic appointment stands.`,
      );
    } else {
      notes.push('Model validation agreed the entities are supported by the source.');
    }

    const proposalRejected = notes.some((note) => note.startsWith('Rejected model proposal'));
    return {
      entities: extracted,
      ai: {
        mode: 'llm',
        model: model.name,
        grounded: true,
        accepted_model_entities: false,
        notes,
        chain: [
          {
            step: 'propose',
            provider: model.name,
            status: proposalRejected ? 'rejected' : 'ok',
            detail: proposalRejected
              ? 'Invented or missing model fields were discarded. Kept the source phrases.'
              : 'Model proposal agrees with the deterministic parse. Kept the source phrases.',
          },
          {
            step: 'validate',
            provider: model.name,
            status: 'ok',
            detail: verdict.supported
              ? 'Model validation agreed the entities are supported by the source.'
              : 'Model flag was not confirmed by the source check, so the deterministic appointment stands.',
          },
        ],
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown model error';
    notes.push(`Model call failed (${message}). Kept the deterministic parse.`);
    return {
      entities: extracted,
      ai: {
        mode: 'llm',
        model: model.name,
        grounded: true,
        accepted_model_entities: false,
        notes,
        chain: [
          {
            step: 'propose',
            provider: model.name,
            status: 'rejected',
            detail: 'Model call failed. The deterministic proposal was kept.',
          },
          {
            step: 'validate',
            provider: 'deterministic-guard',
            status: 'ok',
            detail: 'Source check passed for the deterministic entities.',
          },
        ],
      },
    };
  }
}
