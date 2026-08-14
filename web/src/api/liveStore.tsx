import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  accountFromProto,
  accountToProto,
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
  Account,
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
  saveAccount(account: Account): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
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

/**
 * `QuarterData` embeds full `Project` objects (runningProjects /
 * mustWinOpportunities / alternativeOpportunities) that `QuarterlyForecast`
 * renders from directly, so a PROJECT change event must reach into every
 * version's forecastData - otherwise those views keep showing a stale copy.
 * `project === undefined` means DELETE: the embedded copies are removed.
 * Only replaces/removes existing entries; which quarter list a project
 * belongs to is owned by QUARTER_DATA events, not by PROJECT events.
 * Referentially transparent: untouched quarters/versions keep their identity.
 */
function updateEmbeddedProjects(
  versions: readonly PlanVersion[],
  projectId: string,
  project: Project | undefined
): PlanVersion[] {
  const patchList = (list: Project[]): Project[] => {
    const index = list.findIndex(existing => existing.id === projectId);
    if (index === -1) return list;
    if (project === undefined) return list.filter(existing => existing.id !== projectId);
    const next = [...list];
    next[index] = project;
    return next;
  };
  return versions.map(version => {
    let versionChanged = false;
    const forecastData = version.forecastData.map(quarter => {
      const runningProjects = patchList(quarter.runningProjects);
      const mustWinOpportunities = patchList(quarter.mustWinOpportunities);
      const alternativeOpportunities = patchList(quarter.alternativeOpportunities);
      if (
        runningProjects === quarter.runningProjects &&
        mustWinOpportunities === quarter.mustWinOpportunities &&
        alternativeOpportunities === quarter.alternativeOpportunities
      ) {
        return quarter;
      }
      versionChanged = true;
      return { ...quarter, runningProjects, mustWinOpportunities, alternativeOpportunities };
    });
    return versionChanged ? { ...version, forecastData } : version;
  });
}

/**
 * Bookkeeping for an in-flight `hydrateVersion` fetch. `startSeq` is the
 * event-log high-water mark when the fetch started; the three id sets record
 * which assignments/absences/quarters a watch event (seq > startSeq) changed
 * while the GetVersion round-trip was still in flight. Those entries are
 * strictly newer than the fetched snapshot and must win the merge.
 */
interface PendingHydration {
  startSeq: bigint;
  assignments: Set<string>;
  absences: Set<string>;
  quarters: Set<string>;
}

/**
 * Merges a freshly fetched full-version snapshot with the current state:
 * for every id changed by a watch event during the fetch (see
 * `PendingHydration`) the current entry is preferred over the staler
 * snapshot entry; an id the snapshot still carries but the current state
 * no longer has was deleted by such an event and is dropped.
 */
function mergeHydratedVersion(
  current: PlanVersion | undefined,
  snapshot: PlanVersion,
  pending: PendingHydration | undefined
): PlanVersion {
  if (current === undefined || pending === undefined) return snapshot;
  const preferCurrent = <T extends { id: string }>(snapshotList: T[], currentList: T[], changedIds: Set<string>): T[] => {
    if (changedIds.size === 0) return snapshotList;
    // Drop staler snapshot copies of changed ids, then re-apply the current
    // (newer) entries - upsert also covers ids the snapshot never had.
    let merged = snapshotList.filter(item => !changedIds.has(item.id));
    for (const item of currentList) {
      if (changedIds.has(item.id)) merged = upsertById(merged, item);
    }
    return merged;
  };
  return {
    ...snapshot,
    assignments: preferCurrent(snapshot.assignments, current.assignments, pending.assignments),
    absences: preferCurrent(snapshot.absences, current.absences, pending.absences),
    forecastData: preferCurrent(snapshot.forecastData, current.forecastData, pending.quarters),
  };
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
        return {
          ...prev,
          projects: removeById(prev.projects, event.entityId),
          versions: updateEmbeddedProjects(prev.versions, event.entityId, undefined),
        };
      }
      if (event.body.case !== 'project') return prev;
      // The server stores accounts in their own table and strips them from
      // the project blob, so the event's `project` always carries an empty
      // accounts list. Preserve whatever the previous entry had - otherwise
      // every PROJECT event would wipe the accounts of the matching project.
      const existing = prev.projects.find(pp => pp.id === event.entityId);
      const merged = { ...projectFromProto(event.body.value), accounts: existing?.accounts ?? [] };
      return {
        ...prev,
        projects: upsertById(prev.projects, merged),
        versions: updateEmbeddedProjects(prev.versions, event.entityId, merged),
      };
    }

    case EntityKind.ACCOUNT: {
      const patchAccounts = (projects: Project[]): Project[] => {
        if (event.op === ChangeOp.DELETE) {
          return projects.map(pp =>
            (pp.accounts ?? []).some(account => account.id === event.entityId)
              ? { ...pp, accounts: (pp.accounts ?? []).filter(account => account.id !== event.entityId) }
              : pp
          );
        }
        if (event.body.case !== 'account') return projects;
        const account = accountFromProto(event.body.value);
        return projects.map(pp =>
          pp.id === account.projectId
            ? { ...pp, accounts: upsertById(pp.accounts ?? [], account) }
            : pp
        );
      };
      return { ...prev, projects: patchAccounts(prev.projects) };
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
        ? {
            ...existing,
            name: meta.name,
            description: meta.description,
            createdAt: Number(meta.createdAtMillis),
            owner: meta.owner,
            ownerName: meta.ownerName,
          }
        : {
            id: meta.id,
            name: meta.name,
            description: meta.description,
            createdAt: Number(meta.createdAtMillis),
            owner: meta.owner,
            ownerName: meta.ownerName,
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
  // An id is added ONLY after its hydration succeeded - a failed fetch must
  // not leave a permanent empty shell that blocks every retry.
  const knownFullVersionIdsRef = useRef<Set<string>>(new Set());
  // In-flight one-off GetVersion fetches, keyed by version id. Guards
  // against duplicate hydration fetches and carries the stale-overwrite
  // bookkeeping (see PendingHydration above).
  const pendingHydrationsRef = useRef<Map<string, PendingHydration>>(new Map());

  const hydrateVersion = useCallback(async (versionId: string): Promise<void> => {
    // Remember the high-water mark at fetch start: watch events with
    // seq > startSeq may apply newer changes to this version while the
    // GetVersion round-trip is in flight; those must win over the (staler)
    // snapshot in the merge below (tracked by trackChangeDuringHydration).
    const pending: PendingHydration = {
      startSeq: lastSeqRef.current,
      assignments: new Set(),
      absences: new Set(),
      quarters: new Set(),
    };
    pendingHydrationsRef.current.set(versionId, pending);
    try {
      const response = await planningClient.getVersion({ versionId });
      if (!response.version) return;
      const projectsById = new Map(dataRef.current.projects.map(project => [project.id, project] as const));
      const { planVersion } = planVersionFromProto(response.version, projectsById);
      // Capture `pending` for the merge: the setData updater runs later
      // during React's render — by then the finally below has already
      // removed the map entry, so looking it up inside the updater would
      // silently lose the stale-overwrite protection.
      setData(prev => ({
        ...prev,
        versions: upsertById(
          prev.versions,
          mergeHydratedVersion(
            prev.versions.find(version => version.id === versionId),
            planVersion,
            pending
          )
        ),
      }));
      // Only now is the version fully known: on failure the id stays
      // unknown so a later event (or retry) can hydrate again.
      knownFullVersionIdsRef.current.add(versionId);
    } catch (err) {
      // Best-effort: this backfills a version another connected client just
      // created, not the primary load path - flipping the global `status`
      // to 'error' here would incorrectly blank the whole app over one
      // version's stale shell while everything else is fine. We also don't
      // toast: `useToast`/`useLanguage` are only safe to call during render,
      // and `LiveStoreProvider` is unit-tested standalone (no Toast/Language
      // providers in the tree), so reaching for them here would either
      // violate the rules of hooks or force every test to grow unrelated
      // wrapper providers. Log clearly instead so the failure isn't silent;
      // `knownFullVersionIdsRef` was never marked for this id, so a later
      // watch event or manual reload can still retry the hydration.
      console.error(`hydrateVersion: failed to backfill plan version ${versionId}`, err);
    } finally {
      pendingHydrationsRef.current.delete(versionId);
    }
  }, []);

  const loadAll = useCallback(async (): Promise<void> => {
    setData(prev => ({ ...prev, error: undefined }));
    try {
      // Read the event-log high-water mark BEFORE the snapshot reads: every
      // change committed up to maxSeq is reflected in the list responses
      // below (they are read after the mark), and everything beyond maxSeq
      // is replayed by the watch stream we (re)start with sinceSeq=maxSeq
      // (server-side subscribe-then-replay plus the client-side seq dedupe
      // drops any double delivery). This closes the gap that previously
      // existed between "snapshot taken" and "watch started" on (re)loads.
      const eventsState = await eventClient.getEventsState({});
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
      // Advance the high-water mark only after the snapshot was applied:
      // had any RPC above failed, the mark must stay where it was.
      lastSeqRef.current = eventsState.maxSeq;
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
      if (pendingHydrationsRef.current.has(event.entityId)) return;
      void hydrateVersion(event.entityId);
    }

    // Records assignment/absence/quarter changes that watch events apply
    // while a hydration fetch for their version is in flight, so the
    // hydration merge can prefer them over the staler GetVersion snapshot
    // (see mergeHydratedVersion). Only events newer than the fetch's
    // startSeq count - anything older is already in the snapshot.
    function trackChangeDuringHydration(event: ChangeEvent): void {
      if (event.versionId === undefined) return;
      const pending = pendingHydrationsRef.current.get(event.versionId);
      if (pending === undefined || event.seq <= pending.startSeq) return;
      switch (event.kind) {
        case EntityKind.ASSIGNMENT:
          pending.assignments.add(event.entityId);
          break;
        case EntityKind.ABSENCE:
          pending.absences.add(event.entityId);
          break;
        case EntityKind.QUARTER_DATA:
          pending.quarters.add(event.entityId);
          break;
        default:
          break;
      }
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
              trackChangeDuringHydration(event);
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
            // a full reload. loadAll re-reads the high-water mark itself and
            // leaves lastSeqRef at it, so the restarted watch replays exactly
            // the events committed after the fresh snapshot - no replay from
            // 0 (which a pruned log cannot serve anyway) and no gap.
            setData(prev => ({ ...prev, status: 'reconnecting' }));
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

  const saveAccount = useCallback(async (account: Account): Promise<Account> => {
    const response = await projectClient.upsertAccount({ account: accountToProto(account) });
    if (!response.account) throw new Error('UpsertAccount: server returned no account');
    const saved = accountFromProto(response.account);
    setData(prev => ({
      ...prev,
      projects: prev.projects.map(pp =>
        pp.id === saved.projectId
          ? { ...pp, accounts: upsertById(pp.accounts ?? [], saved) }
          : pp
      ),
    }));
    return saved;
  }, []);

  const deleteAccount = useCallback(async (id: string): Promise<void> => {
    await projectClient.deleteAccount({ id });
    setData(prev => ({
      ...prev,
      projects: prev.projects.map(pp =>
        (pp.accounts ?? []).some(account => account.id === id)
          ? { ...pp, accounts: (pp.accounts ?? []).filter(account => account.id !== id) }
          : pp
      ),
    }));
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
        createdAt: Number(meta.createdAtMillis),
        owner: meta.owner,
        ownerName: meta.ownerName,
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
      // The response's seq is deliberately NOT used to bump lastSeqRef: our
      // own mutation's event will be delivered (and deduped) via the watch
      // stream, and jumping lastSeqRef forward here would silently discard
      // in-flight events from other clients with a smaller seq. Applying our
      // own event twice is harmless - upsertById/removeById are idempotent.
      await planningClient.applyAssignments({
        versionId,
        upserts: upserts.map(assignment => assignmentToProto(assignment, versionId)),
        deleteIds,
      });
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
      // See applyAssignments for why the response seq is not bumped into
      // lastSeqRef here.
      await planningClient.applyAbsences({
        versionId,
        upserts: upserts.map(absence => absenceToProto(absence, versionId)),
        deleteIds,
      });
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

  // Memoized so the context value keeps its identity across renders that
  // did not change `data` (e.g. re-renders triggered by a parent); without
  // this every render would produce a fresh object and re-render every
  // consumer. The action callbacks are all stable (useCallback with empty
  // deps), so the value effectively only changes when `data` changes - the
  // `useLiveStore` hook signature is unchanged for consumers.
  const store: LiveStore = useMemo(
    () => ({
      ...data,
      saveEmployee,
      deleteEmployee,
      saveProject,
      deleteProject,
      saveAccount,
      deleteAccount,
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
    }),
    [
      data,
      saveEmployee,
      deleteEmployee,
      saveProject,
      deleteProject,
      saveAccount,
      deleteAccount,
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
    ]
  );

  return <LiveStoreContext.Provider value={store}>{children}</LiveStoreContext.Provider>;
};

export const useLiveStore = (): LiveStore => {
  const context = useContext(LiveStoreContext);
  if (!context) throw new Error('useLiveStore must be used within a LiveStoreProvider');
  return context;
};
