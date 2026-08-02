import { describe, it, expect } from 'vitest';
import { create } from '@bufbuild/protobuf';

import {
  competencyFromProto,
  competencyToProto,
  ikigaiItemFromProto,
  ikigaiItemToProto,
  employeeFromProto,
  employeeToProto,
  customerFromProto,
  customerToProto,
  milestoneFromProto,
  milestoneToProto,
  projectFromProto,
  projectToProto,
  assignmentFromProto,
  assignmentToProto,
  absenceFromProto,
  absenceToProto,
  publicHolidayFromProto,
  publicHolidayToProto,
  quarterDataFromProto,
  quarterDataToProto,
  planVersionFromProto,
  planVersionToProto,
  strategicGoalFromProto,
  strategicGoalToProto,
  northStarMetricFromProto,
  northStarMetricToProto,
  oneOnOneSessionFromProto,
  oneOnOneSessionToProto,
  userFromProto,
  userToProto,
  userRolesToProto,
  adminUserFromProto,
  projectColorMapping,
  projectStatusMapping,
  pipelineStageMapping,
  projectHealthMapping,
  milestonePhaseMapping,
  employmentTypeMapping,
  ikigaiZoneMapping,
  absenceTypeMapping,
  strategyPerspectiveMapping,
  sentimentMapping,
  sessionStatusMapping,
  userRoleMapping,
} from './adapters';
import type { EnumMapping } from './adapters';
import { ProjectColor, ProjectStatus, PipelineStage, ProjectHealth, MilestonePhase } from './gen/qfc/portfolio/v1/portfolio_pb.js';
import { EmploymentType, IkigaiZone } from './gen/qfc/team/v1/team_pb.js';
import { AbsenceType } from './gen/qfc/planning/v1/planning_pb.js';
import { StrategyPerspective } from './gen/qfc/strategy/v1/strategy_pb.js';
import { Sentiment, SessionStatus } from './gen/qfc/growth/v1/growth_pb.js';
import { UserRole, UserSchema } from './gen/qfc/session/v1/session_pb.js';
import type {
  Employee,
  Customer,
  Project,
  Assignment,
  Absence,
  PublicHoliday,
  QuarterData,
  PlanVersion,
  StrategicGoal,
  NorthStarMetric,
  OneOnOneSession,
  User,
} from '../types';

// ---------------------------------------------------------------------------
// Fully-populated fixtures (every optional field set)
// ---------------------------------------------------------------------------

const fullEmployee: Employee = {
  id: 'e1',
  name: 'Ada Lovelace',
  role: 'Engineer',
  avatar: 'ada.png',
  skills: ['ts', 'rust'],
  availability: 80,
  email: 'ada@example.com',
  phone: '+49123456',
  notes: 'Great with algorithms',
  location: 'DE',
  teamId: 'team-1',
  type: 'internal',
  department: 'Engineering',
  competencies: [{ skill: 'ts', selfRating: 4, managerRating: 5 }],
  ikigaiItems: [{ id: 'ik1', text: 'Solving hard problems', zone: 'ikigai' }],
};

const minimalEmployee: Employee = {
  id: 'e2',
  name: 'Bare Bones',
  role: 'Intern',
  avatar: '',
  skills: [],
  availability: 100,
  location: 'US',
  type: 'external',
};

const fullCustomer: Customer = {
  id: 'c1',
  name: 'Acme Corp',
  logo: 'acme.png',
  industry: 'Manufacturing',
  contactName: 'Wile E. Coyote',
  email: 'wile@acme.example',
  notes: 'Handle with care',
};

const minimalCustomer: Customer = {
  id: 'c2',
  name: 'Bare Corp',
  logo: '',
  industry: 'Unknown',
  contactName: 'N/A',
  email: 'bare@example.com',
};

const fullProject: Project = {
  id: 'p1',
  name: 'Rocket Launch',
  client: 'Acme Corp',
  color: 'purple',
  status: 'active',
  volume: 120,
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  budget: '100000',
  topic: 'Space',
  notes: 'High priority',
  isCritical: true,
  hourlyRate: 120.5,
  milestones: [{ id: 'm1', name: 'Kickoff', date: '2026-01-05', phase: 'planning' }],
  probability: 90,
  stage: 'negotiation',
  health: 'warning',
  northStarMetricId: 'nsm-1',
};

const minimalProject: Project = {
  id: 'p2',
  name: 'Bare Project',
  client: 'Bare Corp',
  color: 'gray',
  status: 'opportunity',
};

const fullAssignment: Assignment = {
  id: 'a1',
  employeeId: 'e1',
  projectId: 'p1',
  date: '2026-01-06',
  allocation: 0.5,
};

const fullAbsence: Absence = {
  id: 'ab1',
  employeeId: 'e1',
  date: '2026-02-01',
  type: 'sick',
  approved: true,
};

const fullHoliday: PublicHoliday = {
  date: '2026-01-01',
  name: 'Neujahr',
  location: 'DE',
};

const fullQuarter: QuarterData = {
  id: 'q1',
  name: 'Q1 2026',
  months: ['January', 'February', 'March'],
  totalCapacity: [100, 90, 110],
  runningProjects: [fullProject],
  mustWinOpportunities: [minimalProject],
  alternativeOpportunities: [fullProject],
  notes: 'On track',
};

const emptyQuarter: QuarterData = {
  id: 'q2',
  name: 'Q2 2026',
  months: ['April', 'May', 'June'],
  totalCapacity: [0, 0, 0],
  runningProjects: [],
  mustWinOpportunities: [],
  alternativeOpportunities: [],
  notes: '',
};

const fullPlanVersion: PlanVersion = {
  id: 'v1',
  name: 'Baseline',
  description: 'The initial plan',
  createdAt: 1767225600000, // 2026-01-01T00:00:00Z
  assignments: [fullAssignment],
  absences: [fullAbsence],
  forecastData: [fullQuarter],
};

const minimalPlanVersion: PlanVersion = {
  id: 'v2',
  name: 'Bare',
  createdAt: 1767225600000, // 2026-01-01T00:00:00Z
  assignments: [],
  absences: [],
  forecastData: [],
};

const fullGoal: StrategicGoal = {
  id: 'g1',
  title: 'Grow revenue',
  description: 'Double revenue in 2 years',
  perspective: 'financial',
  linkedProjectIds: ['p1', 'p2'],
};

const minimalGoal: StrategicGoal = {
  id: 'g2',
  title: 'Bare goal',
  perspective: 'internal',
  linkedProjectIds: [],
};

const fullMetric: NorthStarMetric = {
  id: 'nsm-1',
  name: 'ARR',
  description: 'Annual Recurring Revenue',
  color: '#123456',
};

const fullSession: OneOnOneSession = {
  id: 's1',
  employeeId: 'e1',
  date: 1769940000000, // 2026-02-01T10:00:00Z
  status: 'completed',
  sentiment: 'great',
  notes: 'Great chat',
  commitments: ['Follow up on training'],
  agenda: ['Career', 'Feedback'],
};

const fullUser: User = {
  id: 'u1',
  name: 'Ada Lovelace',
  roles: ['pm', 'admin'],
  avatar: 'ada.png',
  employeeId: 'e1',
};

const minimalUser: User = {
  id: 'u2',
  name: 'Bare User',
  roles: ['employee'],
  avatar: '',
};

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('Competency', () => {
  it('round-trips', () => {
    const competency = { skill: 'ts', selfRating: 4, managerRating: 5 };
    expect(competencyFromProto(competencyToProto(competency))).toEqual(competency);
  });
});

describe('IkigaiItem', () => {
  it('round-trips', () => {
    const item = { id: 'ik1', text: 'Solving hard problems', zone: 'ikigai' as const };
    expect(ikigaiItemFromProto(ikigaiItemToProto(item))).toEqual(item);
  });
});

describe('Employee', () => {
  it('round-trips fully populated', () => {
    expect(employeeFromProto(employeeToProto(fullEmployee))).toEqual(fullEmployee);
  });

  it('round-trips with optionals absent', () => {
    const result = employeeFromProto(employeeToProto(minimalEmployee));
    expect(result).toEqual(minimalEmployee);
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.notes).toBeUndefined();
    expect(result.teamId).toBeUndefined();
    expect(result.department).toBeUndefined();
    expect(result.competencies).toBeUndefined();
    expect(result.ikigaiItems).toBeUndefined();
  });

  it('throws a descriptive error for EMPLOYMENT_TYPE_UNSPECIFIED', () => {
    const proto = employeeToProto(minimalEmployee);
    proto.employmentType = EmploymentType.UNSPECIFIED;
    expect(() => employeeFromProto(proto)).toThrow(/Employee e2: type/);
  });
});

describe('Customer', () => {
  it('round-trips fully populated', () => {
    expect(customerFromProto(customerToProto(fullCustomer))).toEqual(fullCustomer);
  });

  it('round-trips with optionals absent', () => {
    const result = customerFromProto(customerToProto(minimalCustomer));
    expect(result).toEqual(minimalCustomer);
    expect(result.notes).toBeUndefined();
  });
});

describe('Milestone', () => {
  it('round-trips', () => {
    const milestone = { id: 'm1', name: 'Kickoff', date: '2026-01-05', phase: 'planning' as const };
    expect(milestoneFromProto(milestoneToProto(milestone))).toEqual(milestone);
  });

  it('throws a descriptive error for MILESTONE_PHASE_UNSPECIFIED', () => {
    const proto = milestoneToProto({ id: 'm1', name: 'Kickoff', date: '2026-01-05', phase: 'planning' });
    proto.phase = MilestonePhase.UNSPECIFIED;
    expect(() => milestoneFromProto(proto)).toThrow(/Milestone m1: phase/);
  });
});

describe('Project', () => {
  it('round-trips fully populated', () => {
    expect(projectFromProto(projectToProto(fullProject))).toEqual(fullProject);
  });

  it('round-trips with optionals absent', () => {
    const result = projectFromProto(projectToProto(minimalProject));
    expect(result).toEqual(minimalProject);
    expect(result.volume).toBeUndefined();
    expect(result.startDate).toBeUndefined();
    expect(result.endDate).toBeUndefined();
    expect(result.budget).toBeUndefined();
    expect(result.topic).toBeUndefined();
    expect(result.notes).toBeUndefined();
    expect(result.isCritical).toBeUndefined();
    expect(result.hourlyRate).toBeUndefined();
    expect(result.milestones).toBeUndefined();
    expect(result.probability).toBeUndefined();
    expect(result.stage).toBeUndefined();
    expect(result.health).toBeUndefined();
    expect(result.northStarMetricId).toBeUndefined();
  });

  it('throws a descriptive error for PROJECT_COLOR_UNSPECIFIED', () => {
    const proto = projectToProto(minimalProject);
    proto.color = ProjectColor.UNSPECIFIED;
    expect(() => projectFromProto(proto)).toThrow(/Project p2: color/);
  });

  it('throws a descriptive error for PROJECT_STATUS_UNSPECIFIED', () => {
    const proto = projectToProto(minimalProject);
    proto.status = ProjectStatus.UNSPECIFIED;
    expect(() => projectFromProto(proto)).toThrow(/Project p2: status/);
  });

  it('maps an explicit PIPELINE_STAGE_UNSPECIFIED to undefined rather than throwing', () => {
    const proto = projectToProto(fullProject);
    proto.stage = PipelineStage.UNSPECIFIED;
    expect(projectFromProto(proto).stage).toBeUndefined();
  });

  it('maps an explicit PROJECT_HEALTH_UNSPECIFIED to undefined rather than throwing', () => {
    const proto = projectToProto(fullProject);
    proto.health = ProjectHealth.UNSPECIFIED;
    expect(projectFromProto(proto).health).toBeUndefined();
  });

  it('throws a descriptive error for a present but non-finite hourlyRate', () => {
    const proto = projectToProto(fullProject);
    proto.hourlyRate = 'not-a-number';
    expect(() => projectFromProto(proto)).toThrow(/Project p1: hourlyRate/);
  });
});

describe('Assignment', () => {
  it('round-trips and drops/re-attaches versionId', () => {
    const proto = assignmentToProto(fullAssignment, 'v1');
    expect(proto.versionId).toBe('v1');
    expect(assignmentFromProto(proto)).toEqual(fullAssignment);
  });
});

describe('Absence', () => {
  it('round-trips and drops/re-attaches versionId', () => {
    const proto = absenceToProto(fullAbsence, 'v1');
    expect(proto.versionId).toBe('v1');
    expect(absenceFromProto(proto)).toEqual(fullAbsence);
  });

  it('throws a descriptive error for ABSENCE_TYPE_UNSPECIFIED', () => {
    const proto = absenceToProto(fullAbsence, 'v1');
    proto.absenceType = AbsenceType.UNSPECIFIED;
    expect(() => absenceFromProto(proto)).toThrow(/Absence ab1: type/);
  });
});

describe('PublicHoliday', () => {
  it('round-trips', () => {
    expect(publicHolidayFromProto(publicHolidayToProto(fullHoliday))).toEqual(fullHoliday);
  });
});

describe('QuarterData', () => {
  const projectsById = new Map([
    [fullProject.id, fullProject],
    [minimalProject.id, minimalProject],
  ]);

  it('round-trips fully populated via id hydration', () => {
    const proto = quarterDataToProto(fullQuarter);
    const { quarter, missingProjectIds } = quarterDataFromProto(proto, projectsById);
    expect(quarter).toEqual(fullQuarter);
    expect(missingProjectIds).toEqual([]);
  });

  it('round-trips with empty id lists', () => {
    const proto = quarterDataToProto(emptyQuarter);
    const { quarter, missingProjectIds } = quarterDataFromProto(proto, projectsById);
    expect(quarter).toEqual(emptyQuarter);
    expect(missingProjectIds).toEqual([]);
  });

  it('skips and reports project ids missing from the map', () => {
    const proto = quarterDataToProto(fullQuarter);
    proto.runningProjectIds = [...proto.runningProjectIds, 'ghost-id'];

    const missesReported: string[] = [];
    const { quarter, missingProjectIds } = quarterDataFromProto(proto, projectsById, id => {
      missesReported.push(id);
    });

    expect(missingProjectIds).toEqual(['ghost-id']);
    expect(missesReported).toEqual(['ghost-id']);
    expect(quarter.runningProjects).toEqual(fullQuarter.runningProjects);
  });
});

describe('PlanVersion', () => {
  const projectsById = new Map([
    [fullProject.id, fullProject],
    [minimalProject.id, minimalProject],
  ]);

  it('round-trips fully populated', () => {
    const proto = planVersionToProto(fullPlanVersion);
    const { planVersion, missingProjectIds } = planVersionFromProto(proto, projectsById);
    expect(planVersion).toEqual(fullPlanVersion);
    expect(missingProjectIds).toEqual([]);
  });

  it('round-trips with optionals absent and empty collections', () => {
    const proto = planVersionToProto(minimalPlanVersion);
    const { planVersion, missingProjectIds } = planVersionFromProto(proto, projectsById);
    expect(planVersion).toEqual(minimalPlanVersion);
    expect(planVersion.description).toBeUndefined();
    expect(missingProjectIds).toEqual([]);
  });

  it('throws when meta is missing', () => {
    const proto = planVersionToProto(minimalPlanVersion);
    proto.meta = undefined;
    expect(() => planVersionFromProto(proto, projectsById)).toThrow(/PlanVersion: missing required meta/);
  });
});

describe('StrategicGoal', () => {
  it('round-trips fully populated', () => {
    expect(strategicGoalFromProto(strategicGoalToProto(fullGoal))).toEqual(fullGoal);
  });

  it('round-trips with optionals absent', () => {
    const result = strategicGoalFromProto(strategicGoalToProto(minimalGoal));
    expect(result).toEqual(minimalGoal);
    expect(result.description).toBeUndefined();
  });

  it('throws a descriptive error for STRATEGY_PERSPECTIVE_UNSPECIFIED', () => {
    const proto = strategicGoalToProto(minimalGoal);
    proto.perspective = StrategyPerspective.UNSPECIFIED;
    expect(() => strategicGoalFromProto(proto)).toThrow(/StrategicGoal g2: perspective/);
  });
});

describe('NorthStarMetric', () => {
  it('round-trips', () => {
    expect(northStarMetricFromProto(northStarMetricToProto(fullMetric))).toEqual(fullMetric);
  });
});

describe('OneOnOneSession', () => {
  it('round-trips', () => {
    expect(oneOnOneSessionFromProto(oneOnOneSessionToProto(fullSession))).toEqual(fullSession);
  });

  it('throws a descriptive error for SESSION_STATUS_UNSPECIFIED', () => {
    const proto = oneOnOneSessionToProto(fullSession);
    proto.status = SessionStatus.UNSPECIFIED;
    expect(() => oneOnOneSessionFromProto(proto)).toThrow(/OneOnOneSession s1: status/);
  });

  it('throws a descriptive error for SENTIMENT_UNSPECIFIED', () => {
    const proto = oneOnOneSessionToProto(fullSession);
    proto.sentiment = Sentiment.UNSPECIFIED;
    expect(() => oneOnOneSessionFromProto(proto)).toThrow(/OneOnOneSession s1: sentiment/);
  });
});

describe('User', () => {
  it('round-trips a multi-role user, carrying email through toProto explicitly', () => {
    const proto = userToProto(fullUser, 'ada@example.com');
    expect(proto.email).toBe('ada@example.com');
    expect(proto.roles).toEqual([UserRole.PM, UserRole.ADMIN]);
    expect(userFromProto(proto)).toEqual(fullUser);
  });

  it('round-trips a single-role user with optionals absent', () => {
    const proto = userToProto(minimalUser, 'bare@example.com');
    const result = userFromProto(proto);
    expect(result).toEqual(minimalUser);
    expect(result.employeeId).toBeUndefined();
  });

  it('throws a descriptive error for an empty roles array, same as an unspecified single value', () => {
    const proto = userToProto(minimalUser, 'bare@example.com');
    proto.roles = [];
    expect(() => userFromProto(proto)).toThrow(/User u2: roles is empty/);
  });

  it('throws a descriptive error when any role in the array is USER_ROLE_UNSPECIFIED', () => {
    const proto = userToProto(fullUser, 'ada@example.com');
    proto.roles = [UserRole.PM, UserRole.UNSPECIFIED];
    expect(() => userFromProto(proto)).toThrow(/User u1: roles/);
  });
});

describe('userRolesToProto', () => {
  it('maps a domain roles array to the corresponding proto enum values', () => {
    expect(userRolesToProto(['employee', 'pm', 'bl', 'sales', 'admin'])).toEqual([
      UserRole.EMPLOYEE,
      UserRole.PM,
      UserRole.BL,
      UserRole.SALES,
      UserRole.ADMIN,
    ]);
  });
});

describe('adminUserFromProto', () => {
  it('carries email through in addition to everything userFromProto produces', () => {
    const proto = create(UserSchema, {
      id: 'u3',
      name: 'Grace Hopper',
      roles: [UserRole.ADMIN],
      avatar: 'grace.png',
      email: 'grace@example.com',
    });
    expect(adminUserFromProto(proto)).toEqual({
      id: 'u3',
      name: 'Grace Hopper',
      roles: ['admin'],
      avatar: 'grace.png',
      employeeId: undefined,
      email: 'grace@example.com',
    });
  });
});

// ---------------------------------------------------------------------------
// Enum coverage: every value of every generated proto enum must round-trip.
// ---------------------------------------------------------------------------

/** Numeric enum values excluding the synthetic reverse-mapping keys TS adds to numeric enums. */
function numericEnumValues<E extends Record<string, number | string>>(protoEnum: E): number[] {
  return Object.values(protoEnum).filter((value): value is number => typeof value === 'number');
}

function expectFullEnumCoverage<P extends number, T extends string>(
  protoEnum: Record<string, number | string>,
  mapping: EnumMapping<P, T>,
  unspecifiedValue: number
): void {
  const values = numericEnumValues(protoEnum);
  expect(values).toContain(unspecifiedValue);

  for (const value of values) {
    if (value === unspecifiedValue) {
      expect(mapping.toTs.get(value as P)).toBeUndefined();
      continue;
    }
    const tsValue = mapping.toTs.get(value as P);
    expect(tsValue, `proto value ${value} has no domain mapping`).toBeDefined();
    expect(mapping.toProto.get(tsValue as T)).toBe(value);
  }
}

describe('enum coverage', () => {
  it('ProjectColor maps every value both ways', () => {
    expectFullEnumCoverage(ProjectColor, projectColorMapping, ProjectColor.UNSPECIFIED);
  });

  it('ProjectStatus maps every value both ways', () => {
    expectFullEnumCoverage(ProjectStatus, projectStatusMapping, ProjectStatus.UNSPECIFIED);
  });

  it('PipelineStage maps every value both ways', () => {
    expectFullEnumCoverage(PipelineStage, pipelineStageMapping, PipelineStage.UNSPECIFIED);
  });

  it('ProjectHealth maps every value both ways', () => {
    expectFullEnumCoverage(ProjectHealth, projectHealthMapping, ProjectHealth.UNSPECIFIED);
  });

  it('MilestonePhase maps every value both ways', () => {
    expectFullEnumCoverage(MilestonePhase, milestonePhaseMapping, MilestonePhase.UNSPECIFIED);
  });

  it('EmploymentType maps every value both ways', () => {
    expectFullEnumCoverage(EmploymentType, employmentTypeMapping, EmploymentType.UNSPECIFIED);
  });

  it('IkigaiZone maps every value both ways', () => {
    expectFullEnumCoverage(IkigaiZone, ikigaiZoneMapping, IkigaiZone.UNSPECIFIED);
  });

  it('AbsenceType maps every value both ways', () => {
    expectFullEnumCoverage(AbsenceType, absenceTypeMapping, AbsenceType.UNSPECIFIED);
  });

  it('StrategyPerspective maps every value both ways', () => {
    expectFullEnumCoverage(StrategyPerspective, strategyPerspectiveMapping, StrategyPerspective.UNSPECIFIED);
  });

  it('Sentiment maps every value both ways', () => {
    expectFullEnumCoverage(Sentiment, sentimentMapping, Sentiment.UNSPECIFIED);
  });

  it('SessionStatus maps every value both ways', () => {
    expectFullEnumCoverage(SessionStatus, sessionStatusMapping, SessionStatus.UNSPECIFIED);
  });

  it('UserRole maps every value both ways', () => {
    expectFullEnumCoverage(UserRole, userRoleMapping, UserRole.UNSPECIFIED);
  });
});
