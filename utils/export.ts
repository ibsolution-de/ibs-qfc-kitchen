import type { Employee, Project, Assignment, Absence, QuarterData } from '../types';

export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number | undefined): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function assignmentsToCSV(
  employees: Employee[],
  projects: Project[],
  assignments: Assignment[],
  absences: Absence[]
): string {
  const header = 'employee,project,date,allocation_hours,type';
  const employeeMap = new Map(employees.map(e => [e.id, e.name]));
  const projectMap = new Map(projects.map(p => [p.id, p.name]));

  const assignmentRows = assignments.map(a => {
    const employeeName = employeeMap.get(a.employeeId) || a.employeeId;
    const projectName = projectMap.get(a.projectId) || a.projectId;
    const hours = Math.round(a.allocation * 8 * 100) / 100;
    return [employeeName, projectName, a.date, String(hours), 'assignment']
      .map(csvEscape)
      .join(',');
  });

  const absenceRows = absences.map(a => {
    const employeeName = employeeMap.get(a.employeeId) || a.employeeId;
    return [employeeName, '', a.date, '', a.type]
      .map(csvEscape)
      .join(',');
  });

  return [header, ...assignmentRows, ...absenceRows].join('\n');
}

export function forecastToJSON(quarters: QuarterData[]): string {
  return JSON.stringify(quarters, null, 2);
}
