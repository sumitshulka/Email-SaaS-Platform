import './_group.css';
import type { ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  ChevronDown,
  Clock3,
  CreditCard,
  FileText,
  LayoutDashboard,
  ListFilter,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const lifecycle = [
  { name: 'Customer', value: 684, color: '#527d76' },
  { name: 'Qualified', value: 512, color: '#83a79d' },
  { name: 'Opportunity', value: 321, color: '#b8c9bd' },
  { name: 'Lead', value: 674, color: '#d7b48b' },
  { name: 'Not set', value: 289, color: '#dce2df' },
];

const leadStatus = [
  { name: 'New', value: 642, color: '#648d83' },
  { name: 'Working', value: 491, color: '#a4bcae' },
  { name: 'Qualified', value: 538, color: '#d5b080' },
  { name: 'Unqualified', value: 307, color: '#c4a7a0' },
  { name: 'Not set', value: 502, color: '#dce2df' },
];

const campaigns = [
  {
    name: 'May product notes',
    audience: 'Spring launch · 1,284 recipients',
    state: 'Sending',
    recipients: 1284,
    accepted: 823,
    bounced: 17,
    suppressed: 6,
    unknown: 0,
    queued: 438,
    attemptsLastHour: 214,
    remaining: 786,
    hourlyLimit: 1000,
    color: '#5d8e83',
    initials: 'MP',
  },
  {
    name: 'Field guide: retention',
    audience: 'Lifecycle customers · 936 recipients',
    state: 'Completed',
    recipients: 936,
    accepted: 918,
    bounced: 18,
    suppressed: 0,
    unknown: 0,
    queued: 0,
    attemptsLastHour: 0,
    remaining: 0,
    hourlyLimit: 1000,
    color: '#c99a62',
    initials: 'FG',
  },
  {
    name: 'Partner briefing',
    audience: 'Agency partners · 412 recipients',
    state: 'Queued',
    recipients: 412,
    accepted: 0,
    bounced: 0,
    suppressed: 0,
    unknown: 0,
    queued: 412,
    attemptsLastHour: 0,
    remaining: 1000,
    hourlyLimit: 1000,
    color: '#83949b',
    initials: 'PB',
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`mf-panel ${className}`}>{children}</section>;
}

function SideNav() {
  const primary = [
    { label: 'Overview', icon: LayoutDashboard, active: true },
    { label: 'Campaigns', icon: Send },
    { label: 'Contacts', icon: Users },
    { label: 'Companies', icon: Building2 },
    { label: 'Lists', icon: ListFilter },
  ];
  return (
    <aside className="mf-sidebar">
      <div className="mf-brand">
        <span className="mf-brand-mark"><Mail size={17} strokeWidth={2.4} /></span>
        <span>mailflow<span className="mf-brand-period">.</span></span>
      </div>
      <div className="mf-workspace-switch">
        <div className="mf-workspace-avatar">N</div>
        <div className="mf-workspace-copy">
          <span className="mf-label">WORKSPACE</span>
          <strong>Northstar Studio</strong>
        </div>
        <ChevronDown size={14} />
      </div>
      <div className="mf-nav-label">Workspace</div>
      <nav className="mf-nav">
        {primary.map(({ label, icon: Icon, active }) => (
          <div className={`mf-nav-item ${active ? 'active' : ''}`} key={label}>
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
            {label === 'Campaigns' && <span className="mf-nav-count">3</span>}
          </div>
        ))}
      </nav>
      <div className="mf-nav-label mf-tools-label">Manage</div>
      <nav className="mf-nav">
        <div className="mf-nav-item"><CreditCard size={17} strokeWidth={1.8} /><span>Billing</span></div>
        <div className="mf-nav-item"><Settings2 size={17} strokeWidth={1.8} /><span>Settings</span></div>
      </nav>
      <div className="mf-sidebar-bottom">
        <div className="mf-user">
          <div className="mf-user-avatar">AM</div>
          <div><strong>Alex Morgan</strong><span>Workspace admin</span></div>
          <MoreHorizontal size={17} />
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <header className="mf-topbar">
      <div className="mf-crumbs"><span>Workspace</span><span className="mf-crumb-slash">/</span><strong>Overview</strong></div>
      <div className="mf-top-actions">
        <div className="mf-search"><Search size={15} /><span>Search anything</span><kbd>⌘ K</kbd></div>
        <button className="mf-icon-button" aria-label="Notifications"><Bell size={17} /><i /></button>
        <div className="mf-top-avatar">AM</div>
      </div>
    </header>
  );
}

function SummaryCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
  change,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Users;
  tone: 'sea' | 'sand' | 'lilac' | 'blue';
  change?: string;
}) {
  return (
    <div className={`mf-summary mf-summary-${tone}`}>
      <div className="mf-summary-top">
        <span>{label}</span>
        <span className="mf-summary-icon"><Icon size={16} strokeWidth={1.8} /></span>
      </div>
      <div className="mf-summary-value">{value}</div>
      <div className="mf-summary-foot"><span>{note}</span>{change && <span className="mf-summary-change"><ArrowUpRight size={12} />{change}</span>}</div>
    </div>
  );
}

function Distribution({
  title,
  caption,
  data,
  total,
}: {
  title: string;
  caption: string;
  data: typeof lifecycle;
  total: number;
}) {
  return (
    <Panel className="mf-distribution">
      <div className="mf-panel-heading">
        <div><h2>{title}</h2><p>{caption}</p></div>
        <button className="mf-more" aria-label={`More ${title} options`}><MoreHorizontal size={18} /></button>
      </div>
      <div className="mf-distribution-body">
        <div className="mf-donut-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={49} outerRadius={68} paddingAngle={2} cornerRadius={2} stroke="none" isAnimationActive={false}>
                {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip
                isAnimationActive={false}
                contentStyle={{ border: '1px solid #e5e9e5', borderRadius: 8, fontSize: 12, boxShadow: '0 8px 24px rgba(31,48,43,.08)' }}
                formatter={(value: number, name: string) => [formatNumber(value), name]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="mf-donut-center"><strong>{formatNumber(total)}</strong><span>contacts</span></div>
        </div>
        <div className="mf-legend">
          {data.map((entry) => (
            <div className="mf-legend-row" key={entry.name}>
              <span className="mf-legend-name"><i style={{ background: entry.color }} />{entry.name}</span>
              <span className="mf-legend-value">{formatNumber(entry.value)}</span>
              <span className="mf-legend-percent">{((entry.value / total) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function CampaignRow({ campaign }: { campaign: (typeof campaigns)[number] }) {
  const isActive = campaign.state === 'Queued' || campaign.state === 'Sending';
  return (
    <div className="mf-campaign-row">
      <div className="mf-campaign-identity">
        <div className="mf-campaign-mark" style={{ color: campaign.color, background: `${campaign.color}18` }}>{campaign.initials}</div>
        <div className="mf-campaign-name">
          <div className="mf-campaign-title">{campaign.name}<span className={`mf-state mf-state-${campaign.state.toLowerCase()}`}><i />{campaign.state}</span></div>
          <span>{campaign.audience}</span>
        </div>
      </div>
      <div className="mf-campaign-volume">
        <div className="mf-volume-label"><strong>{formatNumber(campaign.recipients)}</strong><span>recipients</span></div>
        <div className="mf-volume-breakdown"><span>{formatNumber(campaign.accepted)} SMTP accepted</span><span>{formatNumber(campaign.bounced)} bounced</span></div>
        <div className="mf-volume-breakdown mf-volume-breakdown-secondary"><span>{formatNumber(campaign.suppressed)} suppressed</span><span>{formatNumber(campaign.unknown)} unknown</span><span>{formatNumber(campaign.queued)} queued</span></div>
      </div>
      <div className="mf-campaign-cap">
        <strong>{formatNumber(campaign.attemptsLastHour)}</strong>
        <span>attempts / last 60 min</span>
        <small>{isActive ? `${formatNumber(campaign.remaining)} / ${formatNumber(campaign.hourlyLimit)} estimate remaining` : 'No active sending estimate'}</small>
      </div>
      <button className="mf-row-more" aria-label={`More actions for ${campaign.name}`}><MoreHorizontal size={18} /></button>
    </div>
  );
}

export function Redesigned() {
  return (
    <div className="mf-redesign">
      <style>{`
        .mf-redesign {
          --mf-ink: #20302e; --mf-muted: #71807d; --mf-line: #e3e9e5; --mf-panel: #fffefa;
          min-height: 100dvh; color: var(--mf-ink); background: #f4f6f2; font-family: var(--app-font-sans);
          display: flex; font-size: 13px; -webkit-font-smoothing: antialiased;
        }
        .mf-redesign * { box-sizing: border-box; }
        .mf-sidebar { width: 238px; flex: 0 0 238px; min-height: 100dvh; background: #263b39; color: #eaf0eb; padding: 25px 15px 16px; display:flex; flex-direction:column; }
        .mf-brand { height: 33px; display:flex; align-items:center; gap:10px; padding:0 10px; font-family:var(--app-font-serif); font-size:19px; font-weight:800; letter-spacing:-.7px; }
        .mf-brand-mark { width:26px; height:26px; border-radius:8px; display:grid; place-items:center; background:#78978a; color:#f6faf5; }
        .mf-brand-period { color:#c5ac7d; }
        .mf-workspace-switch { margin:25px 0 27px; padding:10px 9px; border:1px solid rgba(237,244,236,.13); border-radius:9px; display:flex; align-items:center; gap:9px; }
        .mf-workspace-avatar { width:28px; height:28px; border-radius:7px; display:grid; place-items:center; font-weight:700; font-size:12px; color:#fff; background:#738f82; }
        .mf-workspace-copy { min-width:0; flex:1; display:grid; gap:3px; }
        .mf-label,.mf-nav-label { font:500 9px var(--app-font-mono); letter-spacing:.12em; color:#9aaea5; }
        .mf-workspace-copy strong { font-size:11px; font-weight:600; color:#eff4ef; white-space:nowrap; }
        .mf-workspace-switch > svg { color:#a9b9b0; }
        .mf-nav-label { padding:0 10px; margin-bottom:9px; }
        .mf-nav { display:grid; gap:3px; }
        .mf-nav-item { min-height:39px; padding:0 11px; display:flex; align-items:center; gap:11px; border-radius:7px; color:#c0cec6; font-size:12px; font-weight:500; }
        .mf-nav-item.active { color:#f6faf5; background:rgba(232,241,233,.12); box-shadow:inset 2px 0 #c5ac7d; }
        .mf-nav-item.active svg { color:#d8c89f; }
        .mf-nav-count { margin-left:auto; font:10px var(--app-font-mono); padding:2px 6px; border-radius:8px; color:#dce7df; background:rgba(244,248,241,.13); }
        .mf-tools-label { margin-top:26px; }
        .mf-sidebar-bottom { margin-top:auto; }
        .mf-user { border-top:1px solid rgba(237,244,236,.12); padding:15px 5px 0; display:flex; align-items:center; gap:9px; }
        .mf-user-avatar,.mf-top-avatar { width:29px; height:29px; border-radius:50%; display:grid; place-items:center; background:#d9c9aa; color:#394640; font-size:10px; font-weight:700; }
        .mf-user > div:nth-child(2) { min-width:0; flex:1; display:grid; gap:3px; }
        .mf-user strong { font-size:10px; color:#edf3ed; font-weight:600; }
        .mf-user span { font-size:9px; color:#a9bbb0; }
        .mf-user > svg { color:#a9bbb0; }
        .mf-main { min-width:0; flex:1; }
        .mf-topbar { height:62px; border-bottom:1px solid #e5eae5; display:flex; align-items:center; justify-content:space-between; padding:0 37px; background:rgba(250,251,248,.72); }
        .mf-crumbs { display:flex; align-items:center; gap:9px; color:#8a9691; font-size:11px; }
        .mf-crumbs strong { color:#354541; font-weight:600; }
        .mf-crumb-slash { color:#c2cac4; }
        .mf-top-actions { display:flex; align-items:center; gap:17px; }
        .mf-search { height:31px; width:202px; border:1px solid #e3e8e3; border-radius:6px; background:#fbfcfa; color:#98a29c; display:flex; align-items:center; gap:8px; padding:0 8px; font-size:10px; }
        .mf-search kbd { margin-left:auto; font:9px var(--app-font-mono); padding:2px 4px; border:1px solid #e6eae6; border-radius:3px; color:#a0a9a3; }
        .mf-icon-button { position:relative; border:0; background:none; color:#71807b; padding:3px; display:grid; place-items:center; }
        .mf-icon-button i { position:absolute; width:5px; height:5px; right:1px; top:0; border-radius:50%; background:#d59a64; border:1px solid #f7f8f5; }
        .mf-top-avatar { width:27px; height:27px; background:#e6e1d5; }
        .mf-content { max-width:1500px; padding:31px 37px 36px; margin:0 auto; }
        .mf-page-heading { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin-bottom:23px; }
        .mf-eyebrow { color:#85928b; font:500 9px var(--app-font-mono); letter-spacing:.15em; margin-bottom:8px; }
        .mf-page-heading h1 { margin:0; font:800 27px/1.13 var(--app-font-serif); letter-spacing:-1px; color:#293a36; }
        .mf-page-heading p { margin:7px 0 0; font-size:11px; color:#7f8c85; }
        .mf-heading-actions { display:flex; align-items:center; gap:9px; }
        .mf-date-chip,.mf-new-campaign { height:34px; display:flex; align-items:center; gap:8px; border-radius:6px; font-size:10px; font-weight:600; }
        .mf-date-chip { padding:0 10px; color:#66766e; border:1px solid #dce4de; background:#fafbf8; }
        .mf-new-campaign { padding:0 12px; border:1px solid #2e4b45; background:#2e4b45; color:#f4f7f2; }
        .mf-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
        .mf-summary { min-height:112px; padding:15px 16px 13px; border:1px solid transparent; border-radius:9px; }
        .mf-summary-sea { background:#edf4f0; border-color:#e1ebe4; }
        .mf-summary-sand { background:#f6f1e8; border-color:#eee7da; }
        .mf-summary-lilac { background:#f0f1f5; border-color:#e6e8ef; }
        .mf-summary-blue { background:#edf2f4; border-color:#e1e9eb; }
        .mf-summary-top { display:flex; justify-content:space-between; align-items:center; color:#72817a; font-size:10px; font-weight:600; }
        .mf-summary-icon { display:grid; place-items:center; width:27px; height:27px; border-radius:7px; color:#567a70; background:rgba(255,255,255,.68); }
        .mf-summary-sand .mf-summary-icon { color:#ae8554; }
        .mf-summary-lilac .mf-summary-icon { color:#788094; }
        .mf-summary-blue .mf-summary-icon { color:#71878f; }
        .mf-summary-value { margin-top:8px; font:700 22px/1 var(--app-font-serif); letter-spacing:-.7px; color:#2c3d38; }
        .mf-summary-foot { display:flex; align-items:center; justify-content:space-between; margin-top:7px; color:#87938d; font-size:9px; }
        .mf-summary-change { display:flex; align-items:center; gap:2px; color:#658778; font:9px var(--app-font-mono); }
        .mf-spend-wrap { margin-top:12px; display:flex; gap:8px; align-items:center; }
        .mf-spend-chip { display:inline-flex; align-items:center; gap:5px; font:10px var(--app-font-mono); color:#52665d; background:rgba(255,255,255,.67); border-radius:5px; padding:4px 6px; }
        .mf-spend-chip strong { font-weight:500; color:#344942; }
        .mf-section-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:15px; }
        .mf-panel { min-width:0; border:1px solid var(--mf-line); border-radius:9px; background:var(--mf-panel); box-shadow:0 1px 2px rgba(34,51,42,.025); }
        .mf-distribution { padding:16px 17px 14px; }
        .mf-panel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .mf-panel-heading h2 { margin:0; color:#354640; font:700 13px/1.3 var(--app-font-serif); letter-spacing:-.2px; }
        .mf-panel-heading p { margin:4px 0 0; color:#8a9690; font-size:9px; }
        .mf-more,.mf-row-more { border:0; padding:2px; color:#95a19a; background:transparent; display:grid; place-items:center; }
        .mf-distribution-body { display:flex; align-items:center; gap:19px; margin-top:9px; }
        .mf-donut-wrap { position:relative; width:146px; height:146px; flex:0 0 146px; }
        .mf-donut-center { pointer-events:none; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; }
        .mf-donut-center strong { font:700 17px var(--app-font-serif); letter-spacing:-.4px; color:#394b44; }
        .mf-donut-center span { margin-top:2px; font-size:8px; color:#929c96; }
        .mf-legend { flex:1; min-width:0; display:grid; gap:9px; }
        .mf-legend-row { display:grid; grid-template-columns:minmax(0,1fr) 42px 36px; align-items:center; gap:7px; font-size:9px; }
        .mf-legend-name { display:flex; align-items:center; gap:7px; color:#74817b; white-space:nowrap; }
        .mf-legend-name i { width:7px; height:7px; flex:0 0 7px; border-radius:2px; }
        .mf-legend-value { text-align:right; color:#475951; font:10px var(--app-font-mono); }
        .mf-legend-percent { text-align:right; color:#a0aaa4; font:9px var(--app-font-mono); }
        .mf-campaign-panel { margin-top:15px; overflow:hidden; }
        .mf-campaign-head { display:flex; justify-content:space-between; align-items:flex-start; padding:17px 18px 14px; }
        .mf-campaign-head h2 { margin:0; font:700 14px var(--app-font-serif); letter-spacing:-.2px; color:#354640; }
        .mf-campaign-head p { margin:4px 0 0; font-size:9px; color:#8a9690; }
        .mf-view-all { color:#55786d; font-size:10px; font-weight:600; display:flex; align-items:center; gap:5px; }
        .mf-table-head { display:grid; grid-template-columns:minmax(205px,1.2fr) minmax(300px,1.9fr) minmax(165px,.8fr) 22px; align-items:center; gap:16px; padding:9px 18px; border-top:1px solid #edf0eb; border-bottom:1px solid #edf0eb; background:#f8faf7; color:#909c95; font:9px var(--app-font-mono); }
        .mf-campaign-row { display:grid; grid-template-columns:minmax(205px,1.2fr) minmax(300px,1.9fr) minmax(165px,.8fr) 22px; align-items:center; gap:16px; padding:13px 18px; border-bottom:1px solid #edf0eb; min-height:72px; }
        .mf-campaign-row:last-child { border-bottom:0; }
        .mf-campaign-identity { display:flex; align-items:center; gap:10px; min-width:0; }
        .mf-campaign-mark { width:31px; height:31px; flex:0 0 31px; border-radius:8px; display:grid; place-items:center; font:10px var(--app-font-mono); }
        .mf-campaign-name { min-width:0; display:grid; gap:4px; }
        .mf-campaign-name > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#8d9993; font-size:9px; }
        .mf-campaign-title { display:flex; min-width:0; align-items:center; gap:7px; white-space:nowrap; color:#40524a; font-size:10px; font-weight:600; }
        .mf-state { display:inline-flex; align-items:center; gap:4px; padding:3px 6px; border-radius:10px; font-size:8px; font-weight:500; }
        .mf-state i { width:4px; height:4px; border-radius:50%; background:currentColor; }
        .mf-state-sending { color:#5c8172; background:#ecf3ed; }
        .mf-state-completed { color:#7b8780; background:#f0f2ee; }
        .mf-state-queued { color:#a37a4f; background:#f7f1e7; }
        .mf-campaign-volume { min-width:0; }
        .mf-volume-label { display:flex; gap:5px; align-items:baseline; color:#84918a; font-size:9px; }
        .mf-volume-label strong { color:#3c5148; font:600 11px var(--app-font-mono); }
        .mf-volume-breakdown { display:flex; justify-content:space-between; gap:6px; margin-top:5px; color:#929d97; font-size:8px; }
        .mf-volume-breakdown-secondary { justify-content:flex-start; flex-wrap:wrap; gap:4px 12px; color:#a0aaa4; }
        .mf-campaign-cap { display:grid; gap:4px; text-align:right; }
        .mf-campaign-cap strong { color:#516e63; font:600 12px var(--app-font-mono); }
        .mf-campaign-cap span { color:#909c96; font-size:8px; white-space:nowrap; }
        .mf-campaign-cap small { color:#9aa49f; font-size:8px; }
        .mf-row-more { justify-self:end; }
        .mf-footnotes { display:flex; flex-wrap:wrap; gap:8px 20px; margin-top:11px; color:#89958e; font-size:9px; line-height:1.5; }
        .mf-footnotes span { display:flex; align-items:flex-start; gap:5px; }
        .mf-footnotes svg { flex:0 0 auto; margin-top:1px; color:#82968b; }
        .mf-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
        @media (max-width: 1050px) {
          .mf-sidebar { width:204px; flex-basis:204px; }
          .mf-content { padding-left:24px; padding-right:24px; }
          .mf-topbar { padding:0 24px; }
          .mf-campaign-row,.mf-table-head { grid-template-columns:minmax(175px,1.2fr) minmax(270px,1.9fr) minmax(145px,.8fr) 18px; gap:10px; padding-left:13px; padding-right:13px; }
          .mf-distribution-body { gap:10px; }
          .mf-donut-wrap { width:128px; height:128px; flex-basis:128px; }
        }
        @media (max-width: 760px) {
          .mf-redesign { display:block; }
          .mf-sidebar { width:auto; min-height:0; height:56px; padding:0 17px; flex-direction:row; align-items:center; }
          .mf-brand { padding:0; height:auto; }
          .mf-workspace-switch,.mf-sidebar-bottom,.mf-nav-label { display:none; }
          .mf-nav { margin-left:auto; display:flex; gap:4px; }
          .mf-nav-item { min-height:34px; padding:0 9px; font-size:0; gap:0; }
          .mf-nav-item svg { width:17px; height:17px; }
          .mf-nav-item:nth-child(n+4) { display:none; }
          .mf-nav-count { display:none; }
          .mf-topbar { height:53px; padding:0 17px; }
          .mf-search { width:31px; justify-content:center; padding:0; border:0; background:transparent; }
          .mf-search span,.mf-search kbd { display:none; }
          .mf-top-actions { gap:13px; }
          .mf-content { padding:23px 16px 28px; }
          .mf-page-heading { align-items:flex-start; flex-direction:column; margin-bottom:17px; }
          .mf-page-heading h1 { font-size:24px; }
          .mf-heading-actions { width:100%; }
          .mf-date-chip { flex:1; }
          .mf-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
          .mf-summary { min-height:105px; padding:12px; }
          .mf-summary-value { font-size:20px; }
          .mf-section-row { grid-template-columns:1fr; gap:10px; margin-top:10px; }
          .mf-distribution { padding:14px; }
          .mf-campaign-panel { margin-top:10px; }
          .mf-campaign-head { padding:15px 14px 12px; }
          .mf-table-head { display:none; }
          .mf-campaign-row { position:relative; grid-template-columns:1fr auto; gap:11px 8px; padding:13px 14px; }
          .mf-campaign-identity { grid-column:1 / 2; }
          .mf-campaign-volume { grid-column:1 / -1; grid-row:2; }
          .mf-campaign-cap { grid-column:1 / -1; grid-row:3; display:flex; align-items:baseline; justify-content:space-between; text-align:left; }
          .mf-row-more { position:absolute; top:13px; right:13px; }
          .mf-campaign-title { padding-right:25px; flex-wrap:wrap; }
          .mf-volume-breakdown { font-size:8px; }
          .mf-footnotes { gap:7px; }
        }
        @media (max-width: 390px) {
          .mf-distribution-body { gap:4px; }
          .mf-donut-wrap { width:112px; height:112px; flex-basis:112px; }
          .mf-legend { gap:7px; }
          .mf-legend-row { grid-template-columns:minmax(0,1fr) 34px 30px; gap:3px; font-size:8px; }
          .mf-spend-wrap { flex-wrap:wrap; }
          .mf-top-actions { gap:9px; }
        }
      `}</style>
      <SideNav />
      <div className="mf-main">
        <Topbar />
        <main className="mf-content">
          <div className="mf-page-heading">
            <div>
              <div className="mf-eyebrow">WORKSPACE OVERVIEW</div>
              <h1>Good morning, Alex</h1>
              <p>A clear read on your audience, billing, and active campaign work.</p>
            </div>
            <div className="mf-heading-actions">
              <button className="mf-date-chip"><Activity size={14} /> Current workspace <ChevronDown size={13} /></button>
              <button className="mf-new-campaign"><Plus size={14} /> New campaign</button>
            </div>
          </div>

          <div className="mf-summary-grid">
            <SummaryCard label="Companies" value="846" note="Across this workspace" icon={Building2} tone="sea" />
            <SummaryCard label="Contacts" value="2,480" note="Across 7 active lists" icon={Users} tone="sand" />
            <div className="mf-summary mf-summary-lilac">
              <div className="mf-summary-top"><span>Amount spent</span><span className="mf-summary-icon"><CreditCard size={16} strokeWidth={1.8} /></span></div>
              <div className="mf-spend-wrap"><span className="mf-spend-chip"><strong>USD</strong> $1,842.60</span><span className="mf-spend-chip"><strong>EUR</strong> €426.00</span></div>
              <div className="mf-summary-foot"><span>Billing totals by currency</span></div>
            </div>
            <SummaryCard label="Active lists" value="7" note="Ready for campaign audiences" icon={ListFilter} tone="blue" />
          </div>

          <div className="mf-section-row">
            <Distribution title="Lifecycle stage" caption="Contact distribution · workspace-wide" data={lifecycle} total={2480} />
            <Distribution title="Lead status" caption="Contact distribution · workspace-wide" data={leadStatus} total={2480} />
          </div>

          <Panel className="mf-campaign-panel">
            <div className="mf-campaign-head">
              <div><h2>Campaign activity</h2><p>Sending and recipient outcomes, scoped to each campaign</p></div>
              <div className="mf-view-all">All campaigns <ArrowRight size={13} /></div>
            </div>
            <div className="mf-table-head"><span>CAMPAIGN / AUDIENCE</span><span>RECIPIENT OUTCOMES</span><span>CAMPAIGN SEND ACTIVITY</span><span /></div>
            {campaigns.map((campaign) => <CampaignRow key={campaign.name} campaign={campaign} />)}
          </Panel>
          <div className="mf-footnotes">
            <span><ShieldCheck size={12} /> “Accepted” means the SMTP server accepted the message; inbox delivery is not verified.</span>
            <span><Clock3 size={12} /> Hourly estimates appear for queued or sending campaigns only; the cap is shared, so figures are non-additive.</span>
            <span><FileText size={12} /> Campaign outcomes shown only for their associated recipient audience.</span>
          </div>
        </main>
      </div>
    </div>
  );
}
