

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ResourcePlanner } from './components/ResourcePlanner';
import { CreateVersionDialog } from './components/CreateVersionDialog';
import { Assignment, PlanVersion, Project, Employee, Customer, Absence } from './types';
import { MOCK_EMPLOYEES, MOCK_VERSIONS, MOCK_PROJECTS, MOCK_CUSTOMERS } from './constants';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useLanguage } from './contexts/LanguageContext';
import { uid } from './utils/uid';
import { useToday } from './hooks/useToday';
import { useToast } from './components/ui/Toast';
import { AsciiSpinner } from './components/ui/AsciiSpinner';
import { persistence } from './services/persistence/localStorageProvider';

const QuarterlyForecast = React.lazy(() => import('./components/QuarterlyForecast').then(m => ({ default: m.QuarterlyForecast })));
const ManageTeam = React.lazy(() => import('./components/ManageTeam').then(m => ({ default: m.ManageTeam })));
const ManageProjects = React.lazy(() => import('./components/ManageProjects').then(m => ({ default: m.ManageProjects })));
const ManageCustomers = React.lazy(() => import('./components/ManageCustomers').then(m => ({ default: m.ManageCustomers })));
const FinancialOverview = React.lazy(() => import('./components/FinancialOverview').then(m => ({ default: m.FinancialOverview })));
const StrategyModule = React.lazy(() => import('./components/StrategyModule').then(m => ({ default: m.StrategyModule })));
const MyOverview = React.lazy(() => import('./components/MyOverview').then(m => ({ default: m.MyOverview })));
const SalesPipeline = React.lazy(() => import('./components/SalesPipeline').then(m => ({ default: m.SalesPipeline })));

// Animated Page Wrapper
const AnimatedPage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      {children}
    </div>
  );
};

const AppContent: React.FC = () => {
  const { isRole } = useAuth();
  const { t } = useLanguage();
  const { success } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  
  // State for Global Data - Load from LocalStorage or Fallback to Mocks
  const [employees, setEmployees] = useState<Employee[]>(() => persistence.load('employees', MOCK_EMPLOYEES));
  const [projects, setProjects] = useState<Project[]>(() => persistence.load('projects', MOCK_PROJECTS));
  const [customers, setCustomers] = useState<Customer[]>(() => persistence.load('customers', MOCK_CUSTOMERS));
  
  // State for versions
  const [versions, setVersions] = useState<PlanVersion[]>(() => persistence.load('versions', MOCK_VERSIONS));
  
  // Active Version State - ensure we pick valid ID from loaded versions
  const [activeVersionId, setActiveVersionId] = useState<string>(() => {
      const loadedVersions = persistence.load('versions', MOCK_VERSIONS);
      return loadedVersions.length > 0 ? loadedVersions[loadedVersions.length - 1]!.id : 'v1';
  });

  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  
  // New state for viewing specific employee overview
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Persistence Effects
  useEffect(() => { persistence.save('employees', employees); }, [employees]);
  useEffect(() => { persistence.save('projects', projects); }, [projects]);
  useEffect(() => { persistence.save('customers', customers); }, [customers]);
  useEffect(() => { persistence.save('versions', versions); }, [versions]);

  const latestVersion = versions[versions.length - 1] ?? MOCK_VERSIONS[MOCK_VERSIONS.length - 1]!;
  const isLatestVersion = activeVersionId === latestVersion.id;

  const activeVersion = useMemo(() => {
    return versions.find(v => v.id === activeVersionId) || latestVersion;
  }, [versions, activeVersionId, latestVersion]);

  const plannerAssignments = activeVersion.assignments;
  const plannerAbsences = activeVersion.absences || [];
  const forecastData = activeVersion.forecastData;

  const versionStartDate = useToday();

  const handleAssignmentChange = (newAssignments: Assignment[]) => {
    if (!isLatestVersion) {
      console.warn('handleAssignmentChange: active version is read-only, ignoring update');
      return;
    }
    setVersions(prev => {
        const vIndex = prev.findIndex(v => v.id === activeVersionId);
        if (vIndex === -1) return prev;
        const newVersions = [...prev];
        newVersions[vIndex] = {
            ...newVersions[vIndex]!,
            assignments: newAssignments
        };
        return newVersions;
    });
  };

  const handleAbsenceChange = (newAbsences: Absence[]) => {
    if (!isLatestVersion) {
      console.warn('handleAbsenceChange: active version is read-only, ignoring update');
      return;
    }
    setVersions(prev => {
        const vIndex = prev.findIndex(v => v.id === activeVersionId);
        if (vIndex === -1) return prev;
        const newVersions = [...prev];
        newVersions[vIndex] = {
            ...newVersions[vIndex]!,
            absences: newAbsences
        };
        return newVersions;
    });
  };

  const handleCreateVersion = (name: string, description: string) => {
    const newVersion: PlanVersion = {
        id: uid(),
        name: name,
        description: description,
        createdAt: new Date().toISOString(),
        assignments: [...plannerAssignments],
        absences: [...plannerAbsences],
        forecastData: JSON.parse(JSON.stringify(forecastData))
    };
    
    // We deep clone forecast data to ensure the new version is independent
    setVersions(prev => [...prev, newVersion]);
    setActiveVersionId(newVersion.id);
    success(t('toast.versionCreated'));
  };

  const handleForecastUpdate = (quarterId: string, type: 'mustWin' | 'alternative', updatedProjects: Project[]) => {
    setVersions(prev => {
        const newVersions = [...prev];
        const vIndex = newVersions.findIndex(v => v.id === activeVersionId);
        if (vIndex === -1) return prev;
        const version = { ...newVersions[vIndex]! };
        const newForecastData = version.forecastData.map(q => {
            if (q.id === quarterId) {
                return {
                    ...q,
                    [type === 'mustWin' ? 'mustWinOpportunities' : 'alternativeOpportunities']: updatedProjects
                };
            }
            return q;
        });
        version.forecastData = newForecastData;
        newVersions[vIndex] = version;
        return newVersions;
    });
  };

  const handleNavigateToProject = (projectId: string) => {
    setHighlightedProjectId(projectId);
    navigate('/projects');
  };

  const handleNavigateToEmployee = (employeeId: string) => {
      setSelectedEmployeeId(employeeId);
      navigate('/my-overview');
  };

  // Determine ReadOnly state for Planner
  // Read Only if: Not Latest Version OR User is Employee
  const isPlannerReadOnly = !isLatestVersion || isRole('employee');

  // Reset Highlight effects when navigating away from specific views
  useEffect(() => {
      if (location.pathname !== '/projects') {
          setHighlightedProjectId(null);
      }
      if (location.pathname !== '/my-overview') {
          setSelectedEmployeeId(null);
      }
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-charcoal-50 text-charcoal-800 font-sans selection:bg-blue-100 selection:text-blue-900 overflow-hidden">
      <Sidebar 
        versions={versions}
        activeVersionId={activeVersionId}
        onSelectVersion={setActiveVersionId}
        onCreateVersion={() => setIsVersionDialogOpen(true)}
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
            <Route path="/" element={<Navigate to={isRole('employee') ? '/my-overview' : (isRole('sales') ? '/sales-pipeline' : '/planner')} replace />} />
            
            <Route path="/my-overview" element={
                <AnimatedPage>
                  <MyOverview 
                      assignments={plannerAssignments}
                      projects={projects}
                      absences={plannerAbsences}
                      employees={employees}
                      targetEmployeeId={selectedEmployeeId}
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
                            onUpdateProjects={setProjects}
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
                              onUpdateForecast={handleForecastUpdate}
                              readOnly={!isLatestVersion}
                          />
                        </AnimatedPage>
                    } />

                    <Route path="/team" element={
                        <AnimatedPage>
                          <ManageTeam 
                              employees={employees}
                              onUpdateEmployees={setEmployees}
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
                            onUpdateProjects={setProjects}
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
                      onUpdateCustomers={setCustomers}
                  />
                </AnimatedPage>
            } />
            
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

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;