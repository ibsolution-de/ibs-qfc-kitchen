

import { Project, Employee, QuarterData, Assignment, PlanVersion, Customer, Absence, PublicHoliday, StrategicGoal, NorthStarMetric, OneOnOneSession } from './types';
import { eachDayOfInterval, format, getDay, isWeekend, getISOWeek } from 'date-fns';

export const PASTEL_VARIANTS = {
  blue: { bg: 'bg-pastel-blue', text: 'text-pastel-blueText', border: 'border-blue-200' },
  green: { bg: 'bg-pastel-green', text: 'text-pastel-greenText', border: 'border-green-200' },
  purple: { bg: 'bg-pastel-purple', text: 'text-pastel-purpleText', border: 'border-purple-200' },
  orange: { bg: 'bg-pastel-orange', text: 'text-pastel-orangeText', border: 'border-orange-200' },
  pink: { bg: 'bg-pastel-pink', text: 'text-pastel-pinkText', border: 'border-pink-200' },
  gray: { bg: 'bg-pastel-gray', text: 'text-pastel-grayText', border: 'border-gray-200' },
};

// MOCK 1:1 SESSIONS
export const MOCK_1ON1S: OneOnOneSession[] = [
    {
        id: '1o1_1',
        employeeId: 'e2',
        date: '2026-02-01T10:00:00Z',
        status: 'completed',
        sentiment: 'great',
        notes: 'Max is happy with the backend progress. Wants to look into Go for the new microservice.',
        commitments: ['Provide Go learning resources', 'Schedule architecture review'],
        agenda: ['Project Status', 'Tech Stack Discussion', 'Feedback']
    },
    {
        id: '1o1_2',
        employeeId: 'e2',
        date: '2026-03-01T10:00:00Z',
        status: 'scheduled',
        sentiment: 'okay',
        notes: '',
        commitments: [], // Will be populated from previous
        agenda: []
    },
    {
        id: '1o1_3',
        employeeId: 'e3',
        date: '2026-02-15T14:00:00Z',
        status: 'completed',
        sentiment: 'stressful',
        notes: 'Dana feels overwhelmed by the design changes requests from the client. Needs a shield.',
        commitments: ['Talk to client about scope creep', 'Reduce sprint load'],
        agenda: ['Workload', 'Client Communication']
    },
    {
        id: '1o1_4',
        employeeId: 'e3',
        date: '2026-03-15T14:00:00Z',
        status: 'scheduled',
        sentiment: 'unknown',
        notes: '',
        commitments: [],
        agenda: []
    }
];

// MOCK NORTH STAR METRICS
export const MOCK_NORTH_STARS: NorthStarMetric[] = [
    { id: 'ns1', name: 'Revenue Growth', description: 'Direct contribution to top-line growth', color: '#10b981' }, // Emerald
    { id: 'ns2', name: 'Customer Satisfaction', description: 'NPS and Retention drivers', color: '#3b82f6' }, // Blue
    { id: 'ns3', name: 'Operational Excellence', description: 'Internal efficiency and tooling', color: '#f59e0b' }, // Amber
    { id: 'ns4', name: 'Maintenance & Keep-the-lights-on', description: 'Required updates and support', color: '#64748b' } // Slate
];

// MOCK STRATEGIC GOALS (Balanced Scorecard)
export const MOCK_GOALS: StrategicGoal[] = [
    { id: 'sg1', title: 'Increase Digital Revenue by 20%', perspective: 'financial', linkedProjectIds: ['p1', 'p6'] },
    { id: 'sg2', title: 'Reduce Ops Cost by 15%', perspective: 'financial', linkedProjectIds: ['p2', 'p7'] },
    { id: 'sg3', title: 'Achieve NPS > 60', perspective: 'customer', linkedProjectIds: ['p3', 'p10'] },
    { id: 'sg4', title: 'Enter Public Sector Market', perspective: 'customer', linkedProjectIds: ['p13'] },
    { id: 'sg5', title: 'Automate Deployment Pipeline', perspective: 'internal', linkedProjectIds: ['p2', 'p5'] },
    { id: 'sg6', title: 'AI Capability Build-up', perspective: 'learning', linkedProjectIds: ['p8', 'p4'] },
];

export const MOCK_PROJECTS: Project[] = [
  // Active Projects
  { 
    id: 'p1', name: 'Energy Mgmt System', client: 'MAN', color: 'blue', status: 'active', budget: '50k', 
    startDate: '2025-06-01', endDate: '2026-03-31', volume: 80, topic: 'Sustainability', notes: 'Core project for Q1', isCritical: true, hourlyRate: 110,
    milestones: [
        { id: 'm1', name: 'MVP Release', date: '2025-12-15', phase: 'deployment' },
        { id: 'm2', name: 'Final Handover', date: '2026-03-30', phase: 'deployment' }
    ],
    health: 'good',
    northStarMetricId: 'ns1'
  },
  { 
    id: 'p2', name: 'Internal QFC App', client: 'IBs', color: 'purple', status: 'active', budget: '5k', 
    startDate: '2025-11-01', endDate: '2026-05-31', volume: 20, topic: 'Internal Tooling', notes: 'MVP phase', hourlyRate: 0,
    milestones: [
        { id: 'm3', name: 'Internal Demo', date: '2026-03-15', phase: 'testing' }
    ],
    health: 'good',
    northStarMetricId: 'ns3'
  },
  { 
    id: 'p3', name: 'ÜBA 2.0', client: 'Soka Bau', color: 'green', status: 'active', budget: '100k', 
    startDate: '2025-08-01', endDate: '2026-06-30', volume: 70, topic: 'Digitalization', notes: 'Long term contract', isCritical: true, hourlyRate: 125,
    milestones: [
        { id: 'm4', name: 'Phase 1 Go-Live', date: '2026-02-01', phase: 'deployment' },
        { id: 'm5', name: 'Phase 2 Kickoff', date: '2026-03-01', phase: 'planning' }
    ],
    health: 'warning',
    northStarMetricId: 'ns2'
  },
  { id: 'p4', name: 'Weiterbildung', client: 'Soka Bau', color: 'orange', status: 'active', budget: '80k', startDate: '2025-09-01', endDate: '2026-07-31', volume: 40, topic: 'Education', notes: 'Maintenance mode', hourlyRate: 125, health: 'good', northStarMetricId: 'ns4' },
  { 
    id: 'p5', name: 'Intralogistic Shuttle', client: 'Storck', color: 'pink', status: 'active', budget: '100k', 
    startDate: '2025-10-01', endDate: '2026-08-31', volume: 30, topic: 'Logistics', notes: 'Hardware integration required', isCritical: true, hourlyRate: 130,
    milestones: [
        { id: 'm6', name: 'Hardware Integration', date: '2026-03-20', phase: 'development' }
    ],
    health: 'critical',
    northStarMetricId: 'ns1'
  },
  
  // Opportunities
  { id: 'p6', name: 'Rampe 160', client: 'Storck', color: 'gray', status: 'opportunity', budget: '150k', startDate: '2026-03-01', endDate: '2026-10-31', volume: 60, topic: 'Logistics', notes: 'Follow up to Shuttle', hourlyRate: 130, probability: 80, northStarMetricId: 'ns1' },
  { id: 'p7', name: 'Cloud Migration Ph2', client: 'Allianz', color: 'blue', status: 'opportunity', budget: '120k', startDate: '2025-12-15', endDate: '2026-06-30', volume: 50, topic: 'Cloud Infra', notes: 'AWS Migration', hourlyRate: 140, probability: 60, northStarMetricId: 'ns3' },
  { id: 'p8', name: 'GenAI POC', client: 'BMW', color: 'purple', status: 'opportunity', budget: '45k', startDate: '2026-01-15', endDate: '2026-05-15', volume: 25, topic: 'AI/ML', notes: 'Innovation lab', hourlyRate: 150, probability: 40, northStarMetricId: 'ns1' },
  { id: 'p9', name: 'Security Audit', client: 'Commerzbank', color: 'gray', status: 'opportunity', budget: '30k', startDate: '2026-03-01', endDate: '2026-03-31', volume: 15, topic: 'Security', notes: 'Regulatory requirement', isCritical: true, hourlyRate: 160, probability: 90, northStarMetricId: 'ns4' },
  { id: 'p10', name: 'E-Shop Relaunch', client: 'DM Tech', color: 'pink', status: 'opportunity', budget: '90k', startDate: '2026-02-01', endDate: '2026-08-31', volume: 40, topic: 'E-Commerce', notes: 'High visibility', hourlyRate: 120, probability: 30, northStarMetricId: 'ns2' },
  { id: 'p11', name: 'HR Portal', client: 'Siemens', color: 'orange', status: 'opportunity', budget: '50k', startDate: '2026-01-01', endDate: '2026-06-30', volume: 30, topic: 'Internal', notes: '', hourlyRate: 115, probability: 50, northStarMetricId: 'ns3' },
  { id: 'p12', name: 'Data Lake Pilot', client: 'Lufthansa', color: 'green', status: 'opportunity', budget: '75k', startDate: '2026-01-01', endDate: '2026-05-31', volume: 35, topic: 'Data', notes: '', hourlyRate: 135, probability: 20, northStarMetricId: 'ns3' },
  { id: 'p13', name: 'Smart City Dashboard', client: 'Hamburg', color: 'blue', status: 'opportunity', budget: '200k', startDate: '2026-04-15', endDate: '2026-12-31', volume: 80, topic: 'Public Sector', notes: '', hourlyRate: 110, probability: 70, northStarMetricId: 'ns1' },
  { id: 'p14', name: 'FinTech App 2.0', client: 'N26', color: 'purple', status: 'opportunity', budget: '150k', startDate: '2026-05-01', endDate: '2026-11-30', volume: 70, topic: 'Finance', notes: '', hourlyRate: 145, probability: 45, northStarMetricId: 'ns1' },
];

export const MOCK_CUSTOMERS: Customer[] = [
    { id: 'c1', name: 'MAN', industry: 'Automotive', contactName: 'Hans Müller', email: 'hans.mueller@man.eu', logo: 'https://ui-avatars.com/api/?name=MAN&background=000&color=fff' },
    { id: 'c2', name: 'IBs', industry: 'Internal', contactName: 'Nazar Kulyk', email: 'admin@ibs.com', logo: 'https://ui-avatars.com/api/?name=IBs&background=666&color=fff' },
    { id: 'c3', name: 'Soka Bau', industry: 'Insurance', contactName: 'Petra Schmidt', email: 'p.schmidt@soka.de', logo: 'https://ui-avatars.com/api/?name=Soka&background=2E7D32&color=fff' },
    { id: 'c4', name: 'Storck', industry: 'Food', contactName: 'Klaus Klein', email: 'klaus@storck.com', logo: 'https://ui-avatars.com/api/?name=Storck&background=C2185B&color=fff' },
    { id: 'c5', name: 'Allianz', industry: 'Insurance', contactName: 'Maria Weber', email: 'm.weber@allianz.com', logo: 'https://ui-avatars.com/api/?name=Allianz&background=003399&color=fff' },
    { id: 'c6', name: 'BMW', industry: 'Automotive', contactName: 'Thomas Ruf', email: 't.ruf@bmw.de', logo: 'https://ui-avatars.com/api/?name=BMW&background=0099cc&color=fff' },
    { id: 'c7', name: 'Commerzbank', industry: 'Finance', contactName: 'Sarah Bank', email: 's.bank@commerz.de', logo: 'https://ui-avatars.com/api/?name=Coba&background=FFD700&color=000' },
    { id: 'c8', name: 'DM Tech', industry: 'Retail', contactName: 'Lisa Tech', email: 'lisa@dm.de', logo: 'https://ui-avatars.com/api/?name=DM&background=purple&color=fff' },
    { id: 'c9', name: 'Siemens', industry: 'Technology', contactName: 'Werner von Siemens', email: 'werner@siemens.com', logo: 'https://ui-avatars.com/api/?name=Siemens&background=009999&color=fff' },
    { id: 'c10', name: 'Lufthansa', industry: 'Aviation', contactName: 'Pilot Pete', email: 'pete@lufthansa.com', logo: 'https://ui-avatars.com/api/?name=LH&background=000080&color=fff' },
    { id: 'c11', name: 'Hamburg', industry: 'Public Sector', contactName: 'Olaf Scholz', email: 'olaf@hamburg.de', logo: 'https://ui-avatars.com/api/?name=HH&background=red&color=fff' },
    { id: 'c12', name: 'N26', industry: 'FinTech', contactName: 'Valentin Stalf', email: 'val@n26.com', logo: 'https://ui-avatars.com/api/?name=N26&background=teal&color=fff' },
];

export const MOCK_EMPLOYEES: Employee[] = [
  { 
    id: 'e1', 
    name: 'Nazar Kulyk', 
    role: 'PM, Architect, Dev', 
    avatar: 'https://ui-avatars.com/api/?name=Nazar+Kulyk&background=0D8ABC&color=fff',
    skills: ['React', 'Node.js', 'Architecture', 'Leadership', 'Cloud', 'SQL'],
    availability: 100,
    email: 'nazar@ibs.com',
    phone: '+49 123 456789',
    notes: 'Key resource for architecture decisions.',
    location: 'DE',
    type: 'internal',
    department: 'Software Engineering',
    competencies: [
        { skill: 'React', selfRating: 5, managerRating: 5 },
        { skill: 'Leadership', selfRating: 3, managerRating: 4 },
        { skill: 'Cloud', selfRating: 4, managerRating: 4 },
        { skill: 'DevOps', selfRating: 2, managerRating: 3 },
        { skill: 'Communication', selfRating: 5, managerRating: 4 },
    ],
    ikigaiItems: [
        { id: '1', text: 'Coding', zone: 'good' },
        { id: '2', text: 'Architecture', zone: 'ikigai' },
        { id: '3', text: 'Meetings', zone: 'needed' },
        { id: '4', text: 'Sales', zone: 'paid' },
    ]
  },
  { 
    id: 'e2', 
    name: 'Max Berreichsleiter', 
    role: 'Dev, DevOps, Backend', 
    avatar: 'https://ui-avatars.com/api/?name=Max+Berreichsleiter&background=E8F5E9&color=2E7D32',
    skills: ['Kubernetes', 'Go', 'Python', 'AWS', 'Terraform', 'Linux'],
    availability: 100,
    email: 'max@ibs.com',
    notes: 'Prefer backend tasks.',
    location: 'DE',
    type: 'internal',
    department: 'Software Engineering',
    competencies: [
        { skill: 'Go', selfRating: 4, managerRating: 4 },
        { skill: 'Kubernetes', selfRating: 5, managerRating: 5 },
        { skill: 'Frontend', selfRating: 1, managerRating: 2 },
        { skill: 'Teamwork', selfRating: 4, managerRating: 4 },
        { skill: 'Presentation', selfRating: 2, managerRating: 2 },
    ],
    ikigaiItems: [
        { id: '1', text: 'DevOps', zone: 'ikigai' },
        { id: '2', text: 'Frontend UI', zone: 'boreout' },
        { id: '3', text: 'Documentation', zone: 'needed' },
    ]
  },
  { 
    id: 'e3', 
    name: 'Dana Turocman', 
    role: 'Frontend, UX/UI, Design', 
    avatar: 'https://ui-avatars.com/api/?name=Dana+Turocman&background=F3E5F5&color=7B1FA2',
    skills: ['Figma', 'React', 'CSS', 'Accessibility', 'Design Systems'],
    availability: 80,
    email: 'dana@ibs.com',
    notes: 'Part-time on Fridays.',
    location: 'DE',
    type: 'internal',
    department: 'Software Engineering',
    competencies: [
        { skill: 'UI Design', selfRating: 5, managerRating: 5 },
        { skill: 'React', selfRating: 4, managerRating: 3 },
        { skill: 'CSS', selfRating: 5, managerRating: 5 },
        { skill: 'Backend', selfRating: 1, managerRating: 1 },
        { skill: 'Client Mgmt', selfRating: 2, managerRating: 3 },
    ],
    ikigaiItems: [
        { id: '1', text: 'Designing', zone: 'love' },
        { id: '2', text: 'Coding CSS', zone: 'good' },
        { id: '3', text: 'Client Workshops', zone: 'burnout' },
    ]
  },
  { 
    id: 'e4', 
    name: 'Test Freund', 
    role: 'Requirements, QA', 
    avatar: 'https://ui-avatars.com/api/?name=Test+Freund&background=FFF3E0&color=EF6C00',
    skills: ['Jira', 'Selenium', 'User Stories', 'QA', 'Agile'],
    availability: 100,
    email: 'test@ibs.com',
    location: 'US',
    type: 'internal',
    department: 'Software Engineering',
    competencies: [
        { skill: 'QA', selfRating: 5, managerRating: 4 },
        { skill: 'Coding', selfRating: 1, managerRating: 1 },
        { skill: 'Requirements', selfRating: 4, managerRating: 5 },
    ],
    ikigaiItems: []
  },
];

// Pool of employees for Smart Suggestions (simulated external directory)
export const MOCK_COMPANY_DIRECTORY: Employee[] = [
    {
        id: 'ext1',
        name: 'Sarah Data',
        role: 'Data Scientist',
        avatar: 'https://ui-avatars.com/api/?name=Sarah+Data&background=1e293b&color=fff',
        skills: ['Python', 'AI/ML', 'Data Lake', 'SQL'],
        availability: 100,
        email: 'sarah.data@ibs.com',
        location: 'DE',
        type: 'external',
        department: 'Data & Analytics'
    },
    {
        id: 'ext2',
        name: 'James Cloud',
        role: 'Cloud Architect',
        avatar: 'https://ui-avatars.com/api/?name=James+Cloud&background=3b82f6&color=fff',
        skills: ['AWS', 'Azure', 'Terraform', 'Security'],
        availability: 50,
        email: 'james.cloud@ibs.com',
        location: 'UK',
        type: 'external',
        department: 'Infrastructure'
    },
    {
        id: 'ext3',
        name: 'Elena Design',
        role: 'Product Designer',
        avatar: 'https://ui-avatars.com/api/?name=Elena+Design&background=ec4899&color=fff',
        skills: ['Figma', 'Prototyping', 'UX Research'],
        availability: 20,
        email: 'elena@ibs.com',
        location: 'DE',
        type: 'external',
        department: 'Product'
    }
];

// Helper to find projects
const getP = (id: string) => MOCK_PROJECTS.find(p => p.id === id)!;

// Helper function to generate mock assignments for Soka Bau request
const generateSokaBauAssignments = (startMonth: number = 2): Assignment[] => {
  const assignments: Assignment[] = [];
  const start = new Date(2026, startMonth, 1);
  const end = new Date(2026, 3, 30); // April 30, 2026
  const days = eachDayOfInterval({ start, end });

  days.forEach(d => {
    if (isWeekend(d)) return;
    const day = getDay(d); // 0=Sun, 1=Mon...
    const weekNum = getISOWeek(d);
    const dateStr = format(d, 'yyyy-MM-dd');

    // Max (e2) & Dana (e3): Full (Mon-Fri) on ÜBA 2.0 (p3)
    assignments.push({ id: `auto-e2-${dateStr}`, employeeId: 'e2', projectId: 'p3', date: dateStr, allocation: 1 });
    assignments.push({ id: `auto-e3-${dateStr}`, employeeId: 'e3', projectId: 'p3', date: dateStr, allocation: 1 });

    // Nazar (e1): 75% Target Capacity
    const isShortWeek = weekNum % 4 === 0;
    const workDays = isShortWeek ? 3 : 4; 
    
    if (day >= 1 && day <= workDays) {
      assignments.push({ id: `auto-e1-${dateStr}`, employeeId: 'e1', projectId: 'p3', date: dateStr, allocation: 1 });
    }
  });
  return assignments;
}

// Helper function to generate realistic past assignments for Jan/Feb 2026
const generatePastAssignments = (): Assignment[] => {
  const assignments: Assignment[] = [];
  const start = new Date(2026, 0, 1); // Jan 1, 2026
  const end = new Date(2026, 1, 28); // Feb 28, 2026
  const days = eachDayOfInterval({ start, end });

  days.forEach(d => {
    if (isWeekend(d)) return;
    const dateStr = format(d, 'yyyy-MM-dd');
    const day = getDay(d);

    // Nazar (e1): Split between MAN (p1) and Soka Bau (p3)
    if (day <= 3) {
      assignments.push({ id: `past-e1-p1-${dateStr}`, employeeId: 'e1', projectId: 'p1', date: dateStr, allocation: 1 });
    } else {
      assignments.push({ id: `past-e1-p3-${dateStr}`, employeeId: 'e1', projectId: 'p3', date: dateStr, allocation: 1 });
    }

    // Max (e2): Full on MAN (p1)
    assignments.push({ id: `past-e2-p1-${dateStr}`, employeeId: 'e2', projectId: 'p1', date: dateStr, allocation: 1 });

    // Dana (e3): Full on Soka Bau (p3)
    assignments.push({ id: `past-e3-p3-${dateStr}`, employeeId: 'e3', projectId: 'p3', date: dateStr, allocation: 1 });

    // Test Freund (e4): Support on Soka Bau (p3)
    if (day % 2 === 0) {
      assignments.push({ id: `past-e4-p3-${dateStr}`, employeeId: 'e4', projectId: 'p3', date: dateStr, allocation: 0.5 });
    }
  });
  return assignments;
}

// MOCK ABSENCES
const MOCK_ABSENCES: Absence[] = [
    { id: 'abs1', employeeId: 'e1', date: '2026-03-20', type: 'vacation', approved: true },
    { id: 'abs2', employeeId: 'e1', date: '2026-03-21', type: 'vacation', approved: true },
    { id: 'abs3', employeeId: 'e3', date: '2026-04-14', type: 'sick', approved: true },
];

// MOCK PUBLIC HOLIDAYS (DE - Germany for 2026 sample)
export const MOCK_HOLIDAYS: PublicHoliday[] = [
    { date: '2026-01-01', name: 'Neujahr', location: 'DE' },
    { date: '2026-04-03', name: 'Karfreitag', location: 'DE' },
    { date: '2026-04-06', name: 'Ostermontag', location: 'DE' },
    { date: '2026-05-01', name: 'Tag der Arbeit', location: 'DE' },
    { date: '2026-05-14', name: 'Christi Himmelfahrt', location: 'DE' },
    { date: '2026-05-25', name: 'Pfingstmontag', location: 'DE' },
    { date: '2026-10-03', name: 'Tag der Deutschen Einheit', location: 'DE' },
    { date: '2026-12-25', name: '1. Weihnachtstag', location: 'DE' },
    { date: '2026-12-26', name: '2. Weihnachtstag', location: 'DE' },
];

// --- Quarter Data (Truncated for brevity, logic remains same) ---
const Q2_2026_OUTLOOK_V1: QuarterData = {
    id: 'q2-2026-outlook-v1',
    name: 'Q2 2026',
    months: ['Apr', 'May', 'Jun'],
    totalCapacity: [80, 80, 80],
    runningProjects: [getP('p5')],
    mustWinOpportunities: [getP('p6'), getP('p13')],
    alternativeOpportunities: [],
    notes: 'Long term outlook: Pipeline building needed.'
};

const Q2_2026_OUTLOOK_V2: QuarterData = {
    id: 'q2-2026-outlook-v2',
    name: 'Q2 2026',
    months: ['Apr', 'May', 'Jun'],
    totalCapacity: [80, 80, 80],
    runningProjects: [getP('p5'), getP('p6')],
    mustWinOpportunities: [getP('p13')],
    alternativeOpportunities: [],
    notes: 'Stable utilization expected mid-year.'
};

const Q2_2026_FUTURE: QuarterData = {
    id: 'q2-2026-future',
    name: 'Q2 2026',
    months: ['Apr', 'May', 'Jun'],
    totalCapacity: [80, 80, 80],
    runningProjects: [],
    mustWinOpportunities: [getP('p13')],
    alternativeOpportunities: [],
    notes: 'CRITICAL: Severe capacity under-utilization projected. Sales pipeline dry after Smart City.'
};

// --- Version 1 ---
const FORECAST_Q1_2026_INITIAL: QuarterData[] = [
  {
    id: 'q1-2026-init',
    name: 'Q1 2026',
    months: ['Jan', 'Feb', 'Mar'],
    totalCapacity: [80, 80, 80],
    runningProjects: [getP('p2'), getP('p5'), getP('p3')],
    mustWinOpportunities: [getP('p6')],
    alternativeOpportunities: [getP('p10')],
    notes: 'Initial plan. Rampe 160 is critical for utilization.'
  },
  Q2_2026_OUTLOOK_V1,
  { ...Q2_2026_OUTLOOK_V1, id: 'q3-2026-outlook-v1', name: 'Q3 2026', months: ['Jul', 'Aug', 'Sep'] }
];
const ASSIGNMENTS_Q1_2026_INITIAL: Assignment[] = [
    { id: 'a1', employeeId: 'e1', projectId: 'p5', date: '2026-01-06', allocation: 1 },
    { id: 'a2', employeeId: 'e1', projectId: 'p5', date: '2026-01-07', allocation: 1 },
    { id: 'a3', employeeId: 'e2', projectId: 'p3', date: '2026-01-06', allocation: 1 },
    { id: 'a4', employeeId: 'e3', projectId: 'p2', date: '2026-01-08', allocation: 1 },
    ...generateSokaBauAssignments(2),
    ...generatePastAssignments()
];

// --- Version 2 ---
const FORECAST_Q1_2026_ADJUSTED: QuarterData[] = [
  {
    id: 'q1-2026-adj',
    name: 'Q1 2026',
    months: ['Jan', 'Feb', 'Mar'],
    totalCapacity: [80, 80, 80],
    runningProjects: [getP('p2'), getP('p5'), getP('p3'), getP('p6')],
    mustWinOpportunities: [],
    alternativeOpportunities: [getP('p10'), getP('p9')],
    notes: 'ADJUSTED: Rampe 160 won! Moved to active. Capacity is healthy.'
  },
  Q2_2026_OUTLOOK_V2,
  { ...Q2_2026_OUTLOOK_V2, id: 'q3-2026-outlook-v2', name: 'Q3 2026', months: ['Jul', 'Aug', 'Sep'] }
];
const ASSIGNMENTS_Q1_2026_ADJUSTED: Assignment[] = [
    ...ASSIGNMENTS_Q1_2026_INITIAL,
    { id: 'a5', employeeId: 'e1', projectId: 'p6', date: '2026-02-15', allocation: 0.5 },
    { id: 'a5b', employeeId: 'e1', projectId: 'p5', date: '2026-02-15', allocation: 0.5 },
    { id: 'a6', employeeId: 'e2', projectId: 'p6', date: '2026-02-15', allocation: 1 },
    { id: 'a7', employeeId: 'e4', projectId: 'p6', date: '2026-02-16', allocation: 1 },
];

// --- Version 3 ---
const FORECAST_Q2_2026: QuarterData[] = [
  FORECAST_Q1_2026_ADJUSTED[0]!,
  {
    id: 'q2-2026',
    name: 'Q2 2026',
    months: ['Apr', 'May', 'Jun'],
    totalCapacity: [80, 80, 80],
    runningProjects: [getP('p3'), getP('p5'), getP('p6')],
    mustWinOpportunities: [getP('p13')],
    alternativeOpportunities: [getP('p14')],
    notes: 'Planning for Q2. Focus on Smart City Dashboard acquisition.'
  },
  { ...Q2_2026_FUTURE, id: 'q3-2026-future', name: 'Q3 2026', months: ['Jul', 'Aug', 'Sep'] },
];
const ASSIGNMENTS_Q2_2026: Assignment[] = [
    ...ASSIGNMENTS_Q1_2026_ADJUSTED,
    { id: 'b1', employeeId: 'e1', projectId: 'p6', date: '2026-03-02', allocation: 1 },
    { id: 'b2', employeeId: 'e2', projectId: 'p3', date: '2026-03-03', allocation: 1 },
    { id: 'b3', employeeId: 'e3', projectId: 'p5', date: '2026-03-04', allocation: 1 },
    { id: 'b4', employeeId: 'e1', projectId: 'p3', date: '2026-03-05', allocation: 1 },
    { id: 'b5', employeeId: 'e2', projectId: 'p1', date: '2026-03-02', allocation: 1 },
    { id: 'b6', employeeId: 'e3', projectId: 'p1', date: '2026-03-03', allocation: 1 },
];

const ASSIGNMENTS_Q2_2026_CURRENT: Assignment[] = [
    ...generatePastAssignments(),
    ...generateSokaBauAssignments(3), // Start in April
    { id: 'curr-1', employeeId: 'e1', projectId: 'p1', date: '2026-03-02', allocation: 0.5 },
    { id: 'curr-2', employeeId: 'e2', projectId: 'p2', date: '2026-03-03', allocation: 0.5 },
];

export const MOCK_VERSIONS: PlanVersion[] = [
  {
    id: 'v1',
    name: 'Initial Q1 2026 Plan',
    createdAt: '2025-12-15T10:00:00Z',
    assignments: ASSIGNMENTS_Q1_2026_INITIAL,
    absences: MOCK_ABSENCES,
    forecastData: FORECAST_Q1_2026_INITIAL
  },
  {
    id: 'v2',
    name: 'Adjusted Q1 2026 Plan after QFC Call',
    createdAt: '2026-01-20T14:30:00Z',
    assignments: ASSIGNMENTS_Q1_2026_ADJUSTED,
    absences: MOCK_ABSENCES,
    forecastData: FORECAST_Q1_2026_ADJUSTED
  },
  {
    id: 'v3',
    name: 'Draft Q2 2026 Plan',
    createdAt: '2026-02-28T09:15:00Z',
    assignments: ASSIGNMENTS_Q2_2026,
    absences: MOCK_ABSENCES,
    forecastData: FORECAST_Q2_2026
  },
  {
    id: 'v4',
    name: 'Current Q2 2026 Plan (Reduced March Load)',
    createdAt: '2026-03-03T09:00:00Z',
    assignments: ASSIGNMENTS_Q2_2026_CURRENT,
    absences: MOCK_ABSENCES,
    forecastData: FORECAST_Q2_2026
  }
];