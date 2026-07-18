import { type Chat } from "@google/genai";
import { Employee, Project, Assignment, Absence } from "../types";
import { AI_MODELS, AI_MODEL_CONFIG, createClient } from "./ai/client";

interface ChatContext {
  employees: Employee[];
  projects: Project[];
  assignments: Assignment[];
  absences: Absence[];
  currentDate: Date;
}

export type { ChatContext };

export function createResourceChat(
  context: ChatContext,
  apiKey: string,
  language: string
): Chat {
  if (!apiKey) {
    throw new Error("Missing API Key");
  }

  const ai = createClient(apiKey);
  const targetLanguage = language === 'de' ? 'German' : 'English';

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

  return ai.chats.create({
    model: AI_MODELS.pro,
    config: {
      systemInstruction: systemInstruction,
      thinkingConfig: { thinkingBudget: AI_MODEL_CONFIG[AI_MODELS.pro].thinkingBudget }
    },
    history: []
  });
}

export { streamChatMessage } from "./ai/client";
