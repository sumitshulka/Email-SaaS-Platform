import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportWorkareaRunResult } from "@workspace/api-client-react";
import { EmptyPanel } from "@/components/report-workarea/report-ui";

type ChartType = "kpi" | "bar" | "horizontal_bar" | "line" | "area" | "pie" | "donut";

type ReportChartProps = {
  result: ReportWorkareaRunResult;
  visualization: {
    type: ChartType;
    categoryFieldId?: string;
    valueFieldId?: string;
  };
  currencyGroupFieldId?: string;
};

const colors = ["#326f67", "#678e78", "#b89455", "#6781a0", "#bb7658", "#7d6d9e", "#4e8f9b", "#a17369"];
const chartValue = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};
const displayNumber = (value: unknown) => {
  const number = chartValue(value);
  return number === null ? "—" : number.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
const tooltipStyle = {
  border: "1px solid #dbe4dc",
  borderRadius: "10px",
  boxShadow: "0 8px 24px rgba(30, 55, 45, .10)",
  fontSize: "12px",
  backgroundColor: "#fffefa",
};

export function ReportChart({ result, visualization, currencyGroupFieldId }: ReportChartProps) {
  const valueColumn = result.columns.find(column => column.fieldId === visualization.valueFieldId);
  if (!valueColumn) {
    return <EmptyPanel title="Choose a chart measure" detail="Select one of this report's summary measures as the chart value." />;
  }

  const groupColumns = result.columns.filter(column => column.fieldId.startsWith("group:"));
  const currencyColumn = currencyGroupFieldId
    ? result.columns.find(column => column.fieldId === `group:${currencyGroupFieldId}`)
    : undefined;
  const categoryColumn = result.columns.find(column => column.fieldId === visualization.categoryFieldId);
  const rows = result.rows as Array<Record<string, unknown>>;
  const detailRows = rows.filter(row => row._rowType === "detail");

  if (visualization.type === "kpi") {
    const totals = rows.filter(row => row._rowType === "grand_total" || row._rowType === "currency_total");
    if (!totals.length) {
      return <EmptyPanel title="No total is available" detail="Enable grand totals or include a currency-grouped total to display this KPI." />;
    }
    return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {totals.map((row, index) => {
        const currency = groupColumns
          .map(column => row[column.fieldId])
          .find(value => typeof value === "string" && /^[A-Z]{3}$/.test(value));
        const label = currency ? `${currency} total` : "Filtered total";
        return <div key={`${String(row._rowType)}-${String(currency ?? index)}`} className="rounded-xl border border-[#d8e3d9] bg-gradient-to-br from-[#eff5ee] to-[#f8f7ef] p-5">
          <div className="font-mono text-[9px] uppercase tracking-[.15em] text-[#77897c]">{label}</div>
          <div className="mt-2 text-[28px] font-semibold tracking-[-.04em] text-[#294f45]">{displayNumber(row[valueColumn.fieldId])}</div>
          <div className="mt-1 text-[11px] text-[#728177]">{valueColumn.label}</div>
        </div>;
      })}
    </div>;
  }

  if (!categoryColumn) {
    return <EmptyPanel title="Choose a chart category" detail="Select a grouping field for the chart's horizontal categories." />;
  }
  const data = detailRows
    .map(row => ({
      name: [
        String(row[categoryColumn.fieldId] ?? "Not set"),
        ...(currencyColumn && currencyColumn.fieldId !== categoryColumn.fieldId && row[currencyColumn.fieldId]
          ? [String(row[currencyColumn.fieldId])]
          : []),
      ].join(" · "),
      value: chartValue(row[valueColumn.fieldId]),
    }))
    .filter(item => item.value !== null);
  if (!data.length) {
    return <EmptyPanel title="No grouped values to chart" detail="Run the report again or adjust its filters and grouping fields." />;
  }

  const valueAxis = <YAxis tick={{ fontSize: 10, fill: "#718078" }} tickFormatter={displayNumber} width={70} />;
  const horizontalAxis = <XAxis type="number" tick={{ fontSize: 10, fill: "#718078" }} tickFormatter={displayNumber} />;
  const categoryAxis = <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#718078" }} interval="preserveStartEnd" />;
  const categoryYAxis = <YAxis type="category" dataKey="name" width={125} tick={{ fontSize: 10, fill: "#718078" }} />;

  if (visualization.type === "pie" || visualization.type === "donut") {
    const pieData = data.filter(item => (item.value ?? 0) > 0).slice(0, 12);
    if (!pieData.length) {
      return <EmptyPanel title="No positive values to chart" detail="Pie and donut charts display positive values only. Try a bar chart for zero or negative values." />;
    }
    return <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} formatter={value => displayNumber(value)} />
          <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={visualization.type === "donut" ? 68 : 0} outerRadius={112} paddingAngle={2} isAnimationActive={false}>
            {pieData.map((item, index) => <Cell key={`${item.name}-${index}`} fill={colors[index % colors.length]} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>;
  }

  return <div className="h-[320px] w-full">
    <ResponsiveContainer width="100%" height="100%">
      {visualization.type === "horizontal_bar"
        ? <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e6ece5" horizontal={false} />
            {horizontalAxis}
            {categoryYAxis}
            <Tooltip contentStyle={tooltipStyle} formatter={value => displayNumber(value)} />
            <Bar dataKey="value" name={valueColumn.label} fill={colors[0]} radius={[0, 5, 5, 0]} isAnimationActive={false} />
          </BarChart>
        : visualization.type === "line"
          ? <LineChart data={data} margin={{ top: 10, right: 20, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="#e6ece5" vertical={false} />
              {categoryAxis}
              {valueAxis}
              <Tooltip contentStyle={tooltipStyle} formatter={value => displayNumber(value)} />
              <Line type="monotone" dataKey="value" name={valueColumn.label} stroke={colors[0]} strokeWidth={3} dot={{ r: 3, fill: colors[0] }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          : visualization.type === "area"
            ? <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#e6ece5" vertical={false} />
                {categoryAxis}
                {valueAxis}
                <Tooltip contentStyle={tooltipStyle} formatter={value => displayNumber(value)} />
                <Area type="monotone" dataKey="value" name={valueColumn.label} stroke={colors[0]} fill="#c7ddd3" strokeWidth={2.5} isAnimationActive={false} />
              </AreaChart>
            : <BarChart data={data} margin={{ top: 10, right: 20, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#e6ece5" vertical={false} />
                {categoryAxis}
                {valueAxis}
                <Tooltip contentStyle={tooltipStyle} formatter={value => displayNumber(value)} />
                <Bar dataKey="value" name={valueColumn.label} fill={colors[0]} radius={[5, 5, 0, 0]} isAnimationActive={false} />
              </BarChart>}
    </ResponsiveContainer>
  </div>;
}
