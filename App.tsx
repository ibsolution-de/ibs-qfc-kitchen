

import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ResourcePlanner } from './components/ResourcePlanner';
import { QuarterlyForecast } from './components/QuarterlyForecast';
import { ManageTeam } from './components/ManageTeam';
import { ManageProjects } from './components/ManageProjects';
import { ManageCustomers } from './components/ManageCustomers';
import { FinancialOverview } from './components/FinancialOverview';
import { StrategyModule } from './components/StrategyModule';
import { CreateVersionDialog } from './components/CreateVersionDialog';
import { MyOverview } from './components/MyOverview';
import { SalesPipeline } from './components/SalesPipeline';
import { Assignment, PlanVersion, Project, Employee, Customer, Absence } from './types';
import { MOCK_EMPLOYEES, MOCK_VERSIONS, MOCK_PROJECTS, MOCK_CUSTOMERS } from './constants';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { uid } from './utils/uid';
import { useToday } from './hooks/useToday';

const STORAGE_KEYS = {
  EMPLOYEES: 'ibs_qfc_employees_v3',
  PROJECTS: 'ibs_qfc_projects_v3',
  CUSTOMERS: 'ibs_qfc_customers_v3',
  VERSIONS: 'ibs_qfc_versions_v3'
};

const loadState = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (err) {
    console.warn(`Error loading state for ${key}`, err);
    return fallback;
  }
};

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
  const navigate = useNavigate();
  const location = useLocation();
  
  // State for Global Data - Load from LocalStorage or Fallback to Mocks
  const [employees, setEmployees] = useState<Employee[]>(() => loadState(STORAGE_KEYS.EMPLOYEES, MOCK_EMPLOYEES));
  const [projects, setProjects] = useState<Project[]>(() => loadState(STORAGE_KEYS.PROJECTS, MOCK_PROJECTS));
  const [customers, setCustomers] = useState<Customer[]>(() => loadState(STORAGE_KEYS.CUSTOMERS, MOCK_CUSTOMERS));
  
  // State for versions
  const [versions, setVersions] = useState<PlanVersion[]>(() => loadState(STORAGE_KEYS.VERSIONS, MOCK_VERSIONS));
  
  // Active Version State - ensure we pick valid ID from loaded versions
  const [activeVersionId, setActiveVersionId] = useState<string>(() => {
      const loadedVersions = loadState(STORAGE_KEYS.VERSIONS, MOCK_VERSIONS);
      return loadedVersions.length > 0 ? loadedVersions[loadedVersions.length - 1]!.id : 'v1';
  });

  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  
  // New state for viewing specific employee overview
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Persistence Effects
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees)); }, [employees]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers)); }, [customers]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.VERSIONS, JSON.stringify(versions)); }, [versions]);

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