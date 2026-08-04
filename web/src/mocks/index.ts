/**
 * Demo/fallback data, not backed by an API yet.
 *
 * These mocks exist because the corresponding backend endpoints do not
 * exist (yet). They MUST NOT be imported from `constants.ts` or any other
 * production data path - keep them quarantined here so they are easy to
 * delete once the real API lands.
 */
import { Employee, OneOnOneSession } from '../types';

// MOCK 1:1 SESSIONS
export const MOCK_1ON1S: OneOnOneSession[] = [
    {
        id: '1o1_1',
        employeeId: 'e2',
        date: 1769940000000, // 2026-02-01T10:00:00Z
        status: 'completed',
        sentiment: 'great',
        notes: 'Max is happy with the backend progress. Wants to look into Go for the new microservice.',
        commitments: ['Provide Go learning resources', 'Schedule architecture review'],
        agenda: ['Project Status', 'Tech Stack Discussion', 'Feedback']
    },
    {
        id: '1o1_2',
        employeeId: 'e2',
        date: 1772359200000, // 2026-03-01T10:00:00Z
        status: 'scheduled',
        sentiment: 'okay',
        notes: '',
        commitments: [], // Will be populated from previous
        agenda: []
    },
    {
        id: '1o1_3',
        employeeId: 'e3',
        date: 1771164000000, // 2026-02-15T14:00:00Z
        status: 'completed',
        sentiment: 'stressful',
        notes: 'Dana feels overwhelmed by the design changes requests from the client. Needs a shield.',
        commitments: ['Talk to client about scope creep', 'Reduce sprint load'],
        agenda: ['Workload', 'Client Communication']
    },
    {
        id: '1o1_4',
        employeeId: 'e3',
        date: 1773583200000, // 2026-03-15T14:00:00Z
        status: 'scheduled',
        sentiment: 'unknown',
        notes: '',
        commitments: [],
        agenda: []
    }
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
