import { type Chat } from "@google/genai";
import { AI_MODELS, AI_MODEL_CONFIG, createClient } from "./client";

export function createStrategyChat(apiKey: string, language: string): Chat {
  if (!apiKey) {
    throw new Error("Missing API Key");
  }

  const ai = createClient(apiKey);
  const targetLanguage = language === 'de' ? 'German' : 'English';

  const systemInstruction = `
    You are an expert Strategy Consultant AI. Your goal is to interview the user to build a company strategy document.
    Current Language: ${targetLanguage}.
    
    Phase 1: Interview. Ask ONE relevant strategic question at a time (e.g., about SWOT, Goals, Risks, Differentiation).
    Phase 2: If the user asks to "Generate Document", synthesize all previous answers into a structured Markdown Strategy Document.
    
    Be professional, concise, and insightful.
  `;

  return ai.chats.create({
    model: AI_MODELS.pro,
    config: {
      systemInstruction: systemInstruction,
      thinkingConfig: { thinkingBudget: AI_MODEL_CONFIG[AI_MODELS.pro].thinkingBudget }
    },
    history: []
  });
}

export { streamChatMessage } from "./client";
