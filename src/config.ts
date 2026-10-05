export const TZ = 'Asia/Kolkata' as const;

export function readConfig() {
  return {
    port: Number(process.env.PORT ?? 3000),
    tz: TZ,
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
    openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  };
}

export function aiEnabled(): boolean {
  return readConfig().openaiApiKey.length > 0;
}
