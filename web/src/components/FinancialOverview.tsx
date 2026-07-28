import React, { useMemo, useState } from 'react';
import { Project, Assignment } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { AlertTriangle, CheckCircle, BarChart3, PieChart, Folder, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { addMonths, startOfQuarter, endOfMonth } from 'date-fns';
import { PASTEL_VARIANTS, PASTEL_HEX } from '../constants';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { compareBudgets, MARGIN_THRESHOLDS, parseBudget } from '../utils/money';
import { PageHeader } from './ui/PageHeader';

interface FinancialOverviewProps {
  projects: Project[];
  assignments: Assignment[];
  currentDate?: Date;
}

type SortField = 'name' | 'budget' | 'plannedCost' | 'marginPercent';
type SortDirection = 'asc' | 'desc';

export const FinancialOverview: React.FC<FinancialOverviewProps> = ({ projects, assignments, currentDate = new Date() }) => {
  const { t } = useLanguage();
  
  // Local State for Table Controls
  const [searchQuery, setSearchQuery] = useState('');
  const [marginFilter, setMarginFilter] = useState<'all' | 'healthy' | 'low' | 'highrisk'>('all');
  const [sortConfig, setSortConfig] = useState<{ field: SortField, direction: SortDirection }>({ field: 'marginPercent', direction: 'asc' });

  // 1. Calculate Project Profitability / Margins (unfiltered, for KPIs and forecast)
  const allProjectFinancials = useMemo(() => {
    return projects.map(p => {
        const budget = parseBudget(p.budget) ?? 0;
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
  }, [projects, assignments]);

  // 2. Table data: filter + sort the unfiltered financials
  const projectFinancials = useMemo(() => {
    let data = [...allProjectFinancials];

    // Filter
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        data = data.filter(p => p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q));
    }

    if (marginFilter !== 'all') {
        data = data.filter(p => {
            if (marginFilter === 'highrisk') return p.marginPercent < MARGIN_THRESHOLDS.risk;
            if (marginFilter === 'low') return p.marginPercent >= MARGIN_THRESHOLDS.risk && p.marginPercent < MARGIN_THRESHOLDS.healthy;
            if (marginFilter === 'healthy') return p.marginPercent >= MARGIN_THRESHOLDS.healthy;
            return true;
        });
    }

    // Sort
    data.sort((a, b) => {
        const field = sortConfig.field;

        // Handle string comparison for names
        if (field === 'name') {
            const valA = a.name.toLowerCase();
            const valB = b.name.toLowerCase();
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        }

        // Handle budget comparison by parsed numeric value
        if (field === 'budget') {
            return compareBudgets(a.budget, b.budget) * (sortConfig.direction === 'asc' ? 1 : -1);
        }

        const valA = a[field] as number;
        const valB = b[field] as number;
        return (valA - valB) * (sortConfig.direction === 'asc' ? 1 : -1);
    });

    return data;
  }, [allProjectFinancials, searchQuery, marginFilter, sortConfig]);

  const totalRevenuePotential = allProjectFinancials.reduce((sum, p) => sum + p.budgetNum, 0);
  const averageMargin = allProjectFinancials.length > 0 
    ? allProjectFinancials.reduce((sum, p) => sum + p.marginPercent, 0) / allProjectFinancials.length 
    : 0;

  // 3. Revenue Forecast (Next 4 Quarters) — uses the unfiltered financial list
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

  // Transform revenue data for Recharts and map clients to hex colors
  const revenueChartData = useMemo(() => {
    return quarters.map(q => {
      const row: Record<string, number | string> = { name: q.name, total: q.totalRevenue };
      allClientsInForecast.forEach(client => {
        row[client] = q.breakdown[client] || 0;
      });
      return row;
    });
  }, [quarters, allClientsInForecast]);

  const getClientHexColor = (clientName: string) => {
    const project = projects.find(p => p.client === clientName);
    const colorKey = project?.color || 'gray';
    return PASTEL_HEX[colorKey] ?? PASTEL_HEX.gray;
  };

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
        <PageHeader
          title={t('financials.title')}
          subtitle={t('financials.subtitle')}
          actions={
            <>
              <div className="bg-white px-4 py-2 rounded-lg border border-charcoal-200 shadow-sm">
                <div className="text-xs text-charcoal-500 uppercase font-semibold">{t('financials.totalRevenue')}</div>
                <div className="text-lg font-bold text-charcoal-900">€{(totalRevenuePotential / 1000).toFixed(1)}k</div>
              </div>
              <div className="bg-white px-4 py-2 rounded-lg border border-charcoal-200 shadow-sm">
                <div className="text-xs text-charcoal-500 uppercase font-semibold">{t('financials.avgMargin')}</div>
                <div className={`text-lg font-bold ${averageMargin >= MARGIN_THRESHOLDS.healthy ? 'text-green-600' : averageMargin >= MARGIN_THRESHOLDS.risk ? 'text-yellow-600' : 'text-red-600'}`}>
                  {averageMargin.toFixed(1)}%
                </div>
              </div>
            </>
          }
        />

        {/* Revenue Forecast Stacked Chart */}
        <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm p-6">
            <div className="flex justify-between items-start mb-6">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-charcoal-600" />
                    {t('financials.revenueForecast')}
                </h3>
            </div>

            <div
                role="img"
                aria-label={t('financials.revenueForecast')}
                className="h-72 w-full"
            >
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueChartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eceef0" />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#647081' }} />
                        <YAxis
                            tick={{ fontSize: 12, fill: '#647081' }}
                            tickFormatter={(value: number) => `€${Math.round(value / 1000)}k`}
                            width={80}
                        />
                        <Tooltip
                            formatter={(value: any) => [`€${Math.round(value / 1000)}k`, '']}
                            labelStyle={{ color: '#2f333a' }}
                            contentStyle={{ borderRadius: '0.5rem', border: '1px solid #d5d9df' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '1rem' }} />
                        {allClientsInForecast.map(client => (
                            <Bar
                                key={client}
                                dataKey={client}
                                name={client}
                                stackId="a"
                                fill={getClientHexColor(client)}
                                radius={[0, 0, 0, 0]}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <table className="sr-only">
                <caption>{t('accessibility.chartData')}: {t('financials.revenueForecast')}</caption>
                <thead>
                    <tr>
                        <th scope="col">{t('planner.quarter')}</th>
                        <th scope="col">{t('projects.client')}</th>
                        <th scope="col">{t('financials.totalRevenue')}</th>
                    </tr>
                </thead>
                <tbody>
                    {quarters.map(q =>
                        allClientsInForecast.map(client => (
                            <tr key={`${q.name}-${client}`}>
                                <td>{q.name}</td>
                                <td>{client}</td>
                                <td>€{Math.round((q.breakdown[client] || 0) / 1000)}k</td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
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
                            {t('financials.all')}
                        </button>
                        <button 
                            onClick={() => setMarginFilter('healthy')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${marginFilter === 'healthy' ? 'bg-white text-green-700 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                        >
                            {t('financials.healthy')}
                        </button>
                        <button 
                            onClick={() => setMarginFilter('low')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${marginFilter === 'low' ? 'bg-white text-yellow-700 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                        >
                            {t('financials.low')}
                        </button>
                        <button 
                            onClick={() => setMarginFilter('highrisk')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${marginFilter === 'highrisk' ? 'bg-white text-red-700 shadow-sm' : 'text-charcoal-500 hover:text-charcoal-700'}`}
                        >
                            {t('financials.risk')}
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
                                         <Folder className={`w-4 h-4 flex-shrink-0 ${(PASTEL_VARIANTS[p.color] ?? PASTEL_VARIANTS.gray).text}`} />
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
                                     {p.marginPercent < MARGIN_THRESHOLDS.risk ? (
                                         <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                             <AlertTriangle className="w-3 h-3" /> {t('financials.highRisk')}
                                         </span>
                                     ) : p.marginPercent < MARGIN_THRESHOLDS.healthy ? (
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
                                     {t('financials.noProjectsFound')}
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