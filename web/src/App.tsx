

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Code, ConnectError } from '@connectrpc/connect';
import { Sidebar } from './components/Sidebar';
import { ResourcePlanner } from './components/ResourcePlanner';
import { CreateVersionDialog } from './components/CreateVersionDialog';
import { Assignment, Project, Employee, Customer, Absence, QuarterData, StrategicGoal, OneOnOneSession } from './types';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useLanguage } from './contexts/LanguageContext';
import { useToday } from './hooks/useToday';
import { useToast } from './components/ui/Toast';
import { AsciiSpinner } from './components/ui/AsciiSpinner';
import { LiveStoreProvider, useLiveStore } from './api/liveStore';
import { computeDelta } from './api/delta';
import { hasPlanningAccess, getLandingRoute } from './utils/access';
import { mergeForecastQuarters } from './utils/forecast';

const QuarterlyForecast = React.lazy(() => import('./components/QuarterlyForecast').then(m => ({ default: m.QuarterlyForecast })));
const ManageTeam = React.lazy(() => import('./components/ManageTeam').then(m => ({ default: m.ManageTeam })));
const ManageProjects = React.lazy(() => import('./components/ManageProjects').then(m => ({ default: m.ManageProjects })));
const ManageCustomers = React.lazy(() => import('./components/ManageCustomers').then(m => ({ default: m.ManageCustomers })));
const FinancialOverview = React.lazy(() => import('./components/FinancialOverview').then(m => ({ default: m.FinancialOverview })));
const StrategyModule = React.lazy(() => import('./components/StrategyModule').then(m => ({ default: m.StrategyModule })));
const MyOverview = React.lazy(() => import('./components/MyOverview').then(m => ({ default: m.MyOverview })));
const SalesPipeline = React.lazy(() => import('./components/SalesPipeline').then(m => ({ default: m.SalesPipeline })));
const AdminArea = React.lazy(() => import('./components/admin/AdminArea').then(m => ({ default: m.AdminArea })));

// Animated Page Wrapper
const AnimatedPage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      {children}
    </div>
  );
};

const FullScreenMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-screen w-screen flex-col items-center justify-center bg-charcoal-50 text-charcoal-600 gap-2">
    {children}
  </div>
);

const AppContent: React.FC = () => {
  const { isRole } = useAuth();
  const { t } = useLanguage();
  const { success, error } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const store = useLiveStore();
  const { employees, projects, customers, versions, holidays, goals, northStars, oneOnOnes } = store;

  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);

  // Active Version State - the server seeds at least one version, so `versions`
  // is non-empty by the time AppContent mounts (see the LiveStore gate below).
  const [activeVersionId, setActiveVersionId] = useState<string>(
    () => versions[versions.length - 1]?.id ?? ''
  );

  const latestVersion = versions[versions.length - 1];
  const isLatestVersion = activeVersionId === latestVersion?.id;

  const activeVersion = useMemo(
    () => versions.find(v => v.id === activeVersionId) ?? latestVersion,
    [versions, activeVersionId, latestVersion]
  );

  const plannerAssignments = activeVersion?.assignments ?? [];
  const plannerAbsences = activeVersion?.absences ?? [];

  const versionStartDate = useToday();

  // A fresh plan version starts with zero QuarterData rows and there is no
  // UI to create one - derive a rolling 4-quarter window (backed by whatever
  // is already persisted) so the forecast page always has something to show.
  const forecastData = useMemo(
    () => mergeForecastQuarters(activeVersion?.forecastData ?? [], versionStartDate),
    [activeVersion, versionStartDate]
  );

  const handleUpdateEmployees = (nextEmployees: Employee[]) => {
    const { upserts, deleteIds } = computeDelta(employees, nextEmployees);
    if (upserts.length === 0 && deleteIds.length === 0) return;
    Promise.all([
      ...upserts.map(employee => store.saveEmployee(employee)),
      ...deleteIds.map(id => store.deleteEmployee(id)),
    ]).catch(() => error(t('common.saveError')));
  };

  const handleUpdateProjects = (nextProjects: Project[]) => {
    const { upserts, deleteIds } = computeDelta(projects, nextProjects);
    if (upserts.length === 0 && deleteIds.length === 0) return;
    Promise.all([
      ...upserts.map(project => store.saveProject(project)),
      ...deleteIds.map(id => store.deleteProject(id)),
    ]).catch(() => error(t('common.saveError')));
  };

  const handleUpdateCustomers = (nextCustomers: Customer[]) => {
    const { upserts, deleteIds } = computeDelta(customers, nextCustomers);
    if (upserts.length === 0 && deleteIds.length === 0) return;
    Promise.all([
      ...upserts.map(customer => store.saveCustomer(customer)),
      ...deleteIds.map(id => store.deleteCustomer(id)),
    ]).catch(() => error(t('common.saveError')));
  };

  const handleUpdateGoals = (nextGoals: StrategicGoal[]) => {
    const { upserts, deleteIds } = computeDelta(goals, nextGoals);
    if (upserts.length === 0 && deleteIds.length === 0) return;
    Promise.all([
      ...upserts.map(goal => store.saveGoal(goal)),
      ...deleteIds.map(id => store.deleteGoal(id)),
    ]).catch(() => error(t('common.saveError')));
  };

  const handleUpdateOneOnOnes = (nextOneOnOnes: OneOnOneSession[]) => {
    const { upserts, deleteIds } = computeDelta(oneOnOnes, nextOneOnOnes);
    if (upserts.length === 0 && deleteIds.length === 0) return;
    Promise.all([
      ...upserts.map(session => store.saveOneOnOne(session)),
      ...deleteIds.map(id => store.deleteOneOnOne(id)),
    ]).catch(() => error(t('common.saveError')));
  };

  const handleAssignmentChange = (newAssignments: Assignment[]) => {
    if (!isLatestVersion) {
      console.warn('handleAssignmentChange: active version is read-only, ignoring update');
      return;
    }
    const { upserts, deleteIds } = computeDelta(plannerAssignments, newAssignments);
    if (upserts.length === 0 && deleteIds.length === 0) return;
    store.applyAssignments(activeVersionId, upserts, deleteIds).catch(() => error(t('common.saveError')));
  };

  const handleAbsenceChange = (newAbsences: Absence[]) => {
    if (!isLatestVersion) {
      console.warn('handleAbsenceChange: active version is read-only, ignoring update');
      return;
    }
    const { upserts, deleteIds } = computeDelta(plannerAbsences, newAbsences);
    if (upserts.length === 0 && deleteIds.length === 0) return;
    store.applyAbsences(activeVersionId, upserts, deleteIds).catch(() => error(t('common.saveError')));
  };

  const handleCreateVersion = (name: string, description: string) => {
    // Plan revisions branch only from the LATEST revision — frozen
    // snapshots are read-only and never serve as a copy source (the user
    // can, however, flip back to an old revision afterwards to inspect it).
    store
      .createVersion(name, description || undefined, latestVersion?.id)
      .then(newVersion => {
        setActiveVersionId(newVersion.id);
        success(t('toast.versionCreated'));
      })
      .catch(() => error(t('common.saveError')));
  };

  const handleRenameVersion = (id: string, name: string) => {
    store
      .updateVersionMeta(id, name)
      .then(() => success(t('versions.toastRenamed')))
      .catch(() => error(t('common.saveError')));
  };

  const handleDeleteVersion = (id: string) => {
    store
      .deleteVersion(id)
      .then(() => {
        success(t('versions.toastDeleted'));
        // Deleting the active version must leave the app on a version that
        // still exists - fall back to the latest remaining one.
        if (activeVersionId !== id) return;
        const remaining = versions.filter(version => version.id !== id);
        const fallback = remaining[remaining.length - 1];
        if (fallback) setActiveVersionId(fallback.id);
      })
      .catch((err: unknown) => {
        if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
          error(t('versions.lastVersionGuard'));
        } else {
          error(t('common.saveError'));
        }
      });
  };

  const handleForecastUpdate = (quarterId: string, type: 'mustWin' | 'alternative', updatedProjects: Project[]) => {
    const quarter = forecastData.find(q => q.id === quarterId);
    if (!quarter) return;
    const updatedQuarter: QuarterData = {
      ...quarter,
      [type === 'mustWin' ? 'mustWinOpportunities' : 'alternativeOpportunities']: updatedProjects,
    };
    store.upsertQuarterData(activeVersionId, updatedQuarter).catch(() => error(t('common.saveError')));
  };

  const handleForecastNotes = (quarterId: string, notes: string) => {
    const quarter = forecastData.find(q => q.id === quarterId);
    if (!quarter) return;
    store
      .upsertQuarterData(activeVersionId, { ...quarter, notes })
      .catch(() => error(t('common.saveError')));
  };

  const handleNavigateToProject = (projectId: string) => {
    setHighlightedProjectId(projectId);
    navigate('/projects');
  };

  const handleNavigateToEmployee = (employeeId: string) => {
      navigate(`/my-overview/${encodeURIComponent(employeeId)}`);
  };

  // Determine ReadOnly state for Planner.
  // Read only if: not the latest version, OR the user lacks planning access
  // (pm/bl). `employee` is no longer mutually exclusive with `pm`/`bl`, so an
  // employee+pm user must keep write access - see `hasPlanningAccess`, which
  // Sidebar.tsx's version-history visibility derives from the same way so
  // the two can never drift apart.
  const isPlannerReadOnly = !isLatestVersion || !hasPlanningAccess(isRole);

  // Reset Highlight effects when navigating away from specific views
  useEffect(() => {
      if (location.pathname !== '/projects') {
          setHighlightedProjectId(null);
      }
  }, [location.pathname]);

  if (!activeVersion) {
    // Defensive only: the server always seeds at least one plan version.
    return <FullScreenMessage><span className="text-sm font-medium">{t('common.loadError')}</span></FullScreenMessage>;
  }

  return (
    <div className="flex h-screen bg-charcoal-50 text-charcoal-800 font-sans selection:bg-blue-100 selection:text-blue-900 overflow-hidden">
      <Sidebar
        versions={versions}
        employees={employees}
        projects={projects}
        activeVersionId={activeVersionId}
        onSelectVersion={setActiveVersionId}
        onCreateVersion={() => setIsVersionDialogOpen(true)}
        onRenameVersion={handleRenameVersion}
        onDeleteVersion={handleDeleteVersion}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative tech-pattern">
        {/* Top Fade Gradient for depth */}
        <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-charcoal-50 to-transparent z-10 pointer-events-none" />

        <Suspense
          fallback={
            <div className="flex-1 flex flex-col items-center justify-center h-full text-charcoal-600">
              <AsciiSpinner className="text-2xl mb-2" />
              <span className="text-sm font-medium">{t('common.loading')}</span>
            </div>
          }
        >
        <Routes>
            <Route path="/" element={<Navigate to={getLandingRoute(isRole)} replace />} />

            <Route path="/my-overview" element={
                <AnimatedPage>
                  <MyOverview
                      assignments={plannerAssignments}
                      projects={projects}
                      absences={plannerAbsences}
                      employees={employees}
                      holidays={holidays}
                      oneOnOnes={oneOnOnes}
                  />
                </AnimatedPage>
            } />

            <Route path="/my-overview/:employeeId" element={
                <AnimatedPage>
                  <MyOverview
                      assignments={plannerAssignments}
                      projects={projects}
                      absences={plannerAbsences}
                      employees={employees}
                      holidays={holidays}
                      oneOnOnes={oneOnOnes}
                  />
                </AnimatedPage>
            } />

            <Route path="/planner" element={
                <AnimatedPage>
                  <ResourcePlanner
                      key={activeVersion.id}
                      employees={employees}
                      assignments={plannerAssignments}
                      absences={plannerAbsences}
                      projects={projects}
                      holidays={holidays}
                      onAssignmentChange={handleAssignmentChange}
                      onAbsenceChange={handleAbsenceChange}
                      onNavigateToEmployee={handleNavigateToEmployee}
                      initialDate={versionStartDate}
                      readOnly={isPlannerReadOnly}
                  />
                </AnimatedPage>
            } />

            {/* Sales Pipeline Route */}
            {isRole('sales') && (
                <Route path="/sales-pipeline" element={
                    <AnimatedPage>
                        <SalesPipeline
                            projects={projects}
                            onUpdateProjects={handleUpdateProjects}
                        />
                    </AnimatedPage>
                } />
            )}

            {isRole(['pm', 'bl']) && (
                <>
                    <Route path="/forecast" element={
                        <AnimatedPage>
                          <QuarterlyForecast
                              data={forecastData}
                              allProjects={projects}
                              assignments={plannerAssignments}
                              employees={employees}
                              absences={plannerAbsences}
                              holidays={holidays}
                              onUpdateForecast={handleForecastUpdate}
                              onUpdateNotes={handleForecastNotes}
                              readOnly={!isLatestVersion}
                          />
                        </AnimatedPage>
                    } />

                    <Route path="/team" element={
                        <AnimatedPage>
                          <ManageTeam
                              employees={employees}
                              oneOnOnes={oneOnOnes}
                              onUpdateEmployees={handleUpdateEmployees}
                              onUpdateOneOnOnes={handleUpdateOneOnOnes}
                              onNavigateToEmployee={handleNavigateToEmployee}
                              projects={projects}
                              assignments={plannerAssignments}
                          />
                        </AnimatedPage>
                    } />

                    <Route path="/financials" element={
                        <AnimatedPage>
                          <FinancialOverview
                              projects={projects}
                              assignments={plannerAssignments}
                              currentDate={versionStartDate}
                          />
                        </AnimatedPage>
                    } />

                    <Route path="/strategy" element={
                        <AnimatedPage>
                          <StrategyModule
                              projects={projects}
                              assignments={plannerAssignments}
                              goals={goals}
                              northStars={northStars}
                              onUpdateGoals={handleUpdateGoals}
                          />
                        </AnimatedPage>
                    } />
                </>
            )}

            {/* Manage Projects accessible to PM, BL, Sales */}
            {isRole(['pm', 'bl', 'sales']) && (
                <Route path="/projects" element={
                    <AnimatedPage>
                        <ManageProjects
                            projects={projects}
                            onUpdateProjects={handleUpdateProjects}
                            highlightedProjectId={highlightedProjectId}
                        />
                    </AnimatedPage>
                } />
            )}

            <Route path="/customers" element={
                <AnimatedPage>
                  <ManageCustomers
                      customers={customers}
                      projects={projects}
                      assignments={plannerAssignments}
                      onNavigateToProject={handleNavigateToProject}
                      onUpdateCustomers={handleUpdateCustomers}
                  />
                </AnimatedPage>
            } />

            {/* Administration: Admin Only (users, application setup, system monitoring) */}
            {isRole('admin') && (
                <Route path="/admin" element={
                    <AnimatedPage>
                        <AdminArea employees={employees} />
                    </AnimatedPage>
                } />
            )}

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      <CreateVersionDialog
        isOpen={isVersionDialogOpen}
        onClose={() => setIsVersionDialogOpen(false)}
        onCreate={handleCreateVersion}
      />
    </div>
  );
};

/** Gates rendering on the live store's initial load, and surfaces load errors via toast. */
const LiveStoreGate: React.FC = () => {
  const { status, error: storeError } = useLiveStore();
  const { t } = useLanguage();
  const { error: toastError } = useToast();
  const previousStatus = React.useRef(status);

  useEffect(() => {
    if (status === 'error' && previousStatus.current !== 'error') {
      toastError(storeError ?? t('common.loadError'));
    }
    previousStatus.current = status;
  }, [status, storeError, t, toastError]);

  if (status === 'loading') {
    return (
      <FullScreenMessage>
        <AsciiSpinner className="text-2xl mb-2" />
        <span className="text-sm font-medium">{t('common.loading')}</span>
      </FullScreenMessage>
    );
  }

  if (status === 'error') {
    return (
      <FullScreenMessage>
        <span className="text-sm font-medium">{t('common.loadError')}</span>
      </FullScreenMessage>
    );
  }

  return <AppContent />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <LiveStoreProvider>
        <LiveStoreGate />
      </LiveStoreProvider>
    </AuthProvider>
  );
};

export default App;
