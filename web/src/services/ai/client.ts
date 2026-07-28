import { GoogleGenAI, type Chat, type GenerateContentConfig } from "@google/genai";

export const AI_MODELS = {
  pro: 'gemini-3-pro-preview',
  flash: 'gemini-2.5-flash'
} as const;

export type AIModelName = typeof AI_MODELS[keyof typeof AI_MODELS];

export const AI_MODEL_CONFIG: Record<AIModelName, { thinkingBudget?: number }> = {
  [AI_MODELS.pro]: { thinkingBudget: 32768 },
  [AI_MODELS.flash]: { thinkingBudget: undefined }
} as const;

export const AI_MODEL_FORECAST = AI_MODELS.pro;

export class AiNotConfiguredError extends Error {
  constructor(message = "AI API key is not configured") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

const LOCAL_STORAGE_KEY = 'gemini_api_key';

function resolveApiKey(explicitApiKey?: string): string | undefined {
  return (
    explicitApiKey ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_STORAGE_KEY) || undefined : undefined) ||
    (typeof process !== 'undefined' ? process.env.API_KEY : undefined)
  );
}

export function createClient(explicitApiKey?: string): GoogleGenAI {
  const apiKey = resolveApiKey(explicitApiKey);

  if (!apiKey) {
    throw new AiNotConfiguredError();
  }

  return new GoogleGenAI({ apiKey });
}

export function buildModelConfig(model: AIModelName): GenerateContentConfig {
  const budget = AI_MODEL_CONFIG[model].thinkingBudget;
  if (budget === undefined) {
    return {};
  }
  return { thinkingConfig: { thinkingBudget: budget } };
}

export async function streamChatMessage(
  chat: Chat,
  message: string,
  signal: AbortSignal,
  onChunk: (text: string) => void
): Promise<string> {
  const stream = await chat.sendMessageStream({
    message,
    config: { abortSignal: signal }
  });

  let fullText = '';
  for await (const chunk of stream) {
    const text = chunk.text ?? '';
    if (text) {
      fullText += text;
      onChunk(text);
    }
  }

  return fullText;
}
