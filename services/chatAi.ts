
import { GoogleGenAI } from "@google/genai";
import { Employee, Project, Assignment, Absence } from "../types";

interface ChatContext {
  employees: Employee[];
  projects: Project[];
  assignments: Assignment[];
  absences: Absence[];
  currentDate: Date;
}

export const chatWithResourceData = async (
  message: string,
  context: ChatContext,
  apiKey: string,
  language: string,
  history: { role: string, content: string }[] = []
): Promise<string> => {
  if (!apiKey && !process.env.API_KEY) {
    throw new Error("Missing API Key");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey || process.env.API_KEY });
  const targetLanguage = language === 'de' ? 'German' : 'English';

  // Simplify data
  const simplifiedEmployees = context.employees.map(e => ({
      id: e.id,
      name: e.name,
      role: e.role,
      skills: e.skills,
      availability: e.availability,
      location: e.location
  }));

  const simplifiedProjects = context.projects.map(p => ({
      id: p.id,
      name: p.name,
      client: p.client,
      status: p.status,
      start: p.startDate,
      end: p.endDate,
      budget: p.budget,
      volume: p.volume
  }));

  // Filter assignments for relevant timeframe (e.g., +/- 6 months from view date) to optimize context
  const viewDate = context.currentDate;
  const assignments = context.assignments.map(a => ({
      eId: a.employeeId,
      pId: a.projectId,
      d: a.date,
      a: a.allocation
  }));

  const contextData = {
    employees: simplifiedEmployees,
    projects: simplifiedProjects,
    assignments: assignments,
    absences: context.absences,
    currentViewDate: viewDate.toISOString().split('T')[0]
  };

  const systemInstruction = `
    You are "ResourceOps AI", a highly advanced resource planning assistant.
    
    Current System Language: ${targetLanguage}.
    
    Context Data (JSON):
    ${JSON.stringify(contextData)}

    Directives:
    1.  Analyze the data to answer questions about capacity, conflicts, overloads, and project timelines.
    2.  "Overload": Employee allocation > 1.0 (or > 8 hours) on a specific day.
    3.  "Conflict": Assignment overlapping with absence OR total allocation > 1.0.
    4.  "Capacity": Based on availability % and working days (Mon-Fri).
    5.  Be concise, precise, and data-driven. Use lists and bold text for clarity.
    6.  If data is missing, state "DATA_MISSING".
    7.  Adopt a professional, helpful assistant persona. Do not be robotic.
  `;

  const chatHistory = history.map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }]
  }));

  try {
    const chat = ai.chats.create({
      model: 'gemini-3-pro-preview',
      config: {
        systemInstruction: systemInstruction,
        thinkingConfig: { thinkingBudget: 32768 }
      },
      history: chatHistory
    });

    const result = await chat.sendMessage({
      message: message
    });

    return result.text;
  } catch (error) {
    console.error("AI Chat Error:", error);
    return "ERROR: CONNECTION_FAILED. System diagnostic recommended.";
  }
};
