

export interface Milestone {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  phase: 'planning' | 'development' | 'testing' | 'deployment';
}

export interface Project {
  id: string;
  name: string;
  client: string;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'gray';
  status: 'active' | 'opportunity' | 'completed' | 'on_hold';
  volume?: number; // Days
  startDate?: string;
  endDate?: string;
  budget?: string;
  // New fields
  topic?: string;
  notes?: string;
  isCritical?: boolean; // Critical for conflict detection
  hourlyRate?: number; // EUR per hour (default ~100)
  milestones?: Milestone[];
  probability?: number; // 0-100%
  stage?: 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'closed'; // Sales pipeline stage
  // Strategy Module Updates
  health?: 'good' | 'warning' | 'critical';
  northStarMetricId?: string;
}

export interface Competency {
  skill: string;
  selfRating: number; // 0-5
  managerRating: number; // 0-5
}

export type IkigaiZone = 'love' | 'good' | 'paid' | 'needed' | 'ikigai' | 'burnout' | 'boreout';

export interface IkigaiItem {
  id: string;
  text: string;
  zone: IkigaiZone;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  avatar: string;
  // New fields
  skills: string[];
  availability: number; // 0-100%
  email?: string;
  phone?: string;
  notes?: string;
  location: string; // e.g. 'DE', 'US', 'UK'
  teamId?: string; // For grouping
  // Team Management updates
  type: 'internal' | 'external' | 'future';
  department?: string;
  // Development Module
  competencies?: Competency[];
  ikigaiItems?: IkigaiItem[];
}

export interface Customer {
  id: string;
  name: string;
  logo: string;
  industry: string;
  contactName: string;
  email: string;
  notes?: string;
}

export interface Assignment {
  id: string;
  employeeId: string;
  projectId: string;
  date: string; // ISO YYYY-MM-DD
  allocation: number; // 0.1 to 1.0 (10% to 100%)
}

export interface Absence {
  id: string;
  employeeId: string;
  date: string; // ISO YYYY-MM-DD
  type: 'vacation' | 'sick' | 'training';
  approved: boolean;
}

export interface PublicHoliday {
  date: string; // ISO YYYY-MM-DD
  name: string;
  location: string; // 'ALL' or specific country code
}

export interface QuarterData {
  id: string;
  name: string; // e.g., "Q1 2024"
  months: string[]; // e.g., ["January", "February", "March"]
  totalCapacity: number[]; // Capacity for each month in days
  runningProjects: Project[];
  mustWinOpportunities: Project[];
  alternativeOpportunities: Project[];
  notes: string;
}

export interface PlanVersion {
  id: string;
  name: string;
  description?: string;
  createdAt: string; // ISO String
  assignments: Assignment[];
  absences: Absence[]; // Versioned absences
  forecastData: QuarterData[];
}

export type UserRole = 'employee' | 'pm' | 'bl' | 'sales';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  avatar: string;
  employeeId?: string; // Links to an employee record if applicable
}

// Strategy Module Types
export type StrategyPerspective = 'financial' | 'customer' | 'internal' | 'learning';

export interface StrategicGoal {
  id: string;
  title: string;
  description?: string;
  perspective: StrategyPerspective;
  linkedProjectIds: string[]; // Projects that contribute to this goal
}

export interface NorthStarMetric {
  id: string;
  name: string;
  description: string;
  color: string;
}

// 1:1 Feature Types
export type Sentiment = 'great' | 'okay' | 'stressful' | 'unknown';

export interface OneOnOneSession {
  id: string;
  employeeId: string;
  date: string; // ISO String
  status: 'scheduled' | 'completed';
  sentiment: Sentiment;
  notes: string;
  commitments: string[]; // "The Elephant Memory" - things promised
  agenda: string[];
}

export enum ViewMode {
  MY_OVERVIEW = 'MY_OVERVIEW',
  PLANNER = 'PLANNER',
  FORECAST = 'FORECAST',
  TEAM = 'TEAM',
  PROJECTS = 'PROJECTS',
  CUSTOMERS = 'CUSTOMERS',
  FINANCIALS = 'FINANCIALS',
  STRATEGY = 'STRATEGY',
  SALES = 'SALES'
}

export enum TimeScale {
  MONTH = 'MONTH',
  QUARTER = 'QUARTER'
}