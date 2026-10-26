import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCampaignObjectStorageSettings,
  updateCampaignObjectStorageSettings,
  type CampaignObjectStorageSettingsInput,
} from "@workspace/api-client-react";

const inputClass = "mt-1 h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[12px] outline-none focus:border-[#3b73b8]";

export default function AdminObjectStoragePage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "campaign-object-storage"], queryFn: () => getCampaignObjectStorageSettings() });
  const [form, setForm] = useState<CampaignObjectStorageSettingsInput>({
    endpoint: null, region: "us-east-1", bucket: "", prefix: "mailflow", forcePathStyle: false,
    accessKeyId: "", secretAccessKey: "",
  });
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: (input: CampaignObjectStorageSettingsInput) => updateCampaignObjectStorageSettings(input),
    onSuccess: async () => {
      setForm(current => ({ ...current, accessKeyId: "", secretAccessKey: "" }));
      setMessage("Storage settings saved. Credentials are encrypted and never returned to this page.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "campaign-object-storage"] });
    },
  });
  useEffect(() => {
    if (!query.data) return;
    setForm(current => ({
      ...current,
      endpoint: query.data.endpoint,
      region: query.data.region ?? "us-east-1",
      bucket: query.data.bucket ?? "",
      prefix: query.data.prefix ?? "mailflow",
      forcePathStyle: query.data.forcePathStyle,
    }));
  }, [query.data]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    save.mutate({
      ...form,
      endpoint: form.endpoint?.trim() || null,
      ...(form.accessKeyId?.trim() ? { accessKeyId: form.accessKeyId.trim() } : {}),
      ...(form.secretAccessKey?.trim() ? { secretAccessKey: form.secretAccessKey.trim() } : {}),
    });
  };

  if (query.isLoading) return <main className="mx-auto max-w-4xl p-6 text-sm">Loading storage settings…</main>;
  if (query.isError || !query.data) return <main className="mx-auto max-w-4xl p-6 text-sm text-red-700">Could not load storage settings. Reload this page to retry.</main>;

  return <main className="mx-auto max-w-4xl space-y-5 p-5 md:p-8">
    <header>
      <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#858f9c]">SUPERADMIN · DELIVERY</p>
      <h1 className="mt-2 text-2xl font-bold text-[#263447]">Campaign file storage</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#687587]">Connect an S3-compatible bucket for private campaign PDFs. Leave the endpoint empty for AWS S3; custom S3-compatible services usually provide an endpoint URL. The API stores credentials encrypted and never sends them back to the browser.</p>
    </header>
    <section className="rounded-lg border border-[#e2e6eb] bg-white p-5">
      <div className="mb-4 rounded-md bg-[#f5f8fb] p-3 text-xs leading-5 text-[#586778]">
        Status: <strong>{query.data.configured ? "Configured" : "Not configured"}</strong>
        {query.data.configured && <span> · Saved access key and secret are masked; leave both fields blank to keep them.</span>}
        <p className="mt-1">For encrypted storage credentials, your cloud deployment must provide APP_ENCRYPTION_KEY or SESSION_SECRET. Give the key permission to put and read objects under this prefix. Changing bucket or prefix does not move existing PDFs. Configure bucket CORS to allow PUT requests and the Content-Type header from your app’s production origin; use HTTPS for endpoints outside a private network.</p>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium text-[#344154]">S3 endpoint URL <span className="font-normal text-[#7b8794]">(blank for AWS S3)</span><input className={inputClass} type="url" value={form.endpoint ?? ""} onChange={e => setForm(v => ({ ...v, endpoint: e.target.value || null }))} placeholder="https://s3.example.com" /></label>
        <label className="text-xs font-medium text-[#344154]">Region<input required className={inputClass} value={form.region} onChange={e => setForm(v => ({ ...v, region: e.target.value }))} placeholder="us-east-1" /></label>
        <label className="text-xs font-medium text-[#344154]">Bucket name<input required className={inputClass} value={form.bucket} onChange={e => setForm(v => ({ ...v, bucket: e.target.value }))} /></label>
        <label className="text-xs font-medium text-[#344154]">Object prefix<input className={inputClass} value={form.prefix} onChange={e => setForm(v => ({ ...v, prefix: e.target.value }))} placeholder="mailflow" /></label>
        <label className="text-xs font-medium text-[#344154]">Access key ID<input className={inputClass} autoComplete="off" value={form.accessKeyId ?? ""} onChange={e => setForm(v => ({ ...v, accessKeyId: e.target.value }))} placeholder={query.data.accessKeyIdConfigured ? "Saved; leave blank to keep" : "Access key ID"} /></label>
        <label className="text-xs font-medium text-[#344154]">Secret access key<input className={inputClass} type="password" autoComplete="new-password" value={form.secretAccessKey ?? ""} onChange={e => setForm(v => ({ ...v, secretAccessKey: e.target.value }))} placeholder={query.data.secretAccessKeyConfigured ? "Saved; leave blank to keep" : "Secret access key"} /></label>
        <label className="flex items-center gap-2 text-xs text-[#344154] sm:col-span-2"><input type="checkbox" checked={form.forcePathStyle} onChange={e => setForm(v => ({ ...v, forcePathStyle: e.target.checked }))} />Use path-style requests (commonly required by MinIO and some S3-compatible services)</label>
        <div className="sm:col-span-2">
          <button disabled={save.isPending} className="rounded-md bg-[#174f99] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60">{save.isPending ? "Saving…" : "Save storage settings"}</button>
          {message && <p role="status" className="mt-3 text-xs text-green-800">{message}</p>}
          {save.isError && <p role="alert" className="mt-3 text-xs text-red-700">{save.error instanceof Error ? save.error.message : "Could not save storage settings."}</p>}
        </div>
      </form>
    </section>
  </main>;
}
