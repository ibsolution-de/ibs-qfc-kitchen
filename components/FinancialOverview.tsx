import React, { useMemo, useState } from 'react';
import { Project, Assignment, Customer } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { TrendingUp, AlertTriangle, CheckCircle, BarChart3, PieChart, DollarSign, Calendar, TrendingDown, Folder, Search, Filter, ArrowUp, ArrowDown } from 'lucide-react';
import { addMonths, startOfQuarter, endOfMonth } from 'date-fns';
import { PASTEL_VARIANTS } from '../constants';

interface FinancialOverviewProps {
  projects: Project[];
  assignments: Assignment[];
  customers: Customer[];
  currentDate?: Date;
}

type SortField = 'name' | 'budget' | 'plannedCost' | 'margin' | 'marginPercent';
type SortDirection = 'asc' | 'desc';

export const FinancialOverview: React.FC<FinancialOverviewProps> = ({ projects, assignments, customers, currentDate = new Date() }) => {
  const { t } = useLanguage();
  
  // Local State for Table Controls
  const [searchQuery, setSearchQuery] = useState('');
  const [marginFilter, setMarginFilter] = useState<'all' | 'healthy' | 'low' | 'highrisk'>('all');
  const [sortConfig, setSortConfig] = useState<{ field: SortField, direction: SortDirection }>({ field: 'marginPercent', direction: 'asc' });

  const parseBudget = (budgetStr?: string): number => {
    if (!budgetStr) return 0;
    const num = parseFloat(budgetStr.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return 0;
    if (budgetStr.toLowerCase().includes('k')) return num * 1000;
    if (budgetStr.toLowerCase().includes('m')) return num * 1000000;
    return num;
  };

  // 1. Calculate Project Profitability / Margins
  const projectFinancials = useMemo(() => {
    let data = projects.map(p => {
        const budget = parseBudget(p.budget);
        const hourlyRate = p.hourlyRate || 100;
        
        // Calculate total planned days (all time) for this project
        const plannedDays = assignments.filter(a => a.projectId === p.id).reduce((acc, a) => acc + (a.allocation || 1), 0);
        const plannedCost = plannedDays * 8 * hourlyRate;
        
        const margin = budget - plannedCost;
        const marginPercent = budget > 0 ? (margin / budget) * 100 : 0;
        
        return {
            ...p,
            budgetNum: budget,
            plannedCost,
            margin,
            marginPercent
        };
    }).filter(p => p.budgetNum > 0);

    // Filter
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        data = data.filter(p => p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q));
    }

    if (marginFilter !== 'all') {
        data = data.filter(p => {
            if (marginFilter === 'highrisk') return p.marginPercent < 10;
            if (marginFilter === 'low') return p.marginPercent >= 10 && p.marginPercent < 25;
            if (marginFilter === 'healthy') return p.marginPercent >= 25;
            return true;
        });
    }

    // Sort
    data.sort((a, b) => {
        const field = sortConfig.field;
        let valA: any = a[field as keyof typeof a];
        let valB: any = b[field as keyof typeof b];

        // Handle string comparison for names
        if (field === 'name') {
            valA = a.name.toLowerCase();
            valB = b.name.toLowerCase();
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    return data;
  }, [projects, assignments, searchQuery, marginFilter, sortConfig]);

  const totalRevenuePotential = projectFinancials.reduce((sum, p) => sum + p.budgetNum, 0);
  const averageMargin = projectFinancials.length > 0 
    ? projectFinancials.reduce((sum, p) => sum + p.marginPercent, 0) / projectFinancials.length 
    : 0;

  // 2. Revenue Forecast (Next 4 Quarters)
  // Note: We use the *unfiltered* list for the top charts to maintain the big picture view
  const allProjectFinancials = useMemo(() => projects.map(p => {
      const budget = parseBudget(p.budget);
      return { ...p, budgetNum: budget };
  }).filter(p => p.budgetNum > 0), [projects]);

  const quarters = useMemo(() => {
    const startQ = startOfQuarter(currentDate);
    
    const result: {
        name: string;
        start: Date;
        end: Date;
        totalRevenue: number;
        breakdown: Record<string, number>;
    }[] = [0, 1, 2, 3].map(i => {
        const qStart = startOfQuarter(addMonths(startQ, i * 3));
        const qEnd = endOfMonth(addMonths(qStart, 2));
        return {
            name: `Q${Math.floor(qStart.getMonth() / 3) + 1} ${qStart.getFullYear()}`,
            start: qStart,
            end: qEnd,
            totalRevenue: 0,
            breakdown: {} as Record<string, number> // Client -> Revenue
        };
    });

    // Distribute Project Budget across quarters linearly
    allProjectFinancials.forEach(p => {
        if (!p.startDate || !p.endDate) return;
        const pStart = new Date(p.startDate);
        const pEnd = new Date(p.endDate);
        const totalDuration = pEnd.getTime() - pStart.getTime();
        if(totalDuration <= 0) return;

        result.forEach(q => {
            // Calculate overlap
            const overlapStart = new Date(Math.max(pStart.getTime(), q.start.getTime()));
            const overlapEnd = new Date(Math.min(pEnd.getTime(), q.end.getTime()));
            
            if (overlapStart < overlapEnd) {
                const overlapDuration = overlapEnd.getTime() - overlapStart.getTime();
                const ratio = overlapDuration / totalDuration;
                const quarterRevenue = p.budgetNum * ratio;
                
                q.totalRevenue += quarterRevenue;
                q.breakdown[p.client] = (q.breakdown[p.client] || 0) + quarterRevenue;
            }
        });
    });
    return result;
  }, [allProjectFinancials, currentDate]);

  const allClientsInForecast: string[] = Array.from(new Set(quarters.flatMap(q => Object.keys(q.breakdown))));

  // Determine Client Colors based on their projects
  const getClientColorConfig = (clientName: string) => {
      // Find a project for this client to determine color
      const project = projects.find(p => p.client === clientName);
      const colorKey = project?.color || 'gray';
      return PASTEL_VARIANTS[colorKey];
  };

  // Calculate global max revenue for scaling charts, avoid Math.max spread issues on empty array
  const maxQuarterRevenue = useMemo(() => {
    return quarters.reduce((max, q) => Math.max(max, q.totalRevenue), 0) * 1.15;
  }, [quarters]);

  const handleSort = (field: SortField) => {
      setSortConfig(prev => ({
          field,
          direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
      }));
  };

  const SortIcon = ({ field }: { field: SortField }) => {
      if (sortConfig.field !== field) return <ArrowUp className="w-3 h-3 opacity-0 group-hover:opacity-30" />;
      return sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />;
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
            <div>
                <h1 className="text-2xl font-semibold text-charcoal-900 tracking-tight">{t('financials.title')}</h1>
                <p className="text-charcoal-500 mt-1">{t('financials.subtitle')}</p>
            </div>
            <div className="flex gap-4">
                 <div className="bg-white px-4 py-2 rounded-lg border border-charcoal-200 shadow-sm">
                     <div className="text-xs text-charcoal-500 uppercase font-semibold">Total Revenue</div>
                     <div className="text-lg font-bold text-charcoal-900">€{(totalRevenuePotential / 1000).toFixed(1)}k</div>
                 </div>
                 <div className="bg-white px-4 py-2 rounded-lg border border-charcoal-200 shadow-sm">
                     <div className="text-xs text-charcoal-500 uppercase font-semibold">Avg Margin</div>
                     <div className={`text-lg font-bold ${averageMargin >= 20 ? 'text-green-600' : 'text-yellow-600'}`}>
                         {averageMargin.toFixed(1)}%
                     </div>
                 </div>
            </div>
        </div>

        {/* Revenue Forecast Stacked Chart */}
        <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm p-6">
            <div className="flex justify-between items-start mb-6">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-charcoal-600" />
                    {t('financials.revenueForecast')}
                </h3>
                {/* Legend */}
                <div className="flex flex-wrap gap-2 max-w-lg justify-end">
                    {allClientsInForecast.map(client => {
                        const style = getClientColorConfig(client);
                        return (
                            <div key={client} className="flex items-center gap-1.5 text-xs bg-charcoal-50 px-2 py-1 rounded-md border border-charcoal-100">
                                <div className={`w-3 h-3 rounded-full ${style.bg} border ${style.border}`} />
                                <span className="text-charcoal-600 font-medium">{client}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            <div className="flex items-end gap-12 h-72 w-full px-8 pb-4 border-b border-charcoal-200">
                {quarters.map(q => {
                    const maxRevenue = maxQuarterRevenue;
                    const clients = Object.keys(q.breakdown).sort();
                    
                    return (
                        <div key={q.name} className="flex-1 flex flex-col items-center gap-3 group relative h-full justify-end">
                             {/* Floating Tooltip */}
                             <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white text-charcoal-900 text-xs rounded-lg p-3 z-20 w-48 shadow-xl border border-charcoal-200 pointer-events-none transform translate-y-2 group-hover:translate-y-0">
                                 <div className="font-bold border-b border-charcoal-100 pb-2 mb-2 flex justify-between">
                                     <span>{q.name}</span>
                                     <span>€{Math.round(q.totalRevenue/1000)}k</span>
                                 </div>
                                 <div className="space-y-1">
                                     {Object.entries(q.breakdown).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([client, amount]: [string, number]) => {
                                         const style = getClientColorConfig(client);
                                         return (
                                            <div key={client} className="flex justify-between items-center">
                                                <div className="flex items-center gap-1.5">
                                                    <div className={`w-2 h-2 rounded-full ${style.bg} border ${style.border}`} />
                                                    <span>{client}</span>
                                                </div>
                                                <span className="font-mono opacity-80">€{Math.round(amount/1000)}k</span>
                                            </div>
                                         );
                                     })}
                                 </div>
                             </div>

                             {/* Stacked Bar Container */}
                             <div className="w-full relative flex flex-col-reverse justify-start overflow-hidden rounded-t-sm" style={{ height: '100%' }}>
                                 {/* Render Segments */}
                                 {clients.map(client => {
                                     const revenue = q.breakdown[client] || 0;
                                     const heightPercent = maxRevenue > 0 ? (revenue / maxRevenue) * 100 : 0;
                                     const style = getClientColorConfig(client);
                                     
                                     return (
                                         <div 
                                            key={client}
                                            className={`w-full ${style.bg} border-x border-t border-charcoal-900/10 transition-all duration-500 relative first:border-b`}
                                            style={{ height: `${heightPercent}%` }}
                                         />
                                     );
                                 })}
                             </div>
                             
                             <div className="text-center">
                                 <div className="text-sm font-bold text-charcoal-900">€{Math.round(q.totalRevenue / 1000)}k</div>
                                 <div className="text-xs font-medium text-charcoal-500">{q.name}</div>
                             </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Profitability Table */}
        <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm overflow-hidden flex flex-col min-h-0">
             <div className="p-4 border-b border-charcoal-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-charcoal-600" />
                    {t('financials.profitability')}
                </h3>
                
                {/* Filters */}
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                        <input 
                            type="text" 
                            placeholder={t('planner.searchProjects')} 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 pr-3 py-1.5 text-sm border border-charcoal-200 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-charcoal-50/50"
                        />
                    </div>
                    
                    <div className="flex bg-charcoal-50 p-1 rounded-lg border border-charcoal-200">
                        <button 
                            onClick={() => setMarginFilter('all')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${marginFilter === 'all' ? 'bg-white text-charcoal-900 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                        >
                            All
                        </button>
                        <button 
                            onClick={() => setMarginFilter('healthy')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${marginFilter === 'healthy' ? 'bg-white text-green-700 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                        >
                            Healthy
                        </button>
                        <button 
                            onClick={() => setMarginFilter('highrisk')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${marginFilter === 'highrisk' ? 'bg-white text-red-700 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                        >
                            Risk
                        </button>
                    </div>
                </div>
             </div>
             
             <div className="overflow-x-auto">
                 <table className="w-full text-sm text-left">
                     <thead className="bg-charcoal-50 text-charcoal-500 font-medium border-b border-charcoal-200">
                         <tr>
                             <th 
                                className="px-6 py-3 cursor-pointer hover:bg-charcoal-100 group transition-colors"
                                onClick={() => handleSort('name')}
                             >
                                 <div className="flex items-center gap-1">
                                     {t('financials.project')}
                                     <SortIcon field="name" />
                                 </div>
                             </th>
                             <th 
                                className="px-6 py-3 text-right cursor-pointer hover:bg-charcoal-100 group transition-colors"
                                onClick={() => handleSort('budget')}
                             >
                                 <div className="flex items-center justify-end gap-1">
                                     {t('financials.budget')}
                                     <SortIcon field="budget" />
                                 </div>
                             </th>
                             <th 
                                className="px-6 py-3 text-right cursor-pointer hover:bg-charcoal-100 group transition-colors"
                                onClick={() => handleSort('plannedCost')}
                             >
                                 <div className="flex items-center justify-end gap-1">
                                     {t('financials.plannedCost')}
                                     <SortIcon field="plannedCost" />
                                 </div>
                             </th>
                             <th 
                                className="px-6 py-3 text-right cursor-pointer hover:bg-charcoal-100 group transition-colors"
                                onClick={() => handleSort('marginPercent')}
                             >
                                 <div className="flex items-center justify-end gap-1">
                                     {t('financials.margin')}
                                     <SortIcon field="marginPercent" />
                                 </div>
                             </th>
                             <th className="px-6 py-3 text-center">{t('financials.status')}</th>
                         </tr>
                     </thead>
                     <tbody className="divide-y divide-charcoal-100">
                         {projectFinancials.map(p => (
                             <tr key={p.id} className="hover:bg-charcoal-50/50 transition-colors">
                                 <td className="px-6 py-4 font-medium text-charcoal-900">
                                     <div className="flex items-center gap-3">
                                         <Folder className={`w-4 h-4 flex-shrink-0 ${PASTEL_VARIANTS[p.color].text}`} />
                                         <div>
                                            <div>{p.name}</div>
                                            <div className="text-xs text-charcoal-500 font-normal">{p.client}</div>
                                         </div>
                                     </div>
                                 </td>
                                 <td className="px-6 py-4 text-right font-mono">€{p.budgetNum.toLocaleString()}</td>
                                 <td className="px-6 py-4 text-right font-mono text-charcoal-600">€{p.plannedCost.toLocaleString()}</td>
                                 <td className="px-6 py-4 text-right font-mono font-bold">
                                     <span className={p.margin < 0 ? 'text-red-600' : 'text-green-600'}>
                                         {Math.round(p.marginPercent)}%
                                     </span>
                                     <div className="text-xs text-charcoal-400 font-normal">€{p.margin.toLocaleString()}</div>
                                 </td>
                                 <td className="px-6 py-4 text-center">
                                     {p.marginPercent < 10 ? (
                                         <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                             <AlertTriangle className="w-3 h-3" /> {t('financials.highRisk')}
                                         </span>
                                     ) : p.marginPercent < 25 ? (
                                         <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                                             {t('financials.lowMargin')}
                                         </span>
                                     ) : (
                                         <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                             <CheckCircle className="w-3 h-3" /> {t('financials.healthy')}
                                         </span>
                                     )}
                                 </td>
                             </tr>
                         ))}
                         {projectFinancials.length === 0 && (
                             <tr>
                                 <td colSpan={5} className="px-6 py-8 text-center text-charcoal-400 italic">
                                     No projects found matching your criteria.
                                 </td>
                             </tr>
                         )}
                     </tbody>
                 </table>
             </div>
        </div>
      </div>
    </div>
  );
};