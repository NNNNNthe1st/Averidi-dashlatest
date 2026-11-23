export type ExportableDashboardDefinition = {
  name:string;
  template:string;
  widgets:ReadonlyArray<{title:string;metricKey:string;kind:string;visible:boolean;order:number}>;
};

function csvCell(value: string): string {
  // Prevent spreadsheet-formula execution when CSV is opened in Excel.
  const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"','""') + '"';
}

export function exportDashboardDefinitionCsv(config: ExportableDashboardDefinition): string {
  const header=["Dashboard","Template","Widget","Metric","Chart","Visible","Position"];
  const lines=[header.map(csvCell).join(",")];
  for(const widget of [...config.widgets].sort((a,b)=>a.order-b.order)){
    const row=[config.name,config.template,widget.title,widget.metricKey,widget.kind,String(widget.visible),String(widget.order+1)];
    lines.push(row.map(csvCell).join(","));
  }
  return "\uFEFF"+lines.join("\r\n")+"\r\n";
}
