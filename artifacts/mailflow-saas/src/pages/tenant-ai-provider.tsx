import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  getGetTenantAIProviderSettingsQueryKey,
  useDeleteTenantAIProviderSettings,
  useGetTenantAIProviderSettings,
  useTestTenantAIProviderConnection,
  useUpdateTenantAIProviderSettings,
} from "@workspace/api-client-react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

type Provider = "openai" | "anthropic" | "gemini";
type ProviderModel = { id: string; name: string };
type Notice = { kind: "success" | "error"; text: string };

const providerOptions: { value: Provider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
];

function errorMessage(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : fallback;
}

export default function TenantAIProviderPage() {
  const queryClient = useQueryClient();
  const settings = useGetTenantAIProviderSettings();
  const testConnection = useTestTenantAIProviderConnection();
  const saveSettings = useUpdateTenantAIProviderSettings();
  const removeSettings = useDeleteTenantAIProviderSettings();
  const [provider, setProvider] = useState<Provider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const [testedProvider, setTestedProvider] = useState<Provider | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    if (
      settings.data.provider === "openai" ||
      settings.data.provider === "anthropic" ||
      settings.data.provider === "gemini"
    ) {
      setProvider(settings.data.provider);
    }
    setSelectedModel(settings.data.selectedModel ?? "");
  }, [settings.data?.provider, settings.data?.selectedModel]);

  const savedKeyCanBeReused =
    settings.data?.apiKeyConfigured === true &&
    settings.data?.apiKeyUsable === true &&
    settings.data.provider === provider;
  const busy =
    testConnection.isPending ||
    saveSettings.isPending ||
    removeSettings.isPending;

  const handleProviderChange = (value: string) => {
    setProvider(value as Provider);
    setApiKey("");
    setAvailableModels([]);
    setTestedProvider(null);
    setSelectedModel("");
    setNotice(null);
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setAvailableModels([]);
    setTestedProvider(null);
    setSelectedModel("");
    setNotice(null);
  };

  const handleTest = async () => {
    setNotice(null);
    if (!apiKey.trim() && !savedKeyCanBeReused) {
      setNotice({ kind: "error", text: "Enter your provider API key before testing the connection." });
      return;
    }
    try {
      const result = await testConnection.mutateAsync({
        data: { provider, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
      });
      setAvailableModels(result.models);
      setTestedProvider(provider);
      setSelectedModel(current => {
        if (result.models.some(model => model.id === current)) return current;
        if (
          settings.data?.provider === provider &&
          settings.data.selectedModel &&
          result.models.some(model => model.id === settings.data?.selectedModel)
        ) return settings.data.selectedModel;
        return result.models[0]?.id ?? "";
      });
      setNotice({
        kind: "success",
        text: result.models.length
          ? `Connection successful. ${result.models.length} supported model${result.models.length === 1 ? "" : "s"} available.`
          : "Connection succeeded, but the key returned no supported text models.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error, "Connection test failed. Check the key and try again.") });
    }
  };

  const handleSave = async () => {
    if (testedProvider !== provider || !selectedModel) {
      setNotice({ kind: "error", text: "Test the connection and choose one of its available models before saving." });
      return;
    }
    setNotice(null);
    try {
      const saved = await saveSettings.mutateAsync({
        data: {
          provider,
          selectedModel,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      });
      queryClient.setQueryData(getGetTenantAIProviderSettingsQueryKey(), saved);
      await queryClient.invalidateQueries({
        predicate: query => String(query.queryKey[0]).toLowerCase().includes("intent"),
      });
      setApiKey("");
      setNotice({
        kind: "success",
        text: "Your provider and model are saved. The key is encrypted and will not be shown again.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error, "Could not save your provider configuration.") });
    }
  };

  const handleRemove = async () => {
    setNotice(null);
    try {
      const removed = await removeSettings.mutateAsync();
      queryClient.setQueryData(getGetTenantAIProviderSettingsQueryKey(), removed);
      await queryClient.invalidateQueries({
        predicate: query => String(query.queryKey[0]).toLowerCase().includes("intent"),
      });
      setApiKey("");
      setAvailableModels([]);
      setTestedProvider(null);
      setSelectedModel("");
      setRemoveDialogOpen(false);
      setNotice({ kind: "success", text: "Your saved provider key was removed. Eligible features will use Mailflow-managed AI when available." });
    } catch (error) {
      setRemoveDialogOpen(false);
      setNotice({ kind: "error", text: errorMessage(error, "Could not remove your provider configuration.") });
    }
  };

  return (
    <main className="space-y-5">
      <header>
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f6f82]">
          <BrainCircuit className="h-4 w-4 text-[#245b9b]"/>
          Account settings
        </div>
        <h1 className="display text-[25px] font-bold tracking-tight text-[#17283e]">AI Provider</h1>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#647487]">
          Bring one supported provider key for tenant-scoped AI features. You pay the provider directly; Mailflow’s package allowances and research limits still apply.
        </p>
      </header>

      {settings.isLoading ? (
        <div role="status" className="rounded-lg border border-[#dce3eb] bg-white p-5 text-[12px] text-[#4d5d70]">Loading AI provider settings…</div>
      ) : settings.isError || !settings.data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f0d5bd] bg-[#fff8f1] p-4 text-[12px] text-[#8a4d24]">
          <span>AI provider settings could not be loaded.</span>
          <button type="button" onClick={() => void settings.refetch()} className="rounded-md border border-[#e5c5a8] bg-white px-3 py-2 font-semibold">Retry</button>
        </div>
      ) : !settings.data.eligible ? (
        <div className="space-y-4">
          <section data-testid="notice-byok-not-included" className="rounded-lg border border-[#ead8b8] bg-[#fffaf1] p-4">
            <h2 className="text-[13px] font-semibold text-[#684d28]">BYOK is not included in this package</h2>
            <p className="mt-1 text-[11px] leading-5 text-[#786447]">
              {settings.data.packageName
                ? `${settings.data.packageName} does not currently include tenant-owned AI provider keys.`
                : "An active primary package with this feature is required."} Ask your administrator which package includes this capability.
            </p>
          </section>
          {settings.data.configured && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dce3eb] bg-white p-4">
              <div>
                <div className="text-[11px] font-semibold text-[#344154]">A saved key is inactive on this package</div>
                <p className="mt-1 text-[10px] text-[#758394]">It will not be used unless BYOK is enabled for your package. You can still remove it.</p>
              </div>
              <button type="button" data-testid="button-remove-ineligible-byok" onClick={() => setRemoveDialogOpen(true)} disabled={busy} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[#e2c7c3] bg-white px-3 text-[11px] font-semibold text-[#9b3f32] hover:bg-[#fff7f5] disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5"/>Remove saved key
              </button>
            </section>
          )}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,.75fr)]">
          <section className="overflow-hidden rounded-lg border border-[#dce3eb] bg-white">
            <div className="border-b border-[#e8edf2] bg-[#f2f7fb] px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[14px] font-bold text-[#1b2b40]">Provider configuration</h2>
                  <p className="mt-1 text-[10px] text-[#617589]">Package: {settings.data.packageName ?? "Active primary plan"}</p>
                </div>
                {settings.data.configured && <span className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[9px] font-semibold ${settings.data.apiKeyUsable ? "border-[#c7e1d1] text-[#326d4c]" : "border-[#ead8b8] text-[#8a652e]"}`}><ShieldCheck className="h-3.5 w-3.5"/>{settings.data.apiKeyUsable ? "Key saved · ••••••••••••" : "Saved key needs replacement"}</span>}
              </div>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <div className="rounded-md border border-[#d5e4f0] bg-[#f5f9fc] px-3 py-2.5 text-[10px] leading-4 text-[#46627c]">
                This key is used for tenant-scoped AI drafting and contact-intent analysis. Global Company Intelligence research remains platform-managed because its results are shared across accounts.
              </div>
              {settings.data.configured && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#cfe5d8] bg-[#f1faf4] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#205e3e]">Configuration saved</div>
                    <p className="mt-0.5 truncate text-[10px] text-[#3f6d55]">{providerOptions.find(item => item.value === settings.data?.provider)?.label} · {settings.data.selectedModel}</p>
                  </div>
                  <button type="button" data-testid="button-remove-byok-provider" onClick={() => setRemoveDialogOpen(true)} disabled={busy} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-[#e2c7c3] bg-white px-2.5 text-[10px] font-semibold text-[#9b3f32] hover:bg-[#fff7f5] disabled:opacity-50"><Trash2 className="h-3 w-3"/>Remove</button>
                </div>
              )}

              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold text-[#29384b]">AI provider</span>
                <select data-testid="select-tenant-ai-provider" value={provider} onChange={event => handleProviderChange(event.target.value)} disabled={busy} className="h-10 w-full rounded-md border border-[#cbd4df] bg-white px-3 text-[12px] text-[#243449] outline-none focus:border-[#3673b9] focus:ring-2 focus:ring-[#3673b9]/15 disabled:bg-[#f2f5f8]">
                  {providerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold text-[#29384b]">Provider API key</span>
                <input data-testid="input-tenant-ai-provider-key" type="password" autoComplete="new-password" value={apiKey} onChange={event => handleApiKeyChange(event.target.value)} placeholder={savedKeyCanBeReused ? "Leave blank to reuse your saved key" : "Paste your provider API key"} maxLength={4096} disabled={busy} className="h-10 w-full rounded-md border border-[#cbd4df] bg-white px-3 text-[12px] text-[#243449] outline-none placeholder:text-[#778597] focus:border-[#3673b9] focus:ring-2 focus:ring-[#3673b9]/15 disabled:bg-[#f2f5f8]"/>
                <span className="block text-[10px] leading-4 text-[#718192]">{savedKeyCanBeReused ? "Your saved key is encrypted. Enter a replacement only if you want to update it." : settings.data.apiKeyConfigured && !settings.data.apiKeyUsable ? "The saved key cannot be decrypted by this deployment. Enter a replacement key to restore AI access." : "The key is sent only to the API and encrypted before storage."}</span>
              </label>

              <div className="flex flex-wrap items-center gap-2 border-t border-[#e8edf2] pt-4">
                <button type="button" data-testid="button-test-tenant-ai-provider" onClick={() => void handleTest()} disabled={busy} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[#b9c9dc] bg-white px-3 text-[11px] font-semibold text-[#245b9b] hover:bg-[#f4f8fc] disabled:opacity-50">
                  {testConnection.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <ShieldCheck className="h-3.5 w-3.5"/>}Test connection
                </button>
                <span className="text-[10px] text-[#718192]">Checks provider access and loads available text models.</span>
              </div>

              {testedProvider === provider && (
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-semibold text-[#29384b]">Default model for tenant AI</span>
                  <select data-testid="select-tenant-ai-provider-model" value={selectedModel} onChange={event => setSelectedModel(event.target.value)} disabled={busy || !availableModels.length} className="h-10 w-full rounded-md border border-[#cbd4df] bg-white px-3 text-[12px] text-[#243449] outline-none focus:border-[#3673b9] disabled:bg-[#f2f5f8]">
                    {availableModels.length ? availableModels.map(model => <option key={model.id} value={model.id}>{model.name === model.id ? model.id : `${model.name} (${model.id})`}</option>) : <option value="">No supported models returned</option>}
                  </select>
                </label>
              )}

              <div className="flex flex-col gap-3 border-t border-[#e8edf2] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div aria-live="polite" className="min-h-5">
                  {notice && <div role={notice.kind === "error" ? "alert" : "status"} className={`flex items-start gap-2 text-[10px] leading-4 ${notice.kind === "error" ? "text-[#9b3f32]" : "text-[#2d704b]"}`}>
                    {notice.kind === "error" ? <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0"/> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0"/>}<span>{notice.text}</span>
                  </div>}
                </div>
                <button type="button" data-testid="button-save-tenant-ai-provider" onClick={() => void handleSave()} disabled={busy || testedProvider !== provider || !selectedModel || !availableModels.some(model => model.id === selectedModel)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-[#245b9b] px-3.5 text-[11px] font-semibold text-white hover:bg-[#1c4b82] disabled:cursor-not-allowed disabled:bg-[#a8b7c8]">
                  {saveSettings.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin"/>}Save configuration
                </button>
              </div>
            </div>
          </section>

          <aside className="rounded-lg border border-[#d5e2ef] bg-[#edf5fc] p-4">
            <h2 className="text-[12px] font-bold text-[#1f4168]">What BYOK changes</h2>
            <ul className="mt-3 space-y-2.5 text-[10px] leading-4 text-[#395571]">
              <li>You pay your AI provider directly for use of this key.</li>
              <li>Mailflow still enforces package feature access and existing research or add-on credit limits.</li>
              <li>A saved BYOK key is never silently replaced by the platform provider if it fails.</li>
              <li>Your key is encrypted at rest using the application’s configured encryption secret.</li>
            </ul>
          </aside>
        </div>
      )}

      {notice && !settings.data?.eligible && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2.5 text-[11px] ${notice.kind === "error" ? "border-[#f0d5bd] bg-[#fff8f1] text-[#8a4d24]" : "border-[#cfe5d8] bg-[#f1faf4] text-[#326d4c]"}`}>{notice.text}</div>
      )}

      <ConfirmActionDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        onConfirm={() => void handleRemove()}
        title="Remove your saved AI key?"
        description="This permanently removes the encrypted tenant key and model selection. Mailflow-managed AI will be used for eligible features when available. Existing research credits and add-on allowances are unchanged."
        confirmLabel="Remove key"
        pending={removeSettings.isPending}
        testId="dialog-remove-tenant-ai-provider"
      />
    </main>
  );
}
