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
  getGetCompanyResearchSettingsQueryKey,
  getGetAIProviderSettingsQueryKey,
  getListAdminGlobalCompaniesQueryKey,
  useDeleteAIProviderSettings,
  useGetAIProviderSettings,
  useTestAIProviderConnection,
  useUpdateAIProviderSettings,
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

export default function AdminAIProviderPage() {
  const queryClient = useQueryClient();
  const settings = useGetAIProviderSettings();
  const removeSettings = useDeleteAIProviderSettings();
  const testConnection = useTestAIProviderConnection();
  const saveSettings = useUpdateAIProviderSettings();

  const [provider, setProvider] = useState<Provider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const [testedProvider, setTestedProvider] = useState<Provider | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);

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
    settings.data.provider === provider;

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
      setNotice({
        kind: "error",
        text: "Enter the provider API key before testing this connection.",
      });
      return;
    }

    const savedSettings = settings.data;
    try {
      const result = await testConnection.mutateAsync({
        data: {
          provider,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      });
      setAvailableModels(result.models);
      setTestedProvider(provider);
      setSelectedModel((current) => {
        if (result.models.some((model) => model.id === current)) {
          return current;
        }
        if (
          savedSettings?.provider === provider &&
          savedSettings.selectedModel &&
          result.models.some((model) => model.id === savedSettings.selectedModel)
        ) {
          return savedSettings.selectedModel;
        }
        return result.models[0]?.id ?? "";
      });
      setNotice({
        kind: "success",
        text: result.models.length
          ? `Connection successful. ${result.models.length} text-generation model${result.models.length === 1 ? "" : "s"} available.`
          : "Connection successful, but this API key returned no supported text-generation models.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: errorMessage(error, "Connection test failed. Check the key and try again."),
      });
    }
  };

  const handleSave = async () => {
    if (testedProvider !== provider || !selectedModel) {
      setNotice({
        kind: "error",
        text: "Test the connection and choose one of its available models before saving.",
      });
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
      queryClient.setQueryData(getGetAIProviderSettingsQueryKey(), saved);
      setApiKey("");
      setNotice({
        kind: "success",
        text: "Provider and model saved. The API key is encrypted in storage and will not be shown again.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: errorMessage(error, "Could not save the provider configuration."),
      });
    }
  };

  const handleDisconnect = async () => {
    setNotice(null);
    try {
      const disconnected = await removeSettings.mutateAsync();
      queryClient.setQueryData(getGetAIProviderSettingsQueryKey(), disconnected);
      void queryClient.invalidateQueries({
        queryKey: getGetCompanyResearchSettingsQueryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: getListAdminGlobalCompaniesQueryKey(),
      });
      void queryClient.invalidateQueries({
        predicate: (query) =>
          String(query.queryKey[0]).toLowerCase().includes("intelligence"),
      });
      setProvider("openai");
      setApiKey("");
      setAvailableModels([]);
      setTestedProvider(null);
      setSelectedModel("");
      setDisconnectDialogOpen(false);
      setNotice({
        kind: "success",
        text: "Provider disconnected. AI company research is unavailable until a provider is configured again.",
      });
    } catch (error) {
      setDisconnectDialogOpen(false);
      setNotice({
        kind: "error",
        text: errorMessage(error, "Could not remove the provider configuration."),
      });
    }
  };

  const busy =
    testConnection.isPending ||
    saveSettings.isPending ||
    removeSettings.isPending;

  return (
    <main className="min-h-full bg-[#f4f7fb] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5f6f82]">
            <BrainCircuit className="h-4 w-4 text-[#245b9b]" />
            Platform settings
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#17283e]">
            AI integration
          </h1>
          <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[#4d5d70]">
            Connect one LLM provider, test its API key, and choose a text-generation
            model available to that key.
          </p>
        </header>

        {settings.data?.configured ? (
          <section className="mb-5 flex flex-col gap-3 rounded-xl border border-[#cfe5d8] bg-[#f1faf4] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2e7650]" />
              <div>
                <h2 className="text-[14px] font-semibold text-[#205e3e]">
                  Provider configuration saved
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[#3f6d55]">
                  {providerOptions.find((item) => item.value === settings.data.provider)?.label}
                  {settings.data.selectedModel
                    ? ` · ${settings.data.selectedModel}`
                    : ""}
                  {settings.data.lastTestedAt
                    ? ` · Verified ${new Date(settings.data.lastTestedAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#c7e1d1] bg-white px-3 py-1.5 text-[12px] font-medium text-[#326d4c]">
                <ShieldCheck className="h-3.5 w-3.5" />
                API key encrypted
              </span>
              <button
                type="button"
                data-testid="button-disconnect-ai-provider"
                onClick={() => setDisconnectDialogOpen(true)}
                disabled={busy}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#e2c7c3] bg-white px-3 text-[12px] font-semibold text-[#9b3f32] transition hover:bg-[#fff7f5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          </section>
        ) : null}

        {settings.isLoading ? (
          <div className="rounded-xl border border-[#dce3eb] bg-white p-6 text-[14px] text-[#4d5d70]">
            Loading provider setup…
          </div>
        ) : settings.isError ? (
          <div
            role="alert"
            className="rounded-xl border border-[#f0d5bd] bg-[#fff8f1] p-4 text-[13px] text-[#8a4d24]"
          >
            Provider setup could not be loaded.{" "}
            <button
              type="button"
              onClick={() => void settings.refetch()}
              className="font-semibold underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
            <section className="rounded-xl border border-[#dce3eb] bg-white p-5 shadow-[0_8px_24px_rgba(28,49,76,0.04)] sm:p-6">
              <div className="mb-5 border-b border-[#e8edf2] pb-4">
                <h2 className="text-[16px] font-bold text-[#1b2b40]">
                  Provider credentials
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[#4d5d70]">
                  Use a key from the provider’s API console. Testing lists available
                  models; it does not send a prompt or generate billable content.
                </p>
              </div>

              <div className="space-y-5">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-[#29384b]">
                    LLM provider
                  </span>
                  <select
                    value={provider}
                    onChange={(event) => handleProviderChange(event.target.value)}
                    className="h-11 w-full rounded-lg border border-[#cbd4df] bg-white px-3 text-[14px] text-[#243449] outline-none transition focus:border-[#3673b9] focus:ring-2 focus:ring-[#3673b9]/15"
                  >
                    {providerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-[#29384b]">
                    Provider API key
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={apiKey}
                    onChange={(event) => handleApiKeyChange(event.target.value)}
                    placeholder={
                      savedKeyCanBeReused
                        ? "Leave blank to use the saved key"
                        : "Paste API key"
                    }
                    maxLength={4096}
                    className="h-11 w-full rounded-lg border border-[#cbd4df] bg-white px-3 text-[14px] text-[#243449] outline-none transition placeholder:text-[#778597] focus:border-[#3673b9] focus:ring-2 focus:ring-[#3673b9]/15"
                  />
                  <span className="mt-1.5 block text-[12px] leading-5 text-[#4d5d70]">
                    {savedKeyCanBeReused
                      ? "A key is saved for this provider. Enter a new key only to replace it."
                      : "The key is sent only to the server and encrypted before it is stored."}
                  </span>
                </label>

                <div className="flex flex-col gap-3 border-t border-[#e8edf2] pt-5 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void handleTest()}
                    disabled={busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#b9c9dc] bg-white px-4 text-[13px] font-semibold text-[#245b9b] transition hover:bg-[#f4f8fc] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {testConnection.isPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Test connection &amp; load models
                  </button>
                  <span className="text-[12px] leading-5 text-[#4d5d70]">
                    {savedKeyCanBeReused && !apiKey.trim()
                      ? "Uses the saved key and reloads current models so you can change the selection."
                      : "Model discovery uses the provider’s model-list API."}
                  </span>
                </div>

                {testedProvider === provider ? (
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-semibold text-[#29384b]">
                      Available text-generation model
                    </span>
                    <select
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                      disabled={availableModels.length === 0 || busy}
                      className="h-11 w-full rounded-lg border border-[#cbd4df] bg-white px-3 text-[14px] text-[#243449] outline-none transition focus:border-[#3673b9] focus:ring-2 focus:ring-[#3673b9]/15 disabled:cursor-not-allowed disabled:bg-[#f2f5f8] disabled:text-[#647386]"
                    >
                      {availableModels.length === 0 ? (
                        <option value="">No compatible models returned</option>
                      ) : (
                        availableModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name === model.id
                              ? model.id
                              : `${model.name} (${model.id})`}
                          </option>
                        ))
                      )}
                    </select>
                    {availableModels.length === 0 ? (
                      <span className="mt-1.5 block text-[12px] text-[#4d5d70]">
                        The key connected, but it did not return a supported text-generation model.
                      </span>
                    ) : null}
                  </label>
                ) : savedKeyCanBeReused ? (
                  <div className="rounded-lg border border-[#dbe5ef] bg-[#f5f8fc] p-3 text-[12px] leading-5 text-[#4d5d70]">
                    <span className="font-semibold text-[#344154]">
                      Saved model: {settings.data?.selectedModel}
                    </span>
                    <p className="mt-1">
                      To edit it, leave the API key blank and test the saved connection to load the provider’s current model choices.
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-3 border-t border-[#e8edf2] pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div aria-live="polite" className="min-h-5">
                    {notice ? (
                      <div
                        role={notice.kind === "error" ? "alert" : "status"}
                        className={`flex items-start gap-2 text-[13px] leading-5 ${
                          notice.kind === "error"
                            ? "text-[#9b3f32]"
                            : "text-[#2d704b]"
                        }`}
                      >
                        {notice.kind === "error" ? (
                          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span>{notice.text}</span>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={
                      busy ||
                      testedProvider !== provider ||
                      !selectedModel ||
                      !availableModels.some((model) => model.id === selectedModel)
                    }
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#245b9b] px-4 text-[13px] font-semibold text-white transition hover:bg-[#1c4b82] disabled:cursor-not-allowed disabled:bg-[#a8b7c8]"
                  >
                    {saveSettings.isPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save provider and model
                  </button>
                </div>
              </div>
            </section>

            <aside className="rounded-xl border border-[#d5e2ef] bg-[#edf5fc] p-5">
              <h2 className="text-[14px] font-bold text-[#1f4168]">
                Key handling and setup
              </h2>
              <ul className="mt-3 space-y-3 text-[13px] leading-5 text-[#395571]">
                <li>
                  The API key is encrypted at rest with the application’s existing
                  encryption key.
                </li>
                <li>
                  The key is never returned to the browser after saving. Re-enter it
                  only when replacing the saved credential.
                </li>
                <li>
                  Test the connection again after changing the provider or key, then
                  select a model from the fresh provider response.
                </li>
                <li>
                  Saving verifies that the selected model is still available before
                  replacing the current configuration.
                </li>
              </ul>
              <div className="mt-5 rounded-lg border border-[#d0dfed] bg-white/80 p-3 text-[12px] leading-5 text-[#405b76]">
                Only superadmins can view or change this integration. A connection
                test lists models and does not send user content.
              </div>
            </aside>
          </div>
        )}
      </div>
      <ConfirmActionDialog
        open={disconnectDialogOpen}
        onOpenChange={setDisconnectDialogOpen}
        onConfirm={() => void handleDisconnect()}
        title="Disconnect the AI provider?"
        description="This removes the encrypted API key and selected model, and clears the research model and cost estimates. Existing company data and research history remain, but new AI research will be unavailable until a provider is configured again."
        confirmLabel="Disconnect provider"
        pending={removeSettings.isPending}
        testId="dialog-disconnect-ai-provider"
      />
    </main>
  );
}
