import { QuarterData, Sentiment } from "../types";
import { AI_MODELS, AI_MODEL_FORECAST, buildModelConfig, createClient } from "./ai/client";

export { AI_MODEL_FORECAST };

export const generateForecastAnalysis = async (quarterData: QuarterData, apiKey: string, language: string): Promise<string> => {
  if (!apiKey) {
    throw new Error("Missing API Key");
  }

  const ai = createClient(apiKey);
  const targetLanguage = language === 'de' ? 'German' : 'English';

  const prompt = `
    You are an expert Project Manager Assistant and Resource Planner.
    Analyze the following quarterly forecast data for ${quarterData.name}.
    
    Data:
    - Total Monthly Capacities: ${quarterData.totalCapacity.join(', ')} (Days)
    - Running Projects: ${quarterData.runningProjects.map(p => `${p.name} (${p.volume}d)`).join(', ')}
    - Must-Win Opportunities: ${quarterData.mustWinOpportunities.map(p => `${p.name} (${p.volume}d)`).join(', ')}
    - Alternative Opportunities: ${quarterData.alternativeOpportunities.map(p => `${p.name} (${p.volume}d)`).join(', ')}
    - Current Notes: ${quarterData.notes}

    Please provide a strategic executive summary (max 200 words) in ${targetLanguage} language that includes:
    1. Overall capacity status (Under/Over/Optimal).
    2. Key risks regarding specific projects or resource gaps.
    3. Three specific recommendations for the Project Manager.
    
    Format the output in Markdown with bold headers.
    IMPORTANT: The response MUST be in ${targetLanguage}.
  `;

  try {
    const response = await ai.models.generateContent({
      model: AI_MODELS.pro,
      contents: prompt,
      config: buildModelConfig(AI_MODELS.pro)
    });
    return response.text ?? '';
  } catch (error) {
    console.error("AI Analysis Error:", error);
    throw new Error("Failed to generate analysis.");
  }
};

export const generateCoachingAgenda = async (sentiment: Sentiment, role: string, apiKey: string, language: string): Promise<string> => {
  if (!apiKey) throw new Error("Missing API Key");

  const ai = createClient(apiKey);
  const targetLanguage = language === 'de' ? 'German' : 'English';

  const prompt = `
        You are an expert Leadership Coach.
        Create a 1:1 meeting agenda for an employee with the role "${role}".
        Their reported pre-meeting sentiment is: "${sentiment}".

        If sentiment is 'stressful' or 'bad', focus on well-being, workload reduction, and blocker removal.
        If sentiment is 'great' or 'good', focus on growth, career goals, and positive reinforcement.
        If 'okay', balance between status updates and coaching.

        Output: A list of 3-4 bullet points for the agenda. 
        Language: ${targetLanguage}.
    `;

  const response = await ai.models.generateContent({
    model: AI_MODELS.flash,
    contents: prompt,
    config: buildModelConfig(AI_MODELS.flash)
  });

  return response.text ?? '';
};

export const extractActionItems = async (notes: string, apiKey: string, language: string): Promise<string[]> => {
  if (!apiKey) throw new Error("Missing API Key");

  const ai = createClient(apiKey);
  const targetLanguage = language === 'de' ? 'German' : 'English';

  const prompt = `
        Analyze the following meeting notes and extract concrete action items or commitments.
        Return ONLY a JSON array of strings. No markdown formatting.
        
        Notes:
        ${notes}

        Language of items: ${targetLanguage}.
    `;

  const response = await ai.models.generateContent({
    model: AI_MODELS.flash,
    contents: prompt,
    config: { ...buildModelConfig(AI_MODELS.flash), responseMimeType: 'application/json' }
  });

  try {
    let text = response.text ?? '';
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    return JSON.parse(text);
  } catch (e) {
    return ["Error extracting items: Invalid format returned by AI"];
  }
};

export type { AIModelName } from "./ai/client";
export { AI_MODELS, createClient, buildModelConfig } from './ai/client';
