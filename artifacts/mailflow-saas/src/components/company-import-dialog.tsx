import { useRef, useState } from 'react';
import { Download, LoaderCircle, Upload, X } from 'lucide-react';
import { parseGlobalCompanyFile, revalidateGlobalCompanyRows, GLOBAL_COMPANY_IMPORT_BATCH_SIZE, type ParsedGlobalCompanyImport } from '@/lib/global-company-import';

const fields = [
  ['companyName', 'Name'], ['companyWebsiteUrl', 'Website'], ['companyDomain', 'Domain'],
  ['companyIndustry', 'Industry'], ['companySize', 'Size'], ['companyRevenueRange', 'Revenue'],
  ['companyLocation', 'Location'], ['companyPhoneNumber', 'Phone'], ['companyLinkedinUrl', 'LinkedIn'], ['companyDescription', 'Description'],
] as const;
type Key = typeof fields[number][0];
type Row = ParsedGlobalCompanyImport['allRows'][number];
type ImportRowResult = { rowNumber: number; status: string; message: string };

export function CompanyImportDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedGlobalCompanyImport | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [sharing, setSharing] = useState<Record<number, boolean>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{created:number;shared:number;duplicates:number;rejected:number;rows:ImportRowResult[];failure?:string}|null>(null);
  const edit = (row: Row, key: Key, value: string) => {
    if (!parsed) return;
    const allRows = parsed.allRows.map(item => item.rowNumber === row.rowNumber ? {...item, company:{...item.company,[key]:value}} : item);
    const checked = revalidateGlobalCompanyRows(allRows, parsed.unsafeRows);
    setParsed({...parsed,allRows,...checked});
  };
  const getTemplate = async () => {
    setError('');
    try {
      const response = await fetch('/api/companies/import-template',{credentials:'include'});
      if (!response.ok) throw new Error('Could not download the template.');
      const blob = await response.blob();
      const name = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'companies-template.xlsx';
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click(); URL.revokeObjectURL(url);
      setParsed(null); setTemplateId(''); setResult(null); setSharing({}); if(fileRef.current) fileRef.current.value='';
    } catch(e) { setError(e instanceof Error?e.message:'Template download failed.'); }
  };
  const pick = async (file?: File) => {
    if(!file)return;
    setError('');setParsed(null);setTemplateId('');setResult(null);setSharing({});
    const match=file.name.match(/^mailflow-workspace-companies-template-([0-9a-f-]{36})\.xlsx$/i);
    if(!match){setError('Only the latest XLSX template downloaded from this page can be uploaded.');return;}
    try {
      const data=await parseGlobalCompanyFile(file);
      const checked=revalidateGlobalCompanyRows(data.allRows,data.unsafeRows);
      setParsed({...data,...checked});setTemplateId(match[1]);setResult(null);setPage(0);
    } catch(e){setError(e instanceof Error?e.message:'The workbook could not be read.');}
  };
  const importRows = async () => {
    if(!parsed||!templateId||parsed.errors.length||!parsed.valid.length||busy)return;
    setBusy(true);setError('');
    const report={created:0,shared:0,duplicates:0,rejected:0,rows:[] as ImportRowResult[]};
    const session=crypto.randomUUID();
    try {
      for(let i=0;i<parsed.valid.length;i+=GLOBAL_COMPANY_IMPORT_BATCH_SIZE){
        const batch=parsed.valid.slice(i,i+GLOBAL_COMPANY_IMPORT_BATCH_SIZE);
        const response=await fetch('/api/companies/bulk-import',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          templateId,importSessionId:session,isFinalBatch:i+batch.length>=parsed.valid.length,
          rows:batch.map(row=>({...row,company:{...row.company,shareWithGlobal:sharing[row.rowNumber]===true}})),
        })});
        const body=await response.json();
        if(!response.ok)throw new Error(body.error??'Import failed.');
        report.created+=body.created;report.shared+=body.shared;report.duplicates+=body.duplicates;report.rejected+=body.rejected;
        report.rows.push(...(body.rows ?? []));
        onChanged();
      }
      setResult(report);
    } catch(e){setResult({...report,failure:e instanceof Error?e.message:'Import stopped. Check the company list before retrying.'});onChanged();}
    finally{setBusy(false);}
  };
  const downloadResults = () => {
    if(!result?.rows.length)return;
    const csv = '\uFEFF' + [['Row','Result','Details'], ...result.rows.map(row => [String(row.rowNumber),row.status,row.message])]
      .map(line => line.map(value => `"${value.replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='mailflow-company-import-results.csv';anchor.click();URL.revokeObjectURL(url);
  };
  const visible=parsed?.allRows.slice(page*50,page*50+50)??[];
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#14243a]/40 p-3" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="company-import-title" className="my-auto max-h-[94dvh] w-full max-w-[1200px] overflow-y-auto rounded-xl border border-[#dce3e9] bg-[#fbfcfd] p-5 shadow-2xl sm:p-7">
      <header className="mb-5 flex justify-between gap-4"><div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#64788f]">WORKSPACE / COMPANY IMPORT</div><h2 id="company-import-title" className="display mt-1 text-[23px] font-bold text-[#172334]">Bulk upload companies</h2><p className="mt-1 text-[12px] text-[#65758a]">Review and correct each row. Public sharing is optional per company; contacts are never shared.</p></div><button disabled={busy} onClick={onClose} aria-label="Close" className="p-2 text-[#718092]"><X className="h-4 w-4"/></button></header>
      {!result&&<><div className="rounded-lg border bg-white p-4 text-[12px] text-[#53657a]"><p><b>Download a fresh template for each import.</b> Only the latest template can be used.</p><button onClick={()=>void getTemplate()} className="mt-2 inline-flex items-center gap-2 font-semibold text-[#174f99]"><Download className="h-4 w-4"/>Download XLSX template</button></div>
        <div className="my-4 flex flex-wrap items-center gap-3"><input ref={fileRef} type="file" accept=".xlsx" className="sr-only" id="workspace-company-import" onChange={e=>void pick(e.target.files?.[0])}/><label htmlFor="workspace-company-import" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border bg-white px-4 text-xs font-semibold"><Upload className="h-4 w-4"/>Choose XLSX template</label>{parsed&&<span className="text-xs text-[#586a7f]">{parsed.fileName}</span>}</div>
        {parsed&&<><div className="mb-3 flex gap-5 text-xs"><span>{parsed.allRows.length} rows</span><span className="text-green-700">{parsed.valid.length} ready</span><span className="text-orange-700">{parsed.errors.length} need correction</span></div><div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full min-w-[1500px] text-left text-[10px]"><thead className="bg-[#f1f5f9]"><tr><th className="p-2">Row</th>{fields.map(([key,label])=><th key={key} className="p-2">{label}</th>)}<th className="p-2">Make public</th><th className="p-2">Review</th></tr></thead><tbody>{visible.map(row=>{const issue=parsed.errors.find(x=>x.rowNumber===row.rowNumber);return <tr key={row.rowNumber} className="border-t"><td className="p-2">{row.rowNumber}</td>{fields.map(([key])=><td key={key} className="p-1"><input aria-label={`Row ${row.rowNumber} ${key}`} value={String(row.company[key]??'')} onChange={e=>edit(row,key,e.target.value)} className="w-full min-w-24 rounded border px-2 py-1.5"/></td>)}<td className="p-2"><label className="flex items-center gap-1.5"><input type="checkbox" checked={sharing[row.rowNumber]===true} onChange={e=>setSharing({...sharing,[row.rowNumber]:e.target.checked})}/><span>Share</span></label></td><td className="max-w-56 p-2 text-[#995b31]">{issue?.reason??<span className="text-green-700">Ready</span>}</td></tr>;})}</tbody></table></div><div className="mt-3 flex justify-between text-xs"><span>Showing {page*50+1}–{Math.min(page*50+50,parsed.allRows.length)} / {parsed.allRows.length}</span><div className="flex gap-2"><button disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><button disabled={(page+1)*50>=parsed.allRows.length} onClick={()=>setPage(page+1)}>Next</button></div></div></>}
      </>}
      {error&&<p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
      {result&&<div role="status" className="space-y-3 rounded-lg border bg-white p-4 text-sm">{result.failure&&<p className="text-red-700">{result.failure}</p>}<p>Created privately: <b>{result.created}</b> · Made public: <b>{result.shared}</b> · Duplicates: <b>{result.duplicates}</b> · Rejected: <b>{result.rejected}</b></p>{result.rows.length>0&&<><button onClick={downloadResults} className="text-xs font-semibold text-[#174f99] underline">Download row results</button><ul className="max-h-56 overflow-auto rounded border text-xs">{result.rows.map(row=><li key={`${row.rowNumber}-${row.status}`} className="border-b p-2">Row {row.rowNumber} · {row.status}: {row.message}</li>)}</ul></>}</div>}
      <footer className="mt-5 flex justify-end gap-2 border-t pt-4"><button onClick={onClose} disabled={busy} className="rounded-lg border bg-white px-4 py-2 text-xs">Close</button>{parsed&&!result&&<button onClick={()=>void importRows()} disabled={busy||!!parsed.errors.length||!parsed.valid.length} className="inline-flex items-center gap-2 rounded-lg bg-[#174f99] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy&&<LoaderCircle className="h-4 w-4 animate-spin"/>}Import {parsed.valid.length} companies</button>}</footer>
    </section>
  </div>;
}
