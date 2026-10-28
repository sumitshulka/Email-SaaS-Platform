import { useEffect, useState } from 'react';
import { useGetMicrosoftOAuthSettings, useUpdateMicrosoftOAuthSettings } from '@workspace/api-client-react';

export function AdminMicrosoftOAuthSettings() {
  const query = useGetMicrosoftOAuthSettings();
  const save = useUpdateMicrosoftOAuthSettings();
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.enabled);
    setClientId(query.data.clientId ?? '');
    setRedirectUri(query.data.redirectUri ?? new URL(`${import.meta.env.BASE_URL}api/sending/microsoft/oauth/callback`, window.location.origin).toString());
  }, [query.data]);
  const field = 'mt-1 h-10 w-full rounded-md border border-[#cbd8e8] bg-white px-3 text-[13px] text-[#263c55]';
  return <section id="microsoft-sign-in" data-testid="section-admin-microsoft-sign-in" className="mb-5 rounded-lg border border-[#cbdcf0] bg-[#f2f7fe] p-5">
    <h2 className="display text-[18px] font-bold text-[#24476e]">Microsoft sign-in — application-wide setup</h2>
    <p className="mt-2 text-[12px] leading-5 text-[#47627e]">Configure one Microsoft Entra application for all Mailflow accounts. Users authorize their own mailbox; you do not configure credentials for each sign-in attempt. Client secrets and mailbox tokens are stored encrypted, never returned by the API.</p>
    <details className="mt-3 text-[12px] leading-5 text-[#47627e]"><summary className="cursor-pointer font-semibold">One-time Microsoft application setup</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Register a Web application in Microsoft Entra with “Accounts in any organizational directory and personal Microsoft accounts”.</li>
        <li>Register the exact callback URL below as a Web redirect URI. Use your own deployed HTTPS domain.</li>
        <li>Add Microsoft Graph <strong>delegated</strong> permissions User.Read and Mail.Send. Sign-in also requests openid, profile, email and offline_access for renewing authorized sessions.</li>
        <li>Create a client secret and save its value below. Track its expiry and rotate it here before expiry. Organization administrators may need to approve the application; tenant policies cannot be bypassed.</li>
      </ol>
      <p className="mt-2">This is separate from Microsoft 365 message-trace setup. Microsoft mail API acceptance does not prove inbox delivery.</p>
    </details>
    {query.isError ? <p role="alert" className="mt-3 text-xs text-[#93473f]">Settings could not load. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button></p> :
      <form className="mt-4 space-y-3" onSubmit={e => {
        e.preventDefault(); setSaved(false);
        save.mutate({ data: { enabled, clientId, redirectUri, ...(secret ? { clientSecret: secret } : {}) } }, {
          onSuccess: () => { setSecret(''); setSaved(true); void query.refetch(); },
        });
      }}>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-[#365a7a]"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} data-testid="checkbox-enable-microsoft-sign-in"/>Enable Microsoft sign-in for all accounts</label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-[#365a7a]">Application (client) ID<input required data-testid="input-microsoft-client-id" className={field} value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off"/></label>
          <label className="text-[12px] font-semibold text-[#365a7a]">Client secret<input required={!query.data?.clientSecretConfigured} data-testid="input-microsoft-client-secret" type="password" className={field} value={secret} onChange={e => setSecret(e.target.value)} placeholder={query.data?.clientSecretConfigured ? 'Leave blank to keep the saved secret' : 'Enter the secret value'} autoComplete="new-password"/></label>
        </div>
        <label className="block text-[12px] font-semibold text-[#365a7a]">Callback URL<input required data-testid="input-microsoft-redirect-uri" type="url" className={field} value={redirectUri} onChange={e => setRedirectUri(e.target.value)}/></label>
        <p className="text-[11px] text-[#60768e]">Disabling sign-in also stops sending through existing Microsoft-authorized connections. Password-based SMTP accounts remain independent. A client-ID change requires users to reconnect.</p>
        <button data-testid="button-save-microsoft-oauth" disabled={save.isPending || query.isLoading} className="rounded-md bg-[#174f99] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save Microsoft sign-in settings'}</button>
        {saved && <p role="status" className="text-xs text-[#2d704b]">Application-wide settings saved. Users can now authorize their mailbox when enabled.</p>}
        {save.isError && <p role="alert" className="text-xs text-[#93473f]">{(save.error as { data?: { error?: string } })?.data?.error || 'Microsoft settings could not be saved. Check the client ID, secret, and callback URL.'}</p>}
      </form>}
  </section>;
}
