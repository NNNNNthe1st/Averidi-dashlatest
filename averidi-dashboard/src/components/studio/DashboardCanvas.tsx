'use client';
import {salesContrastPreference,saveSalesContrast} from '../sales/sales-accessibility';
import SalesInsights from '../sales/SalesInsights';
import { useEffect, useState, useRef, type CSSProperties, type DragEvent, type PointerEvent } from 'react';
import { addDashboardWidget, type DashboardWidgetKind, type DashboardConfig } from '../../engines/generation/dashboard-templates';
import type { DashboardAnalysis, AnalysisQuery } from '../../engines/analysis/pipeline';
import type { DashboardWidgetData } from '../../engines/visualization/widgets';
import SourceQualitySummary from '../data/SourceQualitySummary';
import type { SourceQualityAssessment } from '../../features/data-model/source-quality';
import type { DashboardTargetAnnotations } from '../../features/monitoring/contracts';
import DashboardLayoutEditor, { useDashboardLayout } from './DashboardLayoutEditor';
import { positionWidget } from '../../features/views/layout';
import { useWorkspaceRole, useWorkspacePermission } from '../workspace/WorkspacePermissions';
import styles from './DashboardCanvas.module.css';
import SalesDashboard from '../sales/SalesDashboard';
import CategoryDonut from './CategoryDonut';
import type { SalesDashboardData } from '../sales/contracts';
import { dashboardAuthenticatedFetch } from '../../lib/dashboard-authenticated-fetch';
import DashboardExploration from './DashboardExploration';
import { chartDrilldownQuery } from '../../engines/visualization/drilldown';
import ComparisonControls, { comparisonMessage } from './ComparisonControls';
import { useWorkspacePresentation, formatWorkspaceDate } from '../workspace/WorkspacePresentation';
export default function DashboardCanvas({ workspaceId, viewId, updatedAt, reloadKey, sourceVersionId, definition, onDefinitionChange, onRefreshed, hasUnsavedChanges, onLayoutDirtyChange, layoutResetKey, readOnly = false, viewOnly = false }: {
    workspaceId: string;
    viewId: string;
    updatedAt: string;
    reloadKey: number;
    sourceVersionId: string | null;
    definition: DashboardConfig;
    onDefinitionChange: (definition: DashboardConfig) => void;
    onRefreshed: () => void;
    hasUnsavedChanges: boolean;
    onLayoutDirtyChange: (dirty: boolean) => void;
    layoutResetKey: number;
    readOnly?: boolean;
    viewOnly?: boolean;
}) {
    const api = `/dashboard/app/api/workspaces/${encodeURIComponent(workspaceId)}/views/${encodeURIComponent(viewId)}`;
    const workspaceRole = useWorkspaceRole();
    const canExport = useWorkspacePermission('views.export');
    const canSeeData = useWorkspacePermission('datasets.read'), canSeeAnalysis = useWorkspacePermission('analysis.read'), canSeeReports = useWorkspacePermission('reports.read'), canSeeMonitoring = useWorkspacePermission('monitoring.read');
    const presentation = useWorkspacePresentation();
    const layout = useDashboardLayout(api, updatedAt + ':' + layoutResetKey, onRefreshed, onLayoutDirtyChange, definition.template !== 'SALES'), canEdit = useWorkspacePermission('views.manage') && !readOnly;
    const gridRef = useRef<HTMLDivElement>(null), resizing = useRef<{
        widgetId: string;
        pointerId: number;
        startX: number;
        startY: number;
    } | null>(null), resizeDragged = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const activePage = layout.document?.pages.find(p => p.id === layout.selected);
    const editingLayout = canEdit && layout.editing && !layout.loading && !layout.saving && !hasUnsavedChanges;
    const [dimensions, setDimensions] = useState<DashboardAnalysis['dimensions']>([]);
    const [showRows, setShowRows] = useState(false);
    const salesQueryBeforeDrill = useRef<AnalysisQuery | null>(null);
    const [newMetric, setNewMetric] = useState(''), [newKind, setNewKind] = useState<DashboardWidgetKind>('KPI'), [newDimension, setNewDimension] = useState('');
    const [data, setData] = useState<(SalesDashboardData & {
        targets?: DashboardTargetAnnotations;
        qualityAssessment?: SourceQualityAssessment;
    }) | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [query, setQuery] = useState<AnalysisQuery>({ filters: [], compare: false });
    const [salesHighContrast,setSalesHighContrast]=useState(false);useEffect(()=>setSalesHighContrast(salesContrastPreference()),[]);
    const [salesBreakdowns,setSalesBreakdowns]=useState<import('../../engines/sales/hierarchy').SalesBreakdowns>({}),[salesDetails,setSalesDetails]=useState(false);
    const salesSourceBinding=useRef(sourceVersionId+':'+viewId);
    useEffect(()=>{const binding=sourceVersionId+':'+viewId;if(definition.template==='SALES'&&salesSourceBinding.current!==binding){setQuery({filters:[],compare:false});setSalesBreakdowns({});setShowRows(false);setSalesDateStart('');setSalesDateEnd('');}salesSourceBinding.current=binding;},[sourceVersionId,viewId,definition.template]);
    const [retryRevision, setRetryRevision] = useState(0);
    const [missingOnly, setMissingOnly] = useState(false);
    const [field, setField] = useState(''), [value, setValue] = useState(''), [end, setEnd] = useState(''), [compare, setCompare] = useState(false), [exporting, setExporting] = useState(false);
    const [salesDateStart, setSalesDateStart] = useState(''), [salesDateEnd, setSalesDateEnd] = useState('');
    const salesDateDimension = dimensions.find(d => d.role === 'DATE');
    const salesFilterDimensions = [{ concept: 'GEOGRAPHY', label: 'Region' }, { concept: 'CATEGORY', label: 'Category' }, { concept: 'CUSTOMER_SEGMENT', label: 'Segment' }] as const;
    function selectSalesDimension(concept: typeof salesFilterDimensions[number]['concept'], selected: string) {
        const dimension = dimensions.find(d => d.field===salesBreakdowns[concept as 'GEOGRAPHY'|'CATEGORY'])??dimensions.find(d => d.concept === concept && d.role === 'DIMENSION');
        if(selected==='::clear:'){const fields=data?.hierarchy?.[concept as 'GEOGRAPHY'|'CATEGORY']?.map(d=>d.field)??[];setQuery(q=>({...q,filters:q.filters.filter(f=>!fields.includes(f.field))}));return;}
        if (!dimension)
            return;
        setError('');
        setQuery(previous => ({ ...previous, filters: [...previous.filters.filter(item => item.field !== dimension.field), ...(selected ? [{ type: 'CATEGORY' as const, field: dimension.field, value: selected }] : [])] }));
    }
    function applySalesDateRange(start = salesDateStart, through = salesDateEnd) {
        if (!salesDateDimension)
            return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(through) || start > through) {
            setError('Choose a valid start and end date in chronological order.');
            return;
        }
        setSalesDateStart(start);
        setSalesDateEnd(through);
        setError('');
        setQuery(({ comparison: _comparison, ...previous }) => ({ ...previous, filters: [...previous.filters.filter(item => item.type !== 'DATE_RANGE'), { type: 'DATE_RANGE', field: salesDateDimension.field, value: start, end: through }], compare: true }));
    }
    function clearSalesDateRange() { setSalesDateStart(''); setSalesDateEnd(''); setError(''); setQuery(({ comparison: _comparison, ...previous }) => ({ ...previous, filters: previous.filters.filter(item => item.type !== 'DATE_RANGE'), compare: false })); }
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        setLoading(true);
        setData(null);
        setError('');
        dashboardAuthenticatedFetch(api + '/data', { method: 'POST', headers: { 'Content-Type': 'application/json',...(definition.template==='SALES'?{'X-Sales-Breakdowns':JSON.stringify(salesBreakdowns)}:{}) }, body: JSON.stringify(query), signal: controller.signal }).then(async (r) => {
            const b = await r.json();
            if (!r.ok)
                throw Error(b.error);
            if (active) {
                setData(b);
                setDimensions(b.analysis.dimensions);
            }
        }).catch(e => {
            if (active)
                setError(e.message === 'STALE_ANALYSIS' ? 'This dashboard uses an older dataset or confirmation. Calculate metrics and create a dashboard for the current version.' : comparisonMessage(e.message));
        }).finally(() => {
            if (active)
                setLoading(false);
        });
        return () => { active = false; controller.abort(); };
    }, [api, updatedAt, query, reloadKey, sourceVersionId, retryRevision, salesBreakdowns]);
    async function refreshData() {
        setLoading(true);
        setError('');
        try {
            const r = await dashboardAuthenticatedFetch(api + '/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedUpdatedAt: updatedAt }) });
            if (!r.ok) {
                const b = await r.json();
                throw Error(b.error);
            }
            onRefreshed();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Refresh failed.');
        }
        finally {
            setLoading(false);
        }
    }
    async function download() {
        setExporting(true);
        try {
            const r = await dashboardAuthenticatedFetch(api + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
            if (!r.ok) {
                const b = await r.json();
                throw Error(b.error);
            }
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement('a');
            a.href = url;
            a.download = 'dashboard-metrics.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Export failed.');
        }
        finally {
            setExporting(false);
        }
    }
    const dim = dimensions.find(d => d.field === field);
    function apply() {
        if (!field) {
            setQuery({ filters: [], compare: false });
            return;
        }
        if (missingOnly) {
            setQuery({ filters: [{ type: 'MISSING', field, value: '' }], compare: false });
            return;
        }
        if (!value || dim?.role === 'DATE' && !end) {
            setError('Choose a filter value and both dates for a date range.');
            return;
        }
        setQuery({ filters: [{ type: dim?.role === 'DATE' ? 'DATE_RANGE' : 'CATEGORY', field, value, ...(dim?.role === 'DATE' ? { end } : {}) }], compare: dim?.role === 'DATE' && compare });
    }
    function formatted(value: number | null, metric: DashboardAnalysis['outcomes'][number]) { return value === null ? 'Unavailable' : new Intl.NumberFormat(presentation?.locale ?? 'en-US', metric.definition.format === 'CURRENCY' && metric.lineage.currency ? { style: 'currency', currency: metric.lineage.currency } : metric.definition.format === 'PERCENT' ? { style: 'percent', maximumFractionDigits: 2 } : { maximumFractionDigits: 4 }).format(value) + (metric.lineage.unit ? (metric.definition.format === 'CURRENCY' ? ' / ' + metric.lineage.unit : metric.definition.format === 'COUNT' ? ' ' + metric.lineage.unit : '') : ''); }
    function drilldown(dimensionField: string | undefined, label: string, missing: boolean) {
        try {
            const dimension = dimensions.find(item => item.field === dimensionField);
            if (!dimension)
                throw Error('This field is unavailable for exploration.');
            if (definition.template === 'SALES' && !showRows) salesQueryBeforeDrill.current = query;
            setQuery(chartDrilldownQuery(query, dimension.field, dimension.role, label, missing));
            setShowRows(true);
            setError('');
        }
        catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to inspect this group.');
        }
    }
    function cell(grid: HTMLDivElement, clientX: number, clientY: number, offsetX = 0, offsetY = 0) {
        const bounds = grid.getBoundingClientRect(), computed = getComputedStyle(grid), gap = parseFloat(computed.gap) || 16, pitch = (bounds.width + gap) / 12;
        if (computed.display !== 'grid')
            throw Error('Use the layout controls on narrow screens.');
        const x = Math.max(0, Math.min(11, Math.floor((clientX - bounds.left - offsetX) / pitch))), point = clientY - bounds.top - offsetY, rows = computed.gridTemplateRows.split(' ').map(Number.parseFloat);
        let y = 0, top = 0;
        while (y < rows.length && top + rows[y] + gap <= point) {
            top += rows[y] + gap;
            y++;
        }
        if (y >= rows.length && point > top)
            y += Math.floor((point - top) / (40 + gap));
        return { x, y: Math.max(0, Math.min(999, y)) };
    }
    function finishResize(event: PointerEvent<HTMLButtonElement>) {
        const current = resizing.current;
        if (!current || current.pointerId !== event.pointerId || !gridRef.current || !activePage)
            return;
        resizing.current = null;
        event.stopPropagation();
        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            if (!resizeDragged.current)
                return;
            const p = activePage.widgets.find(w => w.widgetId === current.widgetId);
            if (!p)
                return;
            const { x, y } = cell(gridRef.current, event.clientX, event.clientY);
            layout.change(pages => positionWidget(pages, activePage.id, { ...p, width: Math.max(2, Math.min(12 - p.x, x - p.x + 1)), height: Math.max(2, Math.min(12, y - p.y + 1)) }));
        }
        catch (e) {
            layout.setError(e instanceof Error ? e.message : 'Unable to resize this widget.');
        }
    }
    function drop(event: DragEvent<HTMLDivElement>) {
        if (!editingLayout || !activePage)
            return;
        event.preventDefault();
        try {
            const payload = JSON.parse(event.dataTransfer.getData('application/averidi-layout'));
            const placement = activePage.widgets.find(w => w.widgetId === payload.widgetId);
            if (!placement)
                return;
            const { x, y } = cell(event.currentTarget, event.clientX, event.clientY, Number(payload.offsetX) || 0, Number(payload.offsetY) || 0);
            const next = payload.operation === 'RESIZE' ? { ...placement, width: Math.max(2, Math.min(12 - placement.x, x - placement.x + 1)), height: Math.max(2, Math.min(12, y - placement.y + 1)) } : { ...placement, x: Math.min(x, 12 - placement.width), y };
            layout.change(pages => positionWidget(pages, activePage.id, next));
        }
        catch {
            layout.setError('Unable to move this widget. Use the layout controls.');
        }
    }
    const dashboardTools = <>
  <SourceQualitySummary assessment={data?.qualityAssessment} label="Dashboard source quality"/>
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
   <label>Filter by<select aria-label="Filter by" value={field} onChange={e => { setField(e.target.value); setValue(''); setEnd(''); setMissingOnly(false); }}><option value="">All records</option>{dimensions.map(d => <option key={d.field} value={d.field}>{d.field}</option>)}</select></label>
   {field ? <label><input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)}/>Missing values only</label> : null}
   {field && !missingOnly ? <label>{dim?.role === 'DATE' ? 'From' : 'Value'}<input type={dim?.role === 'DATE' ? 'date' : 'text'} value={value} onChange={e => setValue(e.target.value)} maxLength={512}/></label> : null}
   {dim?.role === 'DATE' && !missingOnly ? <><label>Through<input type="date" value={end} onChange={e => setEnd(e.target.value)}/></label><label><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)}/>Compare previous period</label></> : null}
   <button type="button" disabled={loading} onClick={apply}>Apply filter</button><button type="button" disabled={loading} onClick={() => { setField(''); setMissingOnly(false); setQuery({ filters: [], compare: false }); }}>Clear filters</button>
   <button type="button" disabled={loading || hasUnsavedChanges || layout.dirty || !canEdit} onClick={refreshData}>Use latest calculated data</button>
   {definition.template !== 'SALES' ? <button type="button" disabled={!canExport || !data || loading || exporting} onClick={download}>{exporting ? 'Exporting…' : 'Download metric report'}</button> : null}
  </div>
  {query.filters.length ? <section aria-label="Selected filters" style={{ overflowWrap: 'anywhere' }}><p>Selected filters: {query.filters.map(filter => filter.type === 'MISSING' ? `${filter.field}: missing values` : filter.type === 'DATE_RANGE' ? `${filter.field}: ${filter.value} through ${filter.end}` : `${filter.field}: ${JSON.stringify(filter.value)}`).join('; ')}{query.comparison?.through ? `. Data observed through ${query.comparison.through}.` : null}</p></section> : null}
  <details style={{ marginTop: 18, padding: 14, border: "1px solid var(--av-border,#ccd9e5)", borderRadius: 12, background: "#fff" }}><summary style={{ fontWeight: 700, cursor: "pointer" }}>Advanced dashboard tools</summary><p style={{ color: "var(--av-muted,#526779)" }}>Comparisons, layout customization, data exploration, and additional widgets are available here.</p>
  <ComparisonControls query={query} onChange={setQuery} disabled={loading}/>
  {data?.analysis.comparisonPeriods ? <section aria-label="Applied comparison"><p>Current: {data.analysis.comparisonPeriods.current.start} through {data.analysis.comparisonPeriods.current.end} ({data.analysis.comparisonPeriods.currentDays} days). Comparison: {data.analysis.comparisonPeriods.previous.start} through {data.analysis.comparisonPeriods.previous.end} ({data.analysis.comparisonPeriods.previousDays} days).</p>{data.analysis.comparisonPeriods.partial ? <p>Both periods use the same elapsed number of observed days.</p> : null}{data.analysis.comparisonPeriods.overlap ? <p role="status">The selected comparison overlaps the current period.</p> : null}</section> : null}
  <DashboardLayoutEditor readOnly={readOnly} layout={layout} definition={definition} locked={hasUnsavedChanges}/>
  <DashboardExploration api={api} query={query} onQuery={setQuery} showRows={showRows} onShowRows={setShowRows} revision={updatedAt + ':' + reloadKey + ':' + sourceVersionId}/>
  {data ? <details style={{ marginTop: 12 }}><summary>Add a widget</summary><label>Metric<select aria-label="Metric" value={newMetric} onChange={e => setNewMetric(e.target.value)}><option value="">Choose a metric</option>{data.analysis.outcomes.filter(m => m.status === 'READY').map(m => <option key={m.key} value={m.key}>{m.definition.label}</option>)}</select></label><label>Presentation<select aria-label="Presentation" value={newKind} onChange={e => setNewKind(e.target.value as DashboardWidgetKind)}>{['KPI', 'BAR', 'LINE', 'TABLE', 'HORIZONTAL_BAR'].map(k => <option key={k}>{k}</option>)}</select></label>{newKind !== 'KPI' ? <label>Group by<select aria-label="Group by" value={newDimension} onChange={e => setNewDimension(e.target.value)}><option value="">Choose a field</option>{dimensions.filter(d => newKind === 'LINE' ? d.role === 'DATE' : ['BAR', 'HORIZONTAL_BAR'].includes(newKind) ? d.role === 'DIMENSION' : true).map(d => <option key={d.field}>{d.field}</option>)}</select></label> : null}<button type="button" disabled={!canEdit || layout.dirty || !newMetric || definition.widgets.length >= 30} onClick={() => {
                try {
                    onDefinitionChange(addDashboardWidget(definition, newMetric as Parameters<typeof addDashboardWidget>[1], newKind, newDimension || undefined, data.analysis.outcomes, dimensions.map(d => d.field)));
                    setError('');
                }
                catch (e) {
                    setError(e instanceof Error ? e.message : 'Unable to add widget.');
                }
            }}>Add widget</button><p>Save changes to calculate the new widget.</p></details> : null}
  </details>
 </>;
    if (definition.template === 'SALES')
        return <><SalesDashboard highContrast={salesHighContrast} workspaceId={workspaceId} data={data} query={query} loading={loading} exporting={exporting} error={error} role={workspaceRole} canExport={canExport} canSeeData={canSeeData} canSeeAnalysis={canSeeAnalysis} canSeeReports={canSeeReports} canSeeMonitoring={canSeeMonitoring} locale={presentation?.locale} onDetails={()=>setSalesDetails(true)} onBreakdown={(concept,field)=>{const levels=data?.hierarchy?.[concept]??[];const at=levels.findIndex(d=>d.field===field),current=levels.findIndex(d=>d.field===(salesBreakdowns[concept]??data?.widgets.find(w=>w.id===(concept==='GEOGRAPHY'?'sales-region-map':'sales-revenue-category'))?.dimensionField));if(at>=0&&at<current){const children=levels.slice(at+1).map(d=>d.field);setQuery(q=>({...q,filters:q.filters.filter(f=>!children.includes(f.field))}));}setSalesBreakdowns(b=>({...b,[concept]:field}));}} onDimension={selectSalesDimension} onDates={applySalesDateRange} onClearDates={clearSalesDateRange} onExport={download} onRetry={() => setRetryRevision(value => value + 1)} onDrilldown={drilldown}/>{salesDetails?<SalesInsights highContrast={salesHighContrast} onContrastChange={value=>{setSalesHighContrast(value);saveSalesContrast(value);}} setupUrl={canSeeAnalysis?`/dashboard/app/workspaces/${encodeURIComponent(workspaceId)}/studio?sales=1&view=${encodeURIComponent(viewId)}&review=1`:undefined} onChangeFilters={clear=>{setSalesDetails(false);if(clear){setQuery({filters:[],compare:false});setSalesBreakdowns({});}else requestAnimationFrame(()=>document.querySelector('[data-sales-dashboard]')?.shadowRoot?.querySelector<HTMLButtonElement>('.filter.date')?.click());}} canExport={canExport} onExport={download} data={data} locale={presentation?.locale} onClose={()=>setSalesDetails(false)}/>:null}{showRows ? <section aria-label="Selected sales records" style={{ padding: 16 }}><button type="button" onClick={() => {setShowRows(false);if(salesQueryBeforeDrill.current){setQuery(salesQueryBeforeDrill.current);salesQueryBeforeDrill.current=null;}}}>Close selected records</button><DashboardExploration api={api} query={query} onQuery={setQuery} showRows={showRows} onShowRows={setShowRows} revision={updatedAt + ':' + reloadKey + ':' + sourceVersionId}/></section> : null}</>;
    return <section className="av-dashboard-results" aria-label="Dashboard results"><div className={undefined}>
 <div className={undefined}>
  {<h2>{definition.name}</h2>}
  {!viewOnly ? dashboardTools : null}
  {loading ? <p role="status">Calculating dashboard…</p> : null}{error ? <p role="alert">{error}</p> : null}
  {data ? <>{<p>{data.analysis.quality.selectedRows} selected source rows</p>}<div ref={gridRef} role="group" aria-label="Dashboard widget grid" className={layout.document?.customized ? styles.customGrid : undefined} style={layout.document?.customized ? (editingLayout ? { minHeight: 480 } : undefined) : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }} onDragOver={e => {
                if (editingLayout)
                    e.preventDefault();
            }} onDrop={drop}>
  {[...definition.widgets].filter(w => w.visible && (activePage?.widgets.some(p => p.widgetId === w.id))).sort((a, b) => a.order - b.order).map(widget => {
                const w = data.widgets.find(w => w.id === widget.id);
                if (!w)
                    return <p key={widget.id}>Save changes to load {widget.title}.</p>;
                const matchingTargets = data.targets?.items.filter(target => target.metricKey === w.metricKey) ?? [];
                const comparison = data.analysis.comparison?.[w.metricKey];
                const finite = w.series.filter(p => p.value !== null);
                const max = Math.max(1, ...finite.map(p => Math.abs(p.value!)));
                const placement = activePage?.widgets.find(p => p.widgetId === w.id);
                return <article key={w.id} data-widget-id={widget.id} className={`${styles.card} ${''}`} draggable={editingLayout} onPointerDown={e => { const bounds = e.currentTarget.getBoundingClientRect(); dragOffset.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top }; }} onDragStart={e => { e.dataTransfer.setData('application/averidi-layout', JSON.stringify({ widgetId: w.id, operation: 'MOVE', offsetX: dragOffset.current.x, offsetY: dragOffset.current.y })); }} style={{ '--column': (placement?.x ?? 0) + 1, '--row': (placement?.y ?? 0) + 1, '--width': placement?.width ?? 4, '--height': placement?.height ?? 3, ...({ border: '1px solid #ccd4de', borderRadius: 10, padding: 18 }) } as CSSProperties}><div style={undefined}><h3 className={undefined}>{widget.title}</h3>{null}</div>{editingLayout ? <button type="button" className={styles.resizeHandle} style={{ cursor: 'nwse-resize', touchAction: 'none' }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); resizeDragged.current = false; resizing.current = { widgetId: w.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => {
                            const start = resizing.current;
                            if (start && start.pointerId === e.pointerId && (Math.abs(e.clientX - start.startX) > 3 || Math.abs(e.clientY - start.startY) > 3))
                                resizeDragged.current = true;
                        }} onPointerUp={finishResize} onPointerCancel={() => { resizing.current = null; }} onClick={e => {
                            if (e.detail === 0 || !resizeDragged.current)
                                document.getElementById('layout-' + widget.id + '-width')?.focus();
                        }} aria-label={'Resize ' + widget.title}>Resize {widget.title}</button> : null}
   {widget.kind === 'KPI' ? <p className={undefined} style={{ fontSize: 28, fontWeight: 700 }}>{formatted(w.outcome.value, w.outcome)}</p> : null}
   {widget.kind === 'KPI' && matchingTargets.length ? <section aria-label={'Matching targets for ' + widget.title}><h4>Matching targets</h4><ul>{matchingTargets.slice(0, 3).map(target => <li key={target.id}><strong>{target.name}</strong>: <span title={'Exact target value: ' + target.value}>{formatted(Number(target.value), w.outcome)}</span>{target.pace ? <p><strong>{target.pace.label}</strong> — {target.pace.description}{target.pace.expected !== null ? <> Expected by this observation date: {formatted(target.pace.expected, w.outcome)}.</> : null}</p> : null}<p>Full target period: {target.start} through {target.through}.{target.observedThrough !== target.through ? ` Current metric observed through ${target.observedThrough}.` : ''}</p></li>)}</ul><p>These goals match the dataset, metric definition, currency and full selected period. Pace appears only with an explicitly chosen direction and supported pacing policy.</p><a href={'/dashboard/app/workspaces/' + encodeURIComponent(workspaceId) + '/monitoring'}>{matchingTargets.length > 3 || data.targets?.hasMore ? 'Review all matching targets' : 'Review targets'}</a></section> : null}
   {w.outcome.reason ? <p>{w.outcome.reason}</p> : null}
   {widget.kind === 'LINE' && w.series.some(p => p.missing) ? <p>Missing dates are listed in the table. Correct them to display a time-series chart.</p> : null}
   {widget.kind === 'LINE' && !w.series.some(p => p.missing) && finite.length > 1 && finite.length === w.series.length ? <svg role="img" aria-label={`${widget.title} over ${widget.dimensionField}`} viewBox="0 0 300 110"><polyline fill="none" stroke="#245b88" strokeWidth="2" points={finite.map((p, i) => `${10 + i * 280 / Math.max(1, finite.length - 1)},${55 - p.value! / max * 45}`).join(' ')}/></svg> : null}
   {widget.kind === 'DONUT' ? <CategoryDonut points={w.series} formatValue={value => formatted(value, w.outcome)}/> : null}
   {widget.kind === 'BAR' && finite.length > 0 ? <svg role="img" aria-label={`${widget.title} by ${widget.dimensionField}; exact values in table`} viewBox="0 0 300 120"><line x1="0" x2="300" y1="60" y2="60" stroke="#536376"/>{finite.map((p, i) => <rect key={p.groupKey} x={i * 300 / finite.length + 2} y={p.value! >= 0 ? 60 - p.value! / max * 50 : 60} width={Math.max(1, 300 / finite.length - 4)} height={Math.abs(p.value!) / max * 50} fill="#245b88"><title>{p.label}: {formatted(p.value, w.outcome)}</title></rect>)}</svg> : null}
   {widget.kind !== 'KPI' ? <table><thead><tr><th scope="col">{widget.dimensionField}</th><th scope="col">{widget.title}</th></tr></thead><tbody>{w.series.map(p => <tr key={p.groupKey}><th scope="row"><button type="button" disabled={loading} aria-label={p.missing ? `Inspect ${widget.title}: Missing value (empty source cell) in ${widget.dimensionField}` : `Inspect ${widget.title}: ${p.label}`} onClick={() => drilldown(widget.dimensionField, p.label, p.missing)}>{p.missing ? 'Missing value (empty source cell)' : p.label}</button></th><td>{widget.kind === 'HORIZONTAL_BAR' && p.value !== null ? <span aria-hidden="true" style={{ display: 'inline-block', width: `${Math.abs(p.value) / max * 80}px`, height: 8, background: '#245b88', marginRight: 6 }}/> : null}{formatted(p.value, w.outcome)}{p.reason ? <small> {p.reason}</small> : null}</td></tr>)}</tbody></table> : null}
   {comparison ? <p>Previous: {formatted(comparison.previous, w.outcome)} · Change: {comparison.percentage === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(comparison.percentage)}</p> : null}
   {<p>Source processed: {w.outcome.lineage.refreshedAt ? formatWorkspaceDate(w.outcome.lineage.refreshedAt, presentation) : 'Unavailable'}. Metrics calculated: {w.outcome.lineage.calculatedAt ? formatWorkspaceDate(w.outcome.lineage.calculatedAt, presentation) : 'Unavailable'}.</p>}
   <details><summary>Calculation details</summary>{null}<p>{w.outcome.definition.description}</p><p>{w.outcome.definition.formula}</p><p>Source fields: {w.outcome.lineage.fields.join(', ')}</p><p>Dataset version: {w.outcome.lineage.datasetVersionId}</p><p>{w.outcome.lineage.rowCount} contributing rows</p></details>
  </article>;
            })}{null}</div>{null}</> : null}
 </div></div></section>;
}
