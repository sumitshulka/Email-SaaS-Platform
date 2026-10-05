import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react';
import {
  getGetGoogleOAuthSettingsQueryKey,
  useTestGoogleOAuthSettings,
  useGetGoogleOAuthSettings,
  useUpdateGoogleOAuthSettings,
} from '@workspace/api-client-react';
import type { GoogleOAuthSettingsInput } from '@workspace/api-client-react';

type Notice = { kind: 'success' | 'error'; text: string };

const callbackPath = '/api/sending/gmail/oauth/callback';

function errorMessage(
  error: unknown,
  fallback = 'Could not save the Google OAuth configuration. Please try again.',
) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : fallback;
}

export default function AdminGoogleOAuthPage() {
  const queryClient = useQueryClient();
  const settings = useGetGoogleOAuthSettings();
  const saveSettings = useUpdateGoogleOAuthSettings();
  const testCredentials = useTestGoogleOAuthSettings();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const currentCallbackUri = `${window.location.origin}${callbackPath}`;

  useEffect(() => {
    if (!settings.data) return;
    setClientId(settings.data.clientId ?? '');
    setRedirectUri(settings.data.redirectUri ?? currentCallbackUri);
  }, [settings.data, currentCallbackUri]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('googleOauthTest');
    if (!result) return;
    if (result === 'verified') {
      setNotice({
        kind: 'success',
        text: 'Google OAuth credentials were verified. Workspace users can now connect mailboxes.',
      });
    } else {
      setNotice({
        kind: 'error',
        text: 'Google could not verify these credentials. Check the client ID, secret, callback URL, consent-screen access, and Gmail API setup.',
      });
    }
    void settings.refetch();
    url.searchParams.delete('googleOauthTest');
    window.history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [settings.refetch]);

  const copyCallbackUri = async () => {
    try {
      await navigator.clipboard.writeText(currentCallbackUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice({
        kind: 'error',
        text: 'Copy was unavailable. Select and copy the callback URL from the field below.',
      });
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    const data: GoogleOAuthSettingsInput = {
      clientId: clientId.trim(),
      redirectUri: redirectUri.trim(),
      ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
    };
    saveSettings.mutate(
      { data },
      {
        onSuccess: saved => {
          setClientSecret('');
          setNotice({
            kind: 'success',
            text: saved.verified
              ? 'Google OAuth settings are saved and verified. Gmail monitoring is available to users.'
              : saved.configured
                ? 'Google OAuth settings are saved. Test the saved credentials with Google before enabling mailbox connections.'
                : 'Settings were saved, but the setup is incomplete. Check the required fields below.',
          });
          queryClient.setQueryData(getGetGoogleOAuthSettingsQueryKey(), saved);
        },
        onError: error => setNotice({ kind: 'error', text: errorMessage(error) }),
      },
    );
  };
  const savedValuesMatch = Boolean(
    settings.data?.configured &&
      clientId.trim() === settings.data.clientId &&
      redirectUri.trim() === settings.data.redirectUri &&
      !clientSecret.trim(),
  );
  const startVerification = () => {
    setNotice(null);
    testCredentials.mutate(undefined, {
      onSuccess: result => window.location.assign(result.authorizationUrl),
      onError: error =>
        setNotice({
          kind: 'error',
          text: errorMessage(
            error,
            'Could not start the Google consent test. Please try again.',
          ),
        }),
    });
  };

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-7">
        <div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">
          PLATFORM / INTEGRATIONS
        </div>
        <h1 className="display text-[30px] font-bold leading-tight text-[#172334]">
          Gmail bounce-monitor setup
        </h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[#687484]">
          Set up the Google OAuth client once. Workspace users can connect their own mailbox
          after Google accepts a consent test of the saved credentials.
        </p>
      </div>

      {settings.data && (
        <div
          role="status"
          className={`mb-5 flex items-start gap-3 rounded-lg border p-4 ${
            settings.data.verified
              ? 'border-[#cde7d9] bg-[#f2faf5] text-[#246647]'
              : settings.data.configured
                ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]'
                : 'border-[#e4e8ed] bg-[#f7f9fb] text-[#596777]'
          }`}
        >
          {settings.data.verified ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <div>
            <div className="text-[13px] font-semibold">
              {settings.data.verified
                ? 'Google OAuth credentials are verified'
                : settings.data.configured
                  ? 'Google OAuth credentials need a consent test'
                  : 'Gmail monitoring is not enabled yet'}
            </div>
            <div className="mt-1 text-[12px] leading-5 opacity-85">
              {settings.data.verified
                ? `Google completed the consent check${settings.data.verifiedAt ? ` on ${new Date(settings.data.verifiedAt).toLocaleString()}` : ''}.`
                : settings.data.configured
                  ? 'The saved values are complete, but mailbox connections stay disabled until Google accepts a consent test.'
                  : 'Complete the Google Cloud steps and save the client details below before testing the credentials.'}
            </div>
          </div>
        </div>
      )}

      {settings.isLoading ? (
        <div className="rounded-lg border border-[#e0e4e9] bg-white p-6 text-[13px] text-[#687484]">
          Loading Google OAuth setup…
        </div>
      ) : settings.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-[#f0d5bd] bg-[#fff8f1] p-4 text-[13px] text-[#99501e]"
        >
          Setup status could not be loaded.{' '}
          <button
            type="button"
            onClick={() => void settings.refetch()}
            className="font-semibold underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <section className="mb-5 rounded-lg border border-[#e0e4e9] bg-white p-5 sm:p-6">
            <h2 className="text-[15px] font-bold text-[#1b293a]">Before saving these values</h2>
            <ol className="mt-4 space-y-4">
              <li className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#edf4fc] text-[11px] font-bold text-[#245b9b]">1</span>
                <div className="text-[12px] leading-5 text-[#596777]">
                  <strong className="text-[#29384b]">Enable the Gmail API.</strong> In Google Cloud Console, select or create a project, then open APIs &amp; Services → Library and enable Gmail API.
                </div>
              </li>
              <li className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#edf4fc] text-[11px] font-bold text-[#245b9b]">2</span>
                <div className="text-[12px] leading-5 text-[#596777]">
                  <strong className="text-[#29384b]">Set up the OAuth consent screen.</strong> Add the app name and support contact. Mailflow requests <span className="mono text-[11px]">openid</span>, <span className="mono text-[11px]">email</span>, and Gmail read-only access. Google may require verification before external users can grant this restricted scope.
                </div>
              </li>
              <li className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#edf4fc] text-[11px] font-bold text-[#245b9b]">3</span>
                <div className="min-w-0 flex-1 text-[12px] leading-5 text-[#596777]">
                  <strong className="text-[#29384b]">Create a Web application OAuth client.</strong> Add the callback URL below to its Authorized redirect URIs exactly as shown.
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 break-all rounded bg-[#f4f6f8] px-2 py-1 text-[11px] text-[#344154]">
                      {currentCallbackUri}
                    </code>
                    <button
                      type="button"
                      onClick={copyCallbackUri}
                      className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d7dce3] px-2.5 text-[11px] font-semibold text-[#344154] hover:bg-[#f7f9fb]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#edf4fc] text-[11px] font-bold text-[#245b9b]">4</span>
                <div className="text-[12px] leading-5 text-[#596777]">
                  <strong className="text-[#29384b]">Save the client ID and secret.</strong> Copy both from the OAuth client details into the secure form below.
                </div>
              </li>
            </ol>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#245b9b] no-underline hover:underline"
            >
              Open Google Cloud credentials
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </section>

          <form onSubmit={submit} className="rounded-lg border border-[#e0e4e9] bg-white p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="text-[15px] font-bold text-[#1b293a]">Google OAuth client</h2>
              <p className="mt-1 text-[12px] leading-5 text-[#687484]">
                The client secret is encrypted before storage and is never returned to the browser.
              </p>
            </div>
            {notice && (
              <div
                role={notice.kind === 'error' ? 'alert' : 'status'}
                className={`mb-4 rounded-md border px-3 py-2.5 text-[12px] leading-5 ${
                  notice.kind === 'success'
                    ? 'border-[#cde7d9] bg-[#f2faf5] text-[#246647]'
                    : 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]'
                }`}
              >
                {notice.text}
              </div>
            )}
            <div className="grid gap-4">
              <label className="block space-y-1.5">
                <span className="text-[12px] font-semibold text-[#344154]">OAuth client ID</span>
                <input
                  required
                  maxLength={512}
                  autoComplete="off"
                  value={clientId}
                  onChange={event => setClientId(event.target.value)}
                  placeholder="1234567890-abc.apps.googleusercontent.com"
                  className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] font-semibold text-[#344154]">OAuth client secret</span>
                <input
                  type="password"
                  maxLength={512}
                  autoComplete="new-password"
                  value={clientSecret}
                  onChange={event => setClientSecret(event.target.value)}
                  placeholder={settings.data?.clientSecretConfigured ? 'Leave blank to keep the saved secret' : 'Paste the client secret from Google Cloud'}
                  className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"
                />
                <span className="block text-[11px] leading-relaxed text-[#808a97]">
                  {settings.data?.clientSecretConfigured
                    ? 'A secret is saved. Leave this field blank unless you are replacing it.'
                    : 'Required for the first save. It will not be shown again.'}
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] font-semibold text-[#344154]">Authorized redirect URI</span>
                <input
                  type="url"
                  required
                  maxLength={2048}
                  value={redirectUri}
                  onChange={event => setRedirectUri(event.target.value)}
                  placeholder={currentCallbackUri}
                  className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"
                />
                <span className="block text-[11px] leading-relaxed text-[#808a97]">
                  Must match the callback URL registered in the Google Cloud OAuth client.
                </span>
              </label>
            </div>
            <button
              type="submit"
              disabled={
                saveSettings.isPending ||
                !clientId.trim() ||
                !redirectUri.trim() ||
                (!settings.data?.clientSecretConfigured && !clientSecret.trim())
              }
              className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saveSettings.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {saveSettings.isPending ? 'Saving…' : 'Save Google OAuth settings'}
            </button>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={
                  !savedValuesMatch ||
                  saveSettings.isPending ||
                  testCredentials.isPending
                }
                onClick={startVerification}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#d7dce3] bg-white px-4 text-[13px] font-semibold text-[#344154] transition-colors hover:bg-[#f7f9fb] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {testCredentials.isPending && (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                )}
                {testCredentials.isPending
                  ? 'Opening Google consent…'
                  : 'Test saved credentials with Google'}
              </button>
              <p className="text-[11px] leading-5 text-[#788392]">
                {savedValuesMatch
                  ? 'Google will ask you to grant consent. The test checks Gmail access without saving a mailbox.'
                  : 'Save your changes first. The test always uses the saved client ID, secret, and callback URL.'}
              </p>
            </div>
          </form>
        </>
      )}
    </div>
  );
}