import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMicrosoftSenderConnection, useAuthorizeMicrosoftSender, useDisconnectMicrosoftSender,
  getGetMicrosoftSenderConnectionQueryKey, getListTenantSendingAccountsQueryKey, getGetUserDashboardQueryKey,
} from '@workspace/api-client-react';

function errorText(error: unknown) {
  const e = error as { data?: { error?: string }; message?: string } | null;
  return e?.data?.error || e?.message || 'The request could not be completed. Please retry.';
}

export function MicrosoftSenderSetup({ accountId, refresh, verified }: { accountId: string; refresh: () => void; verified: boolean }) {
  const query = useGetMicrosoftSenderConnection(accountId, { query: { queryKey: getGetMicrosoftSenderConnectionQueryKey(accountId), enabled: Boolean(accountId), refetchOnWindowFocus: true, staleTime: 0 } });
  const authorize = useAuthorizeMicrosoftSender();
  const disconnect = useDisconnectMicrosoftSender();
  const qc = useQueryClient();
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  useEffect(() => { setAuthorizationUrl(''); authorize.reset(); disconnect.reset(); }, [accountId]);
  useEffect(() => {
    if (!query.data?.connected) return;
    void qc.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
  }, [query.data?.connected, accountId, qc]);
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: getGetMicrosoftSenderConnectionQueryKey(accountId) });
    void qc.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
    refresh();
  };
  return <section id="microsoft-sender-setup" data-testid="microsoft-sender-setup" className="mt-5 rounded-lg border border-[#cbdcf0] bg-[#f2f7fe] p-5">
    <h2 className="display text-[18px] font-bold text-[#24476e]">Microsoft 365 connection options</h2>
    <ol className="mt-3 space-y-3 text-[12px] leading-5 text-[#47627e]">
      <li><strong>1. Try your mailbox password.</strong> Use your full Microsoft sign-in address with smtp.office365.com, port 587, STARTTLS. A successful Outlook login does not guarantee SMTP access: the organization must permit password-based SMTP.</li>
      <li><strong>2. Try an app password only if allowed.</strong> If MFA is enabled and your organization offers app passwords, enter an app password above and check again. App passwords do not bypass blocked legacy authentication. Do not disable MFA or organization-wide security defaults just to connect.</li>
      <li><strong>3. Sign in with Microsoft.</strong> If passwords are restricted or do not work, authorize this mailbox directly with Microsoft. This supports MFA and uses Microsoft’s mail API instead of password-based SMTP. Mailflow’s campaign pacing and mailbox limits still apply.</li>
    </ol>
    <p data-testid="notice-microsoft-sender-display-name" className="mt-3 rounded-md border border-[#d8e4f1] bg-white/70 px-3 py-2 text-[11px] leading-5 text-[#47627e]">
      <strong>About the sender name:</strong> Mailflow includes the From name set above, but with Microsoft sign-in, Microsoft 365 or the recipient’s mail app may show the mailbox’s Microsoft account name instead. To change that name consistently, update the mailbox display name in Microsoft 365.
    </p>
    {!accountId ? <p className="mt-4 text-[12px] text-[#7b5e31]">Save the Microsoft 365 sender identity first. You may leave the password blank when you intend to use Microsoft sign-in.</p> :
      query.isLoading ? <p className="mt-4 text-xs">Checking Microsoft sign-in availability…</p> :
      query.isError ? <p role="alert" className="mt-4 text-xs text-[#9a453e]">Microsoft connection status could not load. <button type="button" onClick={() => void query.refetch()} className="underline">Retry</button></p> :
      <div className="mt-4 space-y-3">
        {query.data?.connected && <p role="status" className="text-[12px] font-semibold text-[#2d704b]">Microsoft sign-in connected: {query.data.mailbox}. {verified ? 'A test email has been accepted; this sender is verified for campaign sending.' : 'Send a test email above before using this sender in campaigns.'}</p>}
        {!query.data?.configured && <p className="text-[12px] text-[#7b5e31]">Microsoft sign-in needs one-time setup by the Mailflow superadmin under Settings → Microsoft sign-in. No administrator configuration is needed for each attempt; your own organization may still require consent.</p>}
        {query.data?.configured && <button type="button" data-testid="button-authorize-microsoft-sender" disabled={authorize.isPending}
          onClick={() => { setAuthorizationUrl(''); authorize.mutate({ accountId }, { onSuccess: r => setAuthorizationUrl(r.authorizationUrl) }); }}
          className="rounded-md bg-[#174f99] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">
          {authorize.isPending ? 'Preparing sign-in…' : query.data.connected ? 'Reconnect with Microsoft' : 'Sign in with Microsoft'}
        </button>}
        {authorizationUrl && <p className="text-[12px]"><a data-testid="link-continue-microsoft" href={authorizationUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#174f99] underline">Continue securely to Microsoft in a new tab</a>. Sign in with the same mailbox as the saved From email. When finished, return here and <button type="button" onClick={refreshAll} className="font-semibold underline">refresh connection status</button>.</p>}
        {query.data?.mailbox && <button type="button" data-testid="button-disconnect-microsoft-sender" disabled={disconnect.isPending} onClick={() => {
          if (window.confirm('Disconnect Microsoft sign-in? This sender will need a successful password check or Microsoft reconnection and a new accepted test email before campaign sending. Already-submitted mail cannot be recalled.')) {
            disconnect.mutate({ accountId }, { onSuccess: () => { setAuthorizationUrl(''); refreshAll(); } });
          }
        }} className="ml-3 text-[12px] font-semibold text-[#93473f] underline">Disconnect Microsoft sign-in</button>}
      </div>}
    {(authorize.isError || disconnect.isError) && <p role="alert" className="mt-3 text-[12px] text-[#93473f]">{errorText(authorize.error || disconnect.error)}</p>}
    <p className="mt-3 text-[11px] leading-5 text-[#60768e]">Some organizations require administrator approval for Mail.Send. Shared/delegated mailbox sending is not enabled by this connection; connect a mailbox you sign in to directly. App passwords and passwords are never tried automatically after an authentication failure. Microsoft API sending has a 4 MB encoded message limit in Mailflow (including attachment encoding); reduce large PDFs or use permitted SMTP.</p>
  </section>;
}
