/**
 * Protobuf <-> domain adapter layer.
 *
 * Translates between the generated Protobuf-ES messages under `./gen` and
 * the app-facing domain model in `../types`. Nothing outside this file
 * (and its future callers in the store layer) should ever import from
 * `./gen` directly - the rest of the app only ever sees `../types` shapes.
 *
 * Enum mapping notes:
 * - Protobuf-ES v2 represents proto3 enums as plain numbers; `types.ts` uses
 *   lowercase string unions. Every enum below has an explicit bidirectional
 *   lookup table (never a derived/lowercased string) so a newly added proto
 *   enum value that has no domain equivalent yet fails loudly instead of
 *   silently mismapping (see `*_UNSPECIFIED` handling below).
 * - `*_UNSPECIFIED` (proto value 0) maps to `undefined` for optional domain
 *   fields. For required domain fields there is no sensible default, so
 *   `requiredEnumFromProto` throws a descriptive `Error` naming the entity,
 *   its id, and the offending field.
 */

import { create } from '@bufbuild/protobuf';

import {
  EmployeeSchema,
  CompetencySchema,
  IkigaiItemSchema,
  EmploymentType,
  IkigaiZone,
  type Employee as EmployeeProto,
  type Competency as CompetencyProto,
  type IkigaiItem as IkigaiItemProto,
} from './gen/qfc/team/v1/team_pb.js';
import {
  ProjectSchema,
  MilestoneSchema,
  AccountSchema,
  ProjectColor,
  ProjectStatus,
  PipelineStage,
  ProjectHealth,
  MilestonePhase,
  AccountStatus,
  type Project as ProjectProto,
  type Milestone as MilestoneProto,
  type Account as AccountProto,
} from './gen/qfc/portfolio/v1/portfolio_pb.js';
import {
  CustomerSchema,
  type Customer as CustomerProto,
} from './gen/qfc/crm/v1/crm_pb.js';
import {
  AssignmentSchema,
  AbsenceSchema,
  PublicHolidaySchema,
  QuarterDataSchema,
  PlanVersionSchema,
  PlanVersionMetaSchema,
  AbsenceType,
  type Assignment as AssignmentProto,
  type Absence as AbsenceProto,
  type PublicHoliday as PublicHolidayProto,
  type QuarterData as QuarterDataProto,
  type PlanVersion as PlanVersionProto,
} from './gen/qfc/planning/v1/planning_pb.js';
import {
  StrategicGoalSchema,
  NorthStarMetricSchema,
  StrategyPerspective,
  type StrategicGoal as StrategicGoalProto,
  type NorthStarMetric as NorthStarMetricProto,
} from './gen/qfc/strategy/v1/strategy_pb.js';
import {
  OneOnOneSessionSchema,
  Sentiment,
  SessionStatus,
  type OneOnOneSession as OneOnOneSessionProto,
} from './gen/qfc/growth/v1/growth_pb.js';
import {
  UserSchema,
  UserRole,
  type User as UserProto,
} from './gen/qfc/session/v1/session_pb.js';

import type {
  Employee,
  Competency,
  IkigaiItem,
  Project,
  Milestone,
  Account,
  Customer,
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
// Generic enum lookup tables
// ---------------------------------------------------------------------------

/** Bidirectional lookup between a numeric proto enum and its domain string. */
export interface EnumMapping<P extends number, T extends string> {
  readonly toTs: ReadonlyMap<P, T>;
  readonly toProto: ReadonlyMap<T, P>;
}

function buildEnumMapping<P extends number, T extends string>(
  entries: ReadonlyArray<readonly [P, T]>
): EnumMapping<P, T> {
  return {
    toTs: new Map(entries),
    toProto: new Map(entries.map(([proto, ts]) => [ts, proto] as const)),
  };
}

/** For a required domain field: throws if the proto value has no mapping (e.g. `*_UNSPECIFIED`). */
function requiredEnumFromProto<P extends number, T extends string>(
  mapping: EnumMapping<P, T>,
  value: P,
  entityName: string,
  entityId: string,
  fieldName: string
): T {
  const mapped = mapping.toTs.get(value);
  if (mapped === undefined) {
    throw new Error(
      `${entityName} ${entityId}: ${fieldName} is unspecified or unrecognized (proto value ${value})`
    );
  }
  return mapped;
}

/**
 * For a required `repeated` domain field (e.g. `User.roles`): every element
 * must map like `requiredEnumFromProto`, and the array itself must not be
 * empty - proto3 `repeated` has no way to distinguish "absent" from "empty",
 * and an empty set of roles is a data error here, not a legitimate default.
 */
function requiredEnumArrayFromProto<P extends number, T extends string>(
  mapping: EnumMapping<P, T>,
  values: readonly P[],
  entityName: string,
  entityId: string,
  fieldName: string
): T[] {
  if (values.length === 0) {
    throw new Error(`${entityName} ${entityId}: ${fieldName} is empty (must hold at least one value)`);
  }
  return values.map(value => requiredEnumFromProto(mapping, value, entityName, entityId, fieldName));
}

/** For an optional domain field: `*_UNSPECIFIED` and unmapped values both become `undefined`. */
function optionalEnumFromProto<P extends number, T extends string>(
  mapping: EnumMapping<P, T>,
  value: P | undefined
): T | undefined {
  if (value === undefined) return undefined;
  return mapping.toTs.get(value);
}

function requiredEnumToProto<P extends number, T extends string>(
  mapping: EnumMapping<P, T>,
  value: T
): P {
  const mapped = mapping.toProto.get(value);
  if (mapped === undefined) {
    throw new Error(`Unrecognized domain enum value: ${value}`);
  }
  return mapped;
}

function optionalEnumToProto<P extends number, T extends string>(
  mapping: EnumMapping<P, T>,
  value: T | undefined
): P | undefined {
  if (value === undefined) return undefined;
  return mapping.toProto.get(value);
}

/** For a required `repeated` domain field: maps every element like `requiredEnumToProto`. */
function requiredEnumArrayToProto<P extends number, T extends string>(
  mapping: EnumMapping<P, T>,
  values: readonly T[]
): P[] {
  return values.map(value => requiredEnumToProto(mapping, value));
}

export const projectColorMapping: EnumMapping<ProjectColor, Project['color']> = buildEnumMapping([
  [ProjectColor.BLUE, 'blue'],
  [ProjectColor.GREEN, 'green'],
  [ProjectColor.PURPLE, 'purple'],
  [ProjectColor.ORANGE, 'orange'],
  [ProjectColor.PINK, 'pink'],
  [ProjectColor.GRAY, 'gray'],
]);

export const projectStatusMapping: EnumMapping<ProjectStatus, Project['status']> = buildEnumMapping([
  [ProjectStatus.ACTIVE, 'active'],
  [ProjectStatus.OPPORTUNITY, 'opportunity'],
  [ProjectStatus.COMPLETED, 'completed'],
  [ProjectStatus.ON_HOLD, 'on_hold'],
]);

export const pipelineStageMapping: EnumMapping<PipelineStage, NonNullable<Project['stage']>> =
  buildEnumMapping([
    [PipelineStage.LEAD, 'lead'],
    [PipelineStage.QUALIFIED, 'qualified'],
    [PipelineStage.PROPOSAL, 'proposal'],
    [PipelineStage.NEGOTIATION, 'negotiation'],
    [PipelineStage.CLOSED, 'closed'],
  ]);

export const projectHealthMapping: EnumMapping<ProjectHealth, NonNullable<Project['health']>> =
  buildEnumMapping([
    [ProjectHealth.GOOD, 'good'],
    [ProjectHealth.WARNING, 'warning'],
    [ProjectHealth.CRITICAL, 'critical'],
  ]);

export const milestonePhaseMapping: EnumMapping<MilestonePhase, Milestone['phase']> = buildEnumMapping([
  [MilestonePhase.PLANNING, 'planning'],
  [MilestonePhase.DEVELOPMENT, 'development'],
  [MilestonePhase.TESTING, 'testing'],
  [MilestonePhase.DEPLOYMENT, 'deployment'],
]);

export const accountStatusMapping: EnumMapping<AccountStatus, Account['status']> = buildEnumMapping([
  [AccountStatus.CONFIRMED, 'confirmed'],
  [AccountStatus.REQUESTED, 'requested'],
]);

export const employmentTypeMapping: EnumMapping<EmploymentType, Employee['type']> = buildEnumMapping([
  [EmploymentType.INTERNAL, 'internal'],
  [EmploymentType.EXTERNAL, 'external'],
  [EmploymentType.FUTURE, 'future'],
]);

export const ikigaiZoneMapping: EnumMapping<IkigaiZone, IkigaiItem['zone']> = buildEnumMapping([
  [IkigaiZone.LOVE, 'love'],
  [IkigaiZone.GOOD, 'good'],
  [IkigaiZone.PAID, 'paid'],
  [IkigaiZone.NEEDED, 'needed'],
  [IkigaiZone.IKIGAI, 'ikigai'],
  [IkigaiZone.BURNOUT, 'burnout'],
  [IkigaiZone.BOREOUT, 'boreout'],
]);

export const absenceTypeMapping: EnumMapping<AbsenceType, Absence['type']> = buildEnumMapping([
  [AbsenceType.VACATION, 'vacation'],
  [AbsenceType.SICK, 'sick'],
  [AbsenceType.TRAINING, 'training'],
]);

export const strategyPerspectiveMapping: EnumMapping<StrategyPerspective, StrategicGoal['perspective']> =
  buildEnumMapping([
    [StrategyPerspective.FINANCIAL, 'financial'],
    [StrategyPerspective.CUSTOMER, 'customer'],
    [StrategyPerspective.INTERNAL, 'internal'],
    [StrategyPerspective.LEARNING, 'learning'],
  ]);

export const sentimentMapping: EnumMapping<Sentiment, OneOnOneSession['sentiment']> = buildEnumMapping([
  [Sentiment.GREAT, 'great'],
  [Sentiment.OKAY, 'okay'],
  [Sentiment.STRESSFUL, 'stressful'],
  [Sentiment.UNKNOWN, 'unknown'],
]);

export const sessionStatusMapping: EnumMapping<SessionStatus, OneOnOneSession['status']> = buildEnumMapping([
  [SessionStatus.SCHEDULED, 'scheduled'],
  [SessionStatus.COMPLETED, 'completed'],
]);

export const userRoleMapping: EnumMapping<UserRole, User['roles'][number]> = buildEnumMapping([
  [UserRole.EMPLOYEE, 'employee'],
  [UserRole.PM, 'pm'],
  [UserRole.BL, 'bl'],
  [UserRole.SALES, 'sales'],
  [UserRole.ADMIN, 'admin'],
]);

// ---------------------------------------------------------------------------
// Employee (+ nested Competency, IkigaiItem)
// ---------------------------------------------------------------------------

export function competencyFromProto(competency: CompetencyProto): Competency {
  return {
    skill: competency.skill,
    selfRating: competency.selfRating,
    managerRating: competency.managerRating,
  };
}

export function competencyToProto(competency: Competency): CompetencyProto {
  return create(CompetencySchema, {
    skill: competency.skill,
    selfRating: competency.selfRating,
    managerRating: competency.managerRating,
  });
}

export function ikigaiItemFromProto(item: IkigaiItemProto): IkigaiItem {
  return {
    id: item.id,
    text: item.text,
    zone: requiredEnumFromProto(ikigaiZoneMapping, item.zone, 'IkigaiItem', item.id, 'zone'),
  };
}

export function ikigaiItemToProto(item: IkigaiItem): IkigaiItemProto {
  return create(IkigaiItemSchema, {
    id: item.id,
    text: item.text,
    zone: requiredEnumToProto(ikigaiZoneMapping, item.zone),
  });
}

/**
 * `competencies` / `ikigaiItems` are optional arrays in `types.ts` but proto3
 * `repeated` fields cannot represent "absent" - only "empty". An empty proto
 * array is therefore treated as `undefined` here so that a domain object
 * that omitted the field round-trips back to omitting it.
 */
export function employeeFromProto(employee: EmployeeProto): Employee {
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    avatar: employee.avatar,
    skills: [...employee.skills],
    availability: employee.availability,
    email: employee.email,
    phone: employee.phone,
    notes: employee.notes,
    location: employee.location,
    teamId: employee.teamId,
    type: requiredEnumFromProto(employmentTypeMapping, employee.employmentType, 'Employee', employee.id, 'type'),
    department: employee.department,
    competencies:
      employee.competencies.length > 0 ? employee.competencies.map(competencyFromProto) : undefined,
    ikigaiItems: employee.ikigaiItems.length > 0 ? employee.ikigaiItems.map(ikigaiItemFromProto) : undefined,
  };
}

export function employeeToProto(employee: Employee): EmployeeProto {
  return create(EmployeeSchema, {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    avatar: employee.avatar,
    skills: [...employee.skills],
    availability: employee.availability,
    email: employee.email,
    phone: employee.phone,
    notes: employee.notes,
    location: employee.location,
    teamId: employee.teamId,
    employmentType: requiredEnumToProto(employmentTypeMapping, employee.type),
    department: employee.department,
    competencies: (employee.competencies ?? []).map(competencyToProto),
    ikigaiItems: (employee.ikigaiItems ?? []).map(ikigaiItemToProto),
  });
}

export function employeesFromProto(employees: readonly EmployeeProto[]): Employee[] {
  return employees.map(employeeFromProto);
}

export function employeesToProto(employees: readonly Employee[]): EmployeeProto[] {
  return employees.map(employeeToProto);
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export function customerFromProto(customer: CustomerProto): Customer {
  return {
    id: customer.id,
    name: customer.name,
    logo: customer.logo,
    industry: customer.industry,
    contactName: customer.contactName,
    email: customer.email,
    notes: customer.notes,
  };
}

export function customerToProto(customer: Customer): CustomerProto {
  return create(CustomerSchema, {
    id: customer.id,
    name: customer.name,
    logo: customer.logo,
    industry: customer.industry,
    contactName: customer.contactName,
    email: customer.email,
    notes: customer.notes,
  });
}

export function customersFromProto(customers: readonly CustomerProto[]): Customer[] {
  return customers.map(customerFromProto);
}

export function customersToProto(customers: readonly Customer[]): CustomerProto[] {
  return customers.map(customerToProto);
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export function accountFromProto(account: AccountProto): Account {
  return {
    id: account.id,
    projectId: account.projectId,
    name: account.name,
    status: requiredEnumFromProto(accountStatusMapping, account.status, 'Account', account.id, 'status'),
    startDate: account.startDate,
    endDate: account.endDate,
    budget: account.budget,
  };
}

export function accountToProto(account: Account): AccountProto {
  return create(AccountSchema, {
    id: account.id,
    projectId: account.projectId,
    name: account.name,
    status: requiredEnumToProto(accountStatusMapping, account.status),
    startDate: account.startDate,
    endDate: account.endDate,
    budget: account.budget,
  });
}

// ---------------------------------------------------------------------------
// Project (+ nested Milestone, Account)
// ---------------------------------------------------------------------------

export function milestoneFromProto(milestone: MilestoneProto): Milestone {
  return {
    id: milestone.id,
    name: milestone.name,
    date: milestone.date,
    phase: requiredEnumFromProto(milestonePhaseMapping, milestone.phase, 'Milestone', milestone.id, 'phase'),
  };
}

export function milestoneToProto(milestone: Milestone): MilestoneProto {
  return create(MilestoneSchema, {
    id: milestone.id,
    name: milestone.name,
    date: milestone.date,
    phase: requiredEnumToProto(milestonePhaseMapping, milestone.phase),
  });
}

/**
 * The wire type is a decimal string; the domain keeps a number. A present
 * but non-finite value is a data error, not `undefined` - fail loud like
 * the enum tables instead of silently dropping the field.
 */
function hourlyRateFromProto(project: ProjectProto): number | undefined {
  if (project.hourlyRate === undefined) return undefined;
  const rate = Number(project.hourlyRate);
  if (!Number.isFinite(rate)) {
    throw new Error(`Project ${project.id}: hourlyRate is not a finite number (proto value '${project.hourlyRate}')`);
  }
  return rate;
}

/** `milestones` is optional in `types.ts`; see the note on `employeeFromProto` re: empty vs. absent. */
export function projectFromProto(project: ProjectProto): Project {
  return {
    id: project.id,
    name: project.name,
    client: project.client,
    color: requiredEnumFromProto(projectColorMapping, project.color, 'Project', project.id, 'color'),
    status: requiredEnumFromProto(projectStatusMapping, project.status, 'Project', project.id, 'status'),
    volume: project.volume,
    startDate: project.startDate,
    endDate: project.endDate,
    budget: project.budget,
    topic: project.topic,
    notes: project.notes,
    isCritical: project.isCritical,
    hourlyRate: hourlyRateFromProto(project),
    milestones: project.milestones.length > 0 ? project.milestones.map(milestoneFromProto) : undefined,
    accounts: project.accounts.map(accountFromProto),
    probability: project.probability,
    stage: optionalEnumFromProto(pipelineStageMapping, project.stage),
    health: optionalEnumFromProto(projectHealthMapping, project.health),
    northStarMetricId: project.northStarMetricId,
  };
}

export function projectToProto(project: Project): ProjectProto {
  return create(ProjectSchema, {
    id: project.id,
    name: project.name,
    client: project.client,
    color: requiredEnumToProto(projectColorMapping, project.color),
    status: requiredEnumToProto(projectStatusMapping, project.status),
    volume: project.volume,
    startDate: project.startDate,
    endDate: project.endDate,
    budget: project.budget,
    topic: project.topic,
    notes: project.notes,
    isCritical: project.isCritical,
    hourlyRate: project.hourlyRate === undefined ? undefined : String(project.hourlyRate),
    milestones: (project.milestones ?? []).map(milestoneToProto),
    // The server stores accounts in their own table and strips them from
    // the project blob before persisting; sending them on the wire is
    // harmless and keeps the domain round-trip complete.
    accounts: (project.accounts ?? []).map(accountToProto),
    probability: project.probability,
    stage: optionalEnumToProto(pipelineStageMapping, project.stage),
    health: optionalEnumToProto(projectHealthMapping, project.health),
    northStarMetricId: project.northStarMetricId,
  });
}

export function projectsFromProto(projects: readonly ProjectProto[]): Project[] {
  return projects.map(projectFromProto);
}

export function projectsToProto(projects: readonly Project[]): ProjectProto[] {
  return projects.map(projectToProto);
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/** `versionId` does not exist on the domain `Assignment` - it is scoped by the containing `PlanVersion`. */
export function assignmentFromProto(assignment: AssignmentProto): Assignment {
  return {
    id: assignment.id,
    employeeId: assignment.employeeId,
    projectId: assignment.projectId,
    date: assignment.date,
    allocation: assignment.allocation,
    accountId: assignment.accountId,
  };
}

export function assignmentToProto(assignment: Assignment, versionId: string): AssignmentProto {
  return create(AssignmentSchema, {
    id: assignment.id,
    versionId,
    employeeId: assignment.employeeId,
    projectId: assignment.projectId,
    date: assignment.date,
    allocation: assignment.allocation,
    accountId: assignment.accountId,
  });
}

export function assignmentsFromProto(assignments: readonly AssignmentProto[]): Assignment[] {
  return assignments.map(assignmentFromProto);
}

export function assignmentsToProto(assignments: readonly Assignment[], versionId: string): AssignmentProto[] {
  return assignments.map(assignment => assignmentToProto(assignment, versionId));
}

// ---------------------------------------------------------------------------
// Absence
// ---------------------------------------------------------------------------

/** `versionId` does not exist on the domain `Absence` - it is scoped by the containing `PlanVersion`. */
export function absenceFromProto(absence: AbsenceProto): Absence {
  return {
    id: absence.id,
    employeeId: absence.employeeId,
    date: absence.date,
    type: requiredEnumFromProto(absenceTypeMapping, absence.absenceType, 'Absence', absence.id, 'type'),
    approved: absence.approved,
  };
}

export function absenceToProto(absence: Absence, versionId: string): AbsenceProto {
  return create(AbsenceSchema, {
    id: absence.id,
    versionId,
    employeeId: absence.employeeId,
    date: absence.date,
    absenceType: requiredEnumToProto(absenceTypeMapping, absence.type),
    approved: absence.approved,
  });
}

export function absencesFromProto(absences: readonly AbsenceProto[]): Absence[] {
  return absences.map(absenceFromProto);
}

export function absencesToProto(absences: readonly Absence[], versionId: string): AbsenceProto[] {
  return absences.map(absence => absenceToProto(absence, versionId));
}

// ---------------------------------------------------------------------------
// PublicHoliday
// ---------------------------------------------------------------------------

export function publicHolidayFromProto(holiday: PublicHolidayProto): PublicHoliday {
  return {
    date: holiday.date,
    name: holiday.name,
    location: holiday.location,
  };
}

export function publicHolidayToProto(holiday: PublicHoliday): PublicHolidayProto {
  return create(PublicHolidaySchema, {
    date: holiday.date,
    name: holiday.name,
    location: holiday.location,
  });
}

export function publicHolidaysFromProto(holidays: readonly PublicHolidayProto[]): PublicHoliday[] {
  return holidays.map(publicHolidayFromProto);
}

export function publicHolidaysToProto(holidays: readonly PublicHoliday[]): PublicHolidayProto[] {
  return holidays.map(publicHolidayToProto);
}

// ---------------------------------------------------------------------------
// QuarterData
// ---------------------------------------------------------------------------

/** Which id list on `QuarterData` a missing project id was found in. */
export type QuarterProjectListName = 'runningProjects' | 'mustWinOpportunities' | 'alternativeOpportunities';

export interface QuarterDataFromProtoResult {
  quarter: QuarterData;
  /** Project ids referenced by the quarter but absent from `projectsById`; these were skipped, not thrown away silently. */
  missingProjectIds: string[];
}

/**
 * Hydrates `QuarterData`'s id lists (`runningProjectIds` etc.) into full
 * `Project` objects using `projectsById`. An id with no matching project is
 * skipped rather than crashing the whole conversion; every miss is reported
 * both via the returned `missingProjectIds` and the optional `onMissing`
 * callback.
 */
export function quarterDataFromProto(
  quarter: QuarterDataProto,
  projectsById: ReadonlyMap<string, Project>,
  onMissing?: (projectId: string, list: QuarterProjectListName) => void
): QuarterDataFromProtoResult {
  const missingProjectIds: string[] = [];

  function hydrate(ids: readonly string[], list: QuarterProjectListName): Project[] {
    const projects: Project[] = [];
    for (const id of ids) {
      const project = projectsById.get(id);
      if (project === undefined) {
        missingProjectIds.push(id);
        onMissing?.(id, list);
        continue;
      }
      projects.push(project);
    }
    return projects;
  }

  const domainQuarter: QuarterData = {
    id: quarter.id,
    name: quarter.name,
    months: [...quarter.months],
    totalCapacity: [...quarter.totalCapacity],
    runningProjects: hydrate(quarter.runningProjectIds, 'runningProjects'),
    mustWinOpportunities: hydrate(quarter.mustWinOpportunityIds, 'mustWinOpportunities'),
    alternativeOpportunities: hydrate(quarter.alternativeOpportunityIds, 'alternativeOpportunities'),
    notes: quarter.notes,
  };

  return { quarter: domainQuarter, missingProjectIds };
}

export function quarterDataToProto(quarter: QuarterData): QuarterDataProto {
  return create(QuarterDataSchema, {
    id: quarter.id,
    name: quarter.name,
    months: [...quarter.months],
    totalCapacity: [...quarter.totalCapacity],
    runningProjectIds: quarter.runningProjects.map(project => project.id),
    mustWinOpportunityIds: quarter.mustWinOpportunities.map(project => project.id),
    alternativeOpportunityIds: quarter.alternativeOpportunities.map(project => project.id),
    notes: quarter.notes,
  });
}

export interface QuarterDataListFromProtoResult {
  quarters: QuarterData[];
  missingProjectIds: string[];
}

export function quarterDataListFromProto(
  quarters: readonly QuarterDataProto[],
  projectsById: ReadonlyMap<string, Project>,
  onMissing?: (projectId: string, list: QuarterProjectListName) => void
): QuarterDataListFromProtoResult {
  const result: QuarterData[] = [];
  const missingProjectIds: string[] = [];
  for (const quarter of quarters) {
    const hydrated = quarterDataFromProto(quarter, projectsById, onMissing);
    result.push(hydrated.quarter);
    missingProjectIds.push(...hydrated.missingProjectIds);
  }
  return { quarters: result, missingProjectIds };
}

export function quarterDataListToProto(quarters: readonly QuarterData[]): QuarterDataProto[] {
  return quarters.map(quarterDataToProto);
}

// ---------------------------------------------------------------------------
// PlanVersion
// ---------------------------------------------------------------------------

export interface PlanVersionFromProtoResult {
  planVersion: PlanVersion;
  missingProjectIds: string[];
}

/**
 * Flattens the proto `PlanVersion` (`{ meta, assignments, absences, forecastData }`)
 * into the flat domain `PlanVersion`. Needs `projectsById` to hydrate the
 * nested `QuarterData` forecast entries (see `quarterDataFromProto`).
 */
export function planVersionFromProto(
  planVersion: PlanVersionProto,
  projectsById: ReadonlyMap<string, Project>,
  onMissingProject?: (projectId: string, list: QuarterProjectListName) => void
): PlanVersionFromProtoResult {
  if (planVersion.meta === undefined) {
    throw new Error('PlanVersion: missing required meta');
  }
  const meta = planVersion.meta;

  const { quarters: forecastData, missingProjectIds } = quarterDataListFromProto(
    planVersion.forecastData,
    projectsById,
    onMissingProject
  );

  return {
    planVersion: {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      createdAt: Number(meta.createdAtMillis),
      owner: meta.owner,
      ownerName: meta.ownerName,
      assignments: assignmentsFromProto(planVersion.assignments),
      absences: absencesFromProto(planVersion.absences),
      forecastData,
    },
    missingProjectIds,
  };
}

/** Unflattens the domain `PlanVersion` back into `{ meta, assignments, absences, forecastData }`. */
export function planVersionToProto(planVersion: PlanVersion): PlanVersionProto {
  return create(PlanVersionSchema, {
    meta: create(PlanVersionMetaSchema, {
      id: planVersion.id,
      name: planVersion.name,
      description: planVersion.description,
      createdAtMillis: BigInt(planVersion.createdAt),
      owner: planVersion.owner,
      ownerName: planVersion.ownerName,
    }),
    assignments: assignmentsToProto(planVersion.assignments, planVersion.id),
    absences: absencesToProto(planVersion.absences, planVersion.id),
    forecastData: quarterDataListToProto(planVersion.forecastData),
  });
}

export interface PlanVersionListFromProtoResult {
  planVersions: PlanVersion[];
  missingProjectIds: string[];
}

export function planVersionsFromProto(
  planVersions: readonly PlanVersionProto[],
  projectsById: ReadonlyMap<string, Project>,
  onMissingProject?: (projectId: string, list: QuarterProjectListName) => void
): PlanVersionListFromProtoResult {
  const result: PlanVersion[] = [];
  const missingProjectIds: string[] = [];
  for (const planVersion of planVersions) {
    const hydrated = planVersionFromProto(planVersion, projectsById, onMissingProject);
    result.push(hydrated.planVersion);
    missingProjectIds.push(...hydrated.missingProjectIds);
  }
  return { planVersions: result, missingProjectIds };
}

export function planVersionsToProto(planVersions: readonly PlanVersion[]): PlanVersionProto[] {
  return planVersions.map(planVersionToProto);
}

// ---------------------------------------------------------------------------
// StrategicGoal
// ---------------------------------------------------------------------------

export function strategicGoalFromProto(goal: StrategicGoalProto): StrategicGoal {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    perspective: requiredEnumFromProto(strategyPerspectiveMapping, goal.perspective, 'StrategicGoal', goal.id, 'perspective'),
    linkedProjectIds: [...goal.linkedProjectIds],
  };
}

export function strategicGoalToProto(goal: StrategicGoal): StrategicGoalProto {
  return create(StrategicGoalSchema, {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    perspective: requiredEnumToProto(strategyPerspectiveMapping, goal.perspective),
    linkedProjectIds: [...goal.linkedProjectIds],
  });
}

export function strategicGoalsFromProto(goals: readonly StrategicGoalProto[]): StrategicGoal[] {
  return goals.map(strategicGoalFromProto);
}

export function strategicGoalsToProto(goals: readonly StrategicGoal[]): StrategicGoalProto[] {
  return goals.map(strategicGoalToProto);
}

// ---------------------------------------------------------------------------
// NorthStarMetric
// ---------------------------------------------------------------------------

export function northStarMetricFromProto(metric: NorthStarMetricProto): NorthStarMetric {
  return {
    id: metric.id,
    name: metric.name,
    description: metric.description,
    color: metric.color,
  };
}

export function northStarMetricToProto(metric: NorthStarMetric): NorthStarMetricProto {
  return create(NorthStarMetricSchema, {
    id: metric.id,
    name: metric.name,
    description: metric.description,
    color: metric.color,
  });
}

export function northStarMetricsFromProto(metrics: readonly NorthStarMetricProto[]): NorthStarMetric[] {
  return metrics.map(northStarMetricFromProto);
}

export function northStarMetricsToProto(metrics: readonly NorthStarMetric[]): NorthStarMetricProto[] {
  return metrics.map(northStarMetricToProto);
}

// ---------------------------------------------------------------------------
// OneOnOneSession
// ---------------------------------------------------------------------------

export function oneOnOneSessionFromProto(session: OneOnOneSessionProto): OneOnOneSession {
  return {
    id: session.id,
    employeeId: session.employeeId,
    date: Number(session.dateMillis),
    status: requiredEnumFromProto(sessionStatusMapping, session.status, 'OneOnOneSession', session.id, 'status'),
    sentiment: requiredEnumFromProto(sentimentMapping, session.sentiment, 'OneOnOneSession', session.id, 'sentiment'),
    notes: session.notes,
    commitments: [...session.commitments],
    agenda: [...session.agenda],
  };
}

export function oneOnOneSessionToProto(session: OneOnOneSession): OneOnOneSessionProto {
  return create(OneOnOneSessionSchema, {
    id: session.id,
    employeeId: session.employeeId,
    dateMillis: BigInt(session.date),
    status: requiredEnumToProto(sessionStatusMapping, session.status),
    sentiment: requiredEnumToProto(sentimentMapping, session.sentiment),
    notes: session.notes,
    commitments: [...session.commitments],
    agenda: [...session.agenda],
  });
}

export function oneOnOneSessionsFromProto(sessions: readonly OneOnOneSessionProto[]): OneOnOneSession[] {
  return sessions.map(oneOnOneSessionFromProto);
}

export function oneOnOneSessionsToProto(sessions: readonly OneOnOneSession[]): OneOnOneSessionProto[] {
  return sessions.map(oneOnOneSessionToProto);
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/**
 * The proto `User` message carries a required `email` field that has no
 * counterpart on the domain `User` in `types.ts`. `userFromProto` drops it
 * (the same way `assignmentFromProto`/`absenceFromProto` drop `versionId`);
 * `userToProto` takes it as an explicit second argument, mirroring the
 * `versionId` parameter pattern the spec calls for on Assignment/Absence.
 */
export function userFromProto(user: UserProto): User {
  return {
    id: user.id,
    name: user.name,
    roles: requiredEnumArrayFromProto(userRoleMapping, user.roles, 'User', user.id, 'roles'),
    avatar: user.avatar,
    employeeId: user.employeeId,
  };
}

export function userToProto(user: User, email: string): UserProto {
  return create(UserSchema, {
    id: user.id,
    name: user.name,
    roles: requiredEnumArrayToProto(userRoleMapping, user.roles),
    avatar: user.avatar,
    employeeId: user.employeeId,
    email,
  });
}

/** Domain -> proto conversion for `roles` alone, for callers (e.g. `useUsers`) that build an
 * admin request shape rather than a full `User` message. */
export function userRolesToProto(roles: readonly User['roles'][number][]): UserRole[] {
  return requiredEnumArrayToProto(userRoleMapping, roles);
}

/**
 * The admin surface (`useUsers`/`ManageUsers`) needs `email` to identify and
 * mutate a user - the plain `User` domain type deliberately omits it because
 * every other caller only ever sees the current session's own user, which
 * never needs to display its own email back to itself. `AdminUser` is `User`
 * plus that one field; there is no corresponding `adminUserToProto` because
 * the admin RPCs (`UpsertUser`/`DeleteUser`) take a purpose-built request
 * shape, never a full `User` message.
 */
export interface AdminUser extends User {
  email: string;
}

export function adminUserFromProto(user: UserProto): AdminUser {
  return {
    ...userFromProto(user),
    email: user.email,
  };
}
