import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';

import {
  teamClient,
  customerClient,
  projectClient,
  planningClient,
  strategyClient,
  growthClient,
  eventClient,
} from './clients';
import {
  employeesFromProto,
  employeeFromProto,
  employeeToProto,
  customersFromProto,
  customerFromProto,
  customerToProto,
  projectsFromProto,
  projectFromProto,
  projectToProto,
  planVersionFromProto,
  assignmentFromProto,
  assignmentToProto,
  absenceFromProto,
  absenceToProto,
  publicHolidaysFromProto,
  quarterDataFromProto,
  quarterDataToProto,
  strategicGoalsFromProto,
  strategicGoalFromProto,
  strategicGoalToProto,
  northStarMetricsFromProto,
  northStarMetricFromProto,
  northStarMetricToProto,
  oneOnOneSessionsFromProto,
  oneOnOneSessionFromProto,
  oneOnOneSessionToProto,
} from './adapters';
import { EntityKind, ChangeOp, type ChangeEvent } from './gen/qfc/events/v1/events_pb.js';
import type {
  Employee,
  Project,
  Customer,
  PlanVersion,
  PublicHoliday,
  StrategicGoal,
  NorthStarMetric,
  OneOnOneSession,
  Assignment,
  Absence,
  QuarterData,
} from '../types';

export type LiveStoreStatus = 'loading' | 'ready' | 'error' | 'reconnecting';

export interface LiveStoreState {
  status: LiveStoreStatus;
  /** Message for the most recent load/watch failure; cleared once things recover. */
  error: string | undefined;
  employees: Employee[];
  projects: Project[];
  customers: Customer[];
  versions: PlanVersion[];
  holidays: PublicHoliday[];
  goals: StrategicGoal[];
  northStars: NorthStarMetric[];
  oneOnOnes: OneOnOneSession[];
}

export interface LiveStore extends LiveStoreState {
  saveEmployee(employee: Employee): Promise<Employee>;
  deleteEmployee(id: string): Promise<void>;
  saveProject(project: Project): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  saveCustomer(customer: Customer): Promise<Customer>;
  deleteCustomer(id: string): Promise<void>;
  createVersion(name: string, description?: string, copyFromVersionId?: string): Promise<PlanVersion>;
  updateVersionMeta(versionId: string, name: string, description?: string): Promise<PlanVersion>;
  deleteVersion(id: string): Promise<void>;
  applyAssignments(versionId: string, upserts: Assignment[], deleteIds: string[]): Promise<void>;
  applyAbsences(versionId: string, upserts: Absence[], deleteIds: string[]): Promise<void>;
  upsertQuarterData(versionId: string, quarter: QuarterData): Promise<QuarterData>;
  saveGoal(goal: StrategicGoal): Promise<StrategicGoal>;
  deleteGoal(id: string): Promise<void>;
  saveNorthStar(metric: NorthStarMetric): Promise<NorthStarMetric>;
  deleteNorthStar(id: string): Promise<void>;
  saveOneOnOne(session: OneOnOneSession): Promise<OneOnOneSession>;
  deleteOneOnOne(id: string): Promise<void>;
}

const LiveStoreContext = createContext<LiveStore | undefined>(undefined);

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function upsertById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  const index = list.findIndex(existing => existing.id === item.id);
  if (index === -1) return [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

function removeById<T extends { id: string }>(list: readonly T[], id: string): T[] {
  return list.filter(item => item.id !== id);
}

const initialState: LiveStoreState = {
  status: 'loading',
  error: undefined,
  employees: [],
  projects: [],
  customers: [],
  versions: [],
  holidays: [],
  goals: [],
  northStars: [],
  oneOnOnes: [],
};

/**
 * Applies one `ChangeEvent` to the collections in `prev`, immutably.
 * Pure and side-effect free by design so it is easy to unit test in
 * isolation; seq bookkeeping and the "new plan version needs a follow-up
 * GetVersion" side effect live in the caller (the watch loop below).
 */
export function applyChangeEvent(prev: LiveStoreState, event: ChangeEvent): LiveStoreState {
  const projectsById = new Map(prev.projects.map(project => [project.id, project] as const));

  switch (event.kind) {
    case EntityKind.EMPLOYEE: {
      if (event.op === ChangeOp.DELETE) {
        return { ...prev, employees: removeById(prev.employees, event.entityId) };
      }
      if (event.body.case !== 'employee') return prev;
      return { ...prev, employees: upsertById(prev.employees, employeeFromProto(event.body.value)) };
    }

    case EntityKind.CUSTOMER: {
      if (event.op === ChangeOp.DELETE) {
        return { ...prev, customers: removeById(prev.customers, event.entityId) };
      }
      if (event.body.case !== 'customer') return prev;
      return { ...prev, customers: upsertById(prev.customers, customerFromProto(event.body.value)) };
    }

    case EntityKind.PROJECT: {
      if (event.op === ChangeOp.DELETE) {
        return { ...prev, projects: removeById(prev.projects, event.entityId) };
      }
      if (event.body.case !== 'project') return prev;
      return { ...prev, projects: upsertById(prev.projects, projectFromProto(event.body.value)) };
    }

    case EntityKind.STRATEGIC_GOAL: {
      if (event.op === ChangeOp.DELETE) {
        return { ...prev, goals: removeById(prev.goals, event.entityId) };
      }
      if (event.body.case !== 'strategicGoal') return prev;
      return { ...prev, goals: upsertById(prev.goals, strategicGoalFromProto(event.body.value)) };
    }

    case EntityKind.NORTH_STAR_METRIC: {
      if (event.op === ChangeOp.DELETE) {
        return { ...prev, northStars: removeById(prev.northStars, event.entityId) };
      }
      if (event.body.case !== 'northStarMetric') return prev;
      return { ...prev, northStars: upsertById(prev.northStars, northStarMetricFromProto(event.body.value)) };
    }

    case EntityKind.ONE_ON_ONE_SESSION: {
      if (event.op === ChangeOp.DELETE) {
        return { ...prev, oneOnOnes: removeById(prev.oneOnOnes, event.entityId) };
      }
      if (event.body.case !== 'oneOnOneSession') return prev;
      return { ...prev, oneOnOnes: upsertById(prev.oneOnOnes, oneOnOneSessionFromProto(event.body.value)) };
    }

    case EntityKind.PLAN_VERSION: {
      if (event.op === ChangeOp.DELETE) {
        return { ...prev, versions: removeById(prev.versions, event.entityId) };
      }
      if (event.body.case !== 'planVersion') return prev;
      const meta = event.body.value;
      const existing = prev.versions.find(version => version.id === meta.id);
      const merged: PlanVersion = existing
        ? { ...existing, name: meta.name, description: meta.description, createdAt: meta.createdAt }
        : {
            id: meta.id,
            name: meta.name,
            description: meta.description,
            createdAt: meta.createdAt,
            // Only the meta is carried on the wire; a follow-up GetVersion
            // (triggered by the watch loop) fills these in for a version
            // created elsewhere that we haven't seen before.
            assignments: [],
            absences: [],
            forecastData: [],
          };
      return { ...prev, versions: upsertById(prev.versions, merged) };
    }

    case EntityKind.ASSIGNMENT: {
      if (event.versionId === undefined) return prev;
      const versionIndex = prev.versions.findIndex(version => version.id === event.versionId);
      if (versionIndex === -1) return prev;
      const version = prev.versions[versionIndex]!;
      const assignments =
        event.op === ChangeOp.DELETE
          ? removeById(version.assignments, event.entityId)
          : event.body.case === 'assignment'
            ? upsertById(version.assignments, assignmentFromProto(event.body.value))
            : version.assignments;
      const versions = [...prev.versions];
      versions[versionIndex] = { ...version, assignments };
      return { ...prev, versions };
    }

    case EntityKind.ABSENCE: {
      if (event.versionId === undefined) return prev;
      const versionIndex = prev.versions.findIndex(version => version.id === event.versionId);
      if (versionIndex === -1) return prev;
      const version = prev.versions[versionIndex]!;
      const absences =
        event.op === ChangeOp.DELETE
          ? removeById(version.absences, event.entityId)
          : event.body.case === 'absence'
            ? upsertById(version.absences, absenceFromProto(event.body.value))
            : version.absences;
      const versions = [...prev.versions];
      versions[versionIndex] = { ...version, absences };
      return { ...prev, versions };
    }

    case EntityKind.QUARTER_DATA: {
      if (event.versionId === undefined) return prev;
      const versionIndex = prev.versions.findIndex(version => version.id === event.versionId);
      if (versionIndex === -1) return prev;
      const version = prev.versions[versionIndex]!;
      const forecastData =
        event.op === ChangeOp.DELETE
          ? removeById(version.forecastData, event.entityId)
          : event.body.case === 'quarterData'
            ? upsertById(version.forecastData, quarterDataFromProto(event.body.value, projectsById).quarter)
            : version.forecastData;
      const versions = [...prev.versions];
      versions[versionIndex] = { ...version, forecastData };
      return { ...prev, versions };
    }

    default:
      return prev;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

export const LiveStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<LiveStoreState>(initialState);

  // Mirrors `data` synchronously for code that needs the latest snapshot
  // without waiting for a render (e.g. building a fresh `projectsById` for a
  // mutation response). Kept in lockstep via the effect below.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // The event-log high-water mark. A plain ref (not state) so the watch loop
  // can read/update it synchronously between awaits without racing React's
  // render cycle - this is what makes "apply the same change twice" a no-op.
  const lastSeqRef = useRef(0n);
  // Plan version ids we already have full data for (vs. only a meta shell).
  const knownFullVersionIdsRef = useRef<Set<string>>(new Set());

  const hydrateVersion = useCallback(async (versionId: string): Promise<void> => {
    try {
      const response = await planningClient.getVersion({ versionId });
      if (!response.version) return;
      const projectsById = new Map(dataRef.current.projects.map(project => [project.id, project] as const));
      const { planVersion } = planVersionFromProto(response.version, projectsById);
      setData(prev => ({ ...prev, versions: upsertById(prev.versions, planVersion) }));
    } catch {
      // Best-effort: another actor's new version will show up fully on the
      // next full reload if this one-off fetch fails.
    }
  }, []);

  const loadAll = useCallback(async (): Promise<void> => {
    setData(prev => ({ ...prev, error: undefined }));
    try {
      const [employeesRes, projectsRes, customersRes, holidaysRes, goalsRes, northStarsRes, sessionsRes, versionsRes] =
        await Promise.all([
          teamClient.listEmployees({}),
          projectClient.listProjects({}),
          customerClient.listCustomers({}),
          planningClient.listHolidays({}),
          strategyClient.listGoals({}),
          strategyClient.listNorthStarMetrics({}),
          growthClient.listSessions({}),
          planningClient.listVersions({}),
        ]);

      const employees = employeesFromProto(employeesRes.employees);
      const projects = projectsFromProto(projectsRes.projects);
      const customers = customersFromProto(customersRes.customers);
      const holidays = publicHolidaysFromProto(holidaysRes.holidays);
      const goals = strategicGoalsFromProto(goalsRes.goals);
      const northStars = northStarMetricsFromProto(northStarsRes.metrics);
      const oneOnOnes = oneOnOneSessionsFromProto(sessionsRes.sessions);

      // Projects must be resolved before versions: quarterDataFromProto needs
      // projectsById to hydrate a QuarterData's id lists into Project[].
      const projectsById = new Map(projects.map(project => [project.id, project] as const));

      const versionResponses = await Promise.all(
        versionsRes.versions.map(meta => planningClient.getVersion({ versionId: meta.id }))
      );
      const versions = versionResponses.map(response => {
        if (!response.version) throw new Error('GetVersion: server returned no version');
        return planVersionFromProto(response.version, projectsById).planVersion;
      });

      knownFullVersionIdsRef.current = new Set(versions.map(version => version.id));

      setData(prev => ({
        ...prev,
        status: 'ready',
        error: undefined,
        employees,
        projects,
        customers,
        versions,
        holidays,
        goals,
        northStars,
        oneOnOnes,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setData(prev => ({ ...prev, status: 'error', error: message }));
      throw err;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    function maybeHydrateNewVersion(event: ChangeEvent): void {
      if (event.kind !== EntityKind.PLAN_VERSION || event.op !== ChangeOp.UPSERT) return;
      if (knownFullVersionIdsRef.current.has(event.entityId)) return;
      knownFullVersionIdsRef.current.add(event.entityId);
      void hydrateVersion(event.entityId);
    }

    async function watchLoop(): Promise<void> {
      let backoffMs = INITIAL_BACKOFF_MS;
      while (!cancelled) {
        try {
          const stream = eventClient.watch(
            { sinceSeq: lastSeqRef.current },
            {
              signal: controller.signal,
              onHeader: () => {
                setData(prev => (prev.status === 'reconnecting' ? { ...prev, status: 'ready' } : prev));
              },
            }
          );
          for await (const event of stream) {
            if (cancelled) return;
            backoffMs = INITIAL_BACKOFF_MS;
            if (event.seq > lastSeqRef.current) {
              lastSeqRef.current = event.seq;
              setData(prev => applyChangeEvent(prev, event));
              maybeHydrateNewVersion(event);
            }
            // else: a replayed/duplicate event we already applied - no-op.
          }
          // Stream ended normally (server closed it); reconnect below.
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ConnectError && err.code === Code.Canceled) return;
          if (err instanceof ConnectError && err.code === Code.DataLoss) {
            // Our sinceSeq was pruned or we lagged: the only correct move is
            // a full reload, then restart live with no replay (sinceSeq: 0) -
            // the fresh snapshot already reflects everything up to "now".
            setData(prev => ({ ...prev, status: 'reconnecting' }));
            lastSeqRef.current = 0n;
            try {
              await loadAll();
            } catch {
              return; // loadAll already recorded the error status.
            }
            backoffMs = INITIAL_BACKOFF_MS;
            continue;
          }
          // Any other error (network blip, server restart, ...): back off and retry below.
        }

        if (cancelled) return;
        setData(prev => (prev.status === 'ready' ? { ...prev, status: 'reconnecting' } : prev));
        try {
          await sleep(backoffMs, controller.signal);
        } catch {
          return; // aborted (unmount).
        }
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    }

    (async () => {
      try {
        await loadAll();
      } catch {
        return; // status is already 'error'; nothing to watch yet.
      }
      if (cancelled) return;
      void watchLoop();
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loadAll, hydrateVersion]);

  const saveEmployee = useCallback(async (employee: Employee): Promise<Employee> => {
    const response = await teamClient.upsertEmployee({ employee: employeeToProto(employee) });
    if (!response.employee) throw new Error('UpsertEmployee: server returned no employee');
    const saved = employeeFromProto(response.employee);
    setData(prev => ({ ...prev, employees: upsertById(prev.employees, saved) }));
    return saved;
  }, []);

  const deleteEmployee = useCallback(async (id: string): Promise<void> => {
    await teamClient.deleteEmployee({ id });
    setData(prev => ({ ...prev, employees: removeById(prev.employees, id) }));
  }, []);

  const saveProject = useCallback(async (project: Project): Promise<Project> => {
    const response = await projectClient.upsertProject({ project: projectToProto(project) });
    if (!response.project) throw new Error('UpsertProject: server returned no project');
    const saved = projectFromProto(response.project);
    setData(prev => ({ ...prev, projects: upsertById(prev.projects, saved) }));
    return saved;
  }, []);

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    await projectClient.deleteProject({ id });
    setData(prev => ({ ...prev, projects: removeById(prev.projects, id) }));
  }, []);

  const saveCustomer = useCallback(async (customer: Customer): Promise<Customer> => {
    const response = await customerClient.upsertCustomer({ customer: customerToProto(customer) });
    if (!response.customer) throw new Error('UpsertCustomer: server returned no customer');
    const saved = customerFromProto(response.customer);
    setData(prev => ({ ...prev, customers: upsertById(prev.customers, saved) }));
    return saved;
  }, []);

  const deleteCustomer = useCallback(async (id: string): Promise<void> => {
    await customerClient.deleteCustomer({ id });
    setData(prev => ({ ...prev, customers: removeById(prev.customers, id) }));
  }, []);

  const createVersion = useCallback(
    async (name: string, description?: string, copyFromVersionId?: string): Promise<PlanVersion> => {
      const response = await planningClient.createVersion({ name, description, copyFromVersionId });
      if (!response.version) throw new Error('CreateVersion: server returned no version');
      const projectsById = new Map(dataRef.current.projects.map(project => [project.id, project] as const));
      const { planVersion } = planVersionFromProto(response.version, projectsById);
      knownFullVersionIdsRef.current.add(planVersion.id);
      setData(prev => ({ ...prev, versions: upsertById(prev.versions, planVersion) }));
      return planVersion;
    },
    []
  );

  const updateVersionMeta = useCallback(
    async (versionId: string, name: string, description?: string): Promise<PlanVersion> => {
      const response = await planningClient.updateVersionMeta({ versionId, name, description });
      if (!response.meta) throw new Error('UpdateVersionMeta: server returned no meta');
      const meta = response.meta;
      const existing = dataRef.current.versions.find(version => version.id === versionId);
      if (!existing) throw new Error(`UpdateVersionMeta: unknown version ${versionId}`);
      const updated: PlanVersion = {
        ...existing,
        name: meta.name,
        description: meta.description,
        createdAt: meta.createdAt,
      };
      setData(prev => ({ ...prev, versions: upsertById(prev.versions, updated) }));
      return updated;
    },
    []
  );

  const deleteVersion = useCallback(async (id: string): Promise<void> => {
    await planningClient.deleteVersion({ versionId: id });
    setData(prev => ({ ...prev, versions: removeById(prev.versions, id) }));
  }, []);

  const applyAssignments = useCallback(
    async (versionId: string, upserts: Assignment[], deleteIds: string[]): Promise<void> => {
      const response = await planningClient.applyAssignments({
        versionId,
        upserts: upserts.map(assignment => assignmentToProto(assignment, versionId)),
        deleteIds,
      });
      if (response.seq > lastSeqRef.current) lastSeqRef.current = response.seq;
      setData(prev => {
        const versionIndex = prev.versions.findIndex(version => version.id === versionId);
        if (versionIndex === -1) return prev;
        const version = prev.versions[versionIndex]!;
        const deleteSet = new Set(deleteIds);
        let assignments = version.assignments.filter(assignment => !deleteSet.has(assignment.id));
        for (const upsert of upserts) {
          assignments = upsertById(assignments, upsert);
        }
        const versions = [...prev.versions];
        versions[versionIndex] = { ...version, assignments };
        return { ...prev, versions };
      });
    },
    []
  );

  const applyAbsences = useCallback(
    async (versionId: string, upserts: Absence[], deleteIds: string[]): Promise<void> => {
      const response = await planningClient.applyAbsences({
        versionId,
        upserts: upserts.map(absence => absenceToProto(absence, versionId)),
        deleteIds,
      });
      if (response.seq > lastSeqRef.current) lastSeqRef.current = response.seq;
      setData(prev => {
        const versionIndex = prev.versions.findIndex(version => version.id === versionId);
        if (versionIndex === -1) return prev;
        const version = prev.versions[versionIndex]!;
        const deleteSet = new Set(deleteIds);
        let absences = version.absences.filter(absence => !deleteSet.has(absence.id));
        for (const upsert of upserts) {
          absences = upsertById(absences, upsert);
        }
        const versions = [...prev.versions];
        versions[versionIndex] = { ...version, absences };
        return { ...prev, versions };
      });
    },
    []
  );

  const upsertQuarterData = useCallback(async (versionId: string, quarter: QuarterData): Promise<QuarterData> => {
    const response = await planningClient.upsertQuarterData({ versionId, quarter: quarterDataToProto(quarter) });
    if (!response.quarter) throw new Error('UpsertQuarterData: server returned no quarter');
    const projectsById = new Map(dataRef.current.projects.map(project => [project.id, project] as const));
    const { quarter: hydrated } = quarterDataFromProto(response.quarter, projectsById);
    setData(prev => {
      const versionIndex = prev.versions.findIndex(version => version.id === versionId);
      if (versionIndex === -1) return prev;
      const version = prev.versions[versionIndex]!;
      const versions = [...prev.versions];
      versions[versionIndex] = { ...version, forecastData: upsertById(version.forecastData, hydrated) };
      return { ...prev, versions };
    });
    return hydrated;
  }, []);

  const saveGoal = useCallback(async (goal: StrategicGoal): Promise<StrategicGoal> => {
    const response = await strategyClient.upsertGoal({ goal: strategicGoalToProto(goal) });
    if (!response.goal) throw new Error('UpsertGoal: server returned no goal');
    const saved = strategicGoalFromProto(response.goal);
    setData(prev => ({ ...prev, goals: upsertById(prev.goals, saved) }));
    return saved;
  }, []);

  const deleteGoal = useCallback(async (id: string): Promise<void> => {
    await strategyClient.deleteGoal({ id });
    setData(prev => ({ ...prev, goals: removeById(prev.goals, id) }));
  }, []);

  const saveNorthStar = useCallback(async (metric: NorthStarMetric): Promise<NorthStarMetric> => {
    const response = await strategyClient.upsertNorthStarMetric({ metric: northStarMetricToProto(metric) });
    if (!response.metric) throw new Error('UpsertNorthStarMetric: server returned no metric');
    const saved = northStarMetricFromProto(response.metric);
    setData(prev => ({ ...prev, northStars: upsertById(prev.northStars, saved) }));
    return saved;
  }, []);

  const deleteNorthStar = useCallback(async (id: string): Promise<void> => {
    await strategyClient.deleteNorthStarMetric({ id });
    setData(prev => ({ ...prev, northStars: removeById(prev.northStars, id) }));
  }, []);

  const saveOneOnOne = useCallback(async (session: OneOnOneSession): Promise<OneOnOneSession> => {
    const response = await growthClient.upsertSession({ session: oneOnOneSessionToProto(session) });
    if (!response.session) throw new Error('UpsertSession: server returned no session');
    const saved = oneOnOneSessionFromProto(response.session);
    setData(prev => ({ ...prev, oneOnOnes: upsertById(prev.oneOnOnes, saved) }));
    return saved;
  }, []);

  const deleteOneOnOne = useCallback(async (id: string): Promise<void> => {
    await growthClient.deleteSession({ id });
    setData(prev => ({ ...prev, oneOnOnes: removeById(prev.oneOnOnes, id) }));
  }, []);

  const store: LiveStore = {
    ...data,
    saveEmployee,
    deleteEmployee,
    saveProject,
    deleteProject,
    saveCustomer,
    deleteCustomer,
    createVersion,
    updateVersionMeta,
    deleteVersion,
    applyAssignments,
    applyAbsences,
    upsertQuarterData,
    saveGoal,
    deleteGoal,
    saveNorthStar,
    deleteNorthStar,
    saveOneOnOne,
    deleteOneOnOne,
  };

  return <LiveStoreContext.Provider value={store}>{children}</LiveStoreContext.Provider>;
};

export const useLiveStore = (): LiveStore => {
  const context = useContext(LiveStoreContext);
  if (!context) throw new Error('useLiveStore must be used within a LiveStoreProvider');
  return context;
};
