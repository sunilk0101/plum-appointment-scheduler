import { z } from 'zod';
import { readConfig } from '../config';
import { PROPOSE_ENTITIES_PROMPT, VALIDATE_APPOINTMENT_PROMPT } from './prompts';
import type { Entities } from '../scheduling/entities';
import type { Proposal } from '../scheduling/validate';

const proposalSchema = z.object({
  date_phrase: z.string().nullable(),
  time_phrase: z.string().nullable(),
  department: z.string().nullable(),
});

const verdictSchema = z.object({
  supported: z.boolean(),
  issues: z.array(z.string()).default([]),
});

export type Verdict = z.infer<typeof verdictSchema>;

export interface LanguageModel {
  readonly name: string;
  propose(source: string): Promise<Proposal>;
  validate(source: string, entities: Entities): Promise<Verdict>;
}

export function createLanguageModel(): LanguageModel | null {
  const config = readConfig();
  if (!config.openaiApiKey) return null;
  return new OpenAiCompatibleModel(config.openaiApiKey, config.openaiBaseUrl, config.openaiModel);
}

class OpenAiCompatibleModel implements LanguageModel {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    model: string,
  ) {
    this.name = model;
  }

  async propose(source: string): Promise<Proposal> {
    const raw = await this.complete(`${PROPOSE_ENTITIES_PROMPT}\n\nSource:\n${source}`);
    return proposalSchema.parse(parseModelJson(raw));
  }

  async validate(source: string, entities: Entities): Promise<Verdict> {
    const raw = await this.complete(
      `${VALIDATE_APPOINTMENT_PROMPT}\n\nSource:\n${source}\n\nEntities:\n${JSON.stringify(entities)}`,
    );
    return verdictSchema.parse(parseModelJson(raw));
  }

  private async complete(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.name,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You return JSON only. You never invent facts that are not in the user text.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Model request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('Model returned an empty response');
    return content;
  }
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}
