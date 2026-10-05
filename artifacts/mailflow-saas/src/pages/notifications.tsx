import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell, CalendarClock, Check, CircleAlert, Clock3, Megaphone, Search, ShieldCheck, Users,
} from 'lucide-react';
import {
  getGetUserNotificationsQueryKey,
  getListAdminNotificationsQueryKey,
  getListAdminUsersQueryKey,
  useCreateAdminNotification,
  useGetUserNotifications,
  useListAdminNotifications,
  useListAdminUsers,
  useMarkUserNotificationRead,
  useUpdateAdminNotificationStatus,
} from '@workspace/api-client-react';
import type { AdminNotification, AdminUser, UserNotification } from '@workspace/api-client-react';

const errorText = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The request could not be completed. Please try again.';

const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

function Notice({ children, bad = false }: { children: string; bad?: boolean }) {
  return <p role={bad ? 'alert' : 'status'} data-testid={bad ? 'status-notification-error' : 'status-notification-success'} className={`rounded-md border px-3.5 py-3 text-[12px] ${bad ? 'border-[#efd8c7] bg-[#fff8f2] text-[#985120]' : 'border-[#d8e9df] bg-[#f2f8f4] text-[#3e7252]'}`}>{children}</p>;
}

function NotificationCard({ item, unread = false, onRead, busy = false }: {
  item: UserNotification; unread?: boolean; onRead?: () => void; busy?: boolean;
}) {
  return <article data-testid={`notification-card-${item.id}`} className={`rounded-lg border p-5 ${unread ? 'border-[#ead5c4] bg-[#fffaf6]' : 'border-[#e3e7ea] bg-white'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 data-testid={`text-notification-title-${item.id}`} className="text-[15px] font-bold tracking-[-.02em] text-[#243244]">{item.title}</h3>
          {unread ? <span className="rounded-full bg-[#fff0e3] px-2 py-0.5 text-[10px] font-bold text-[#a95218]">Unread</span> : <span className="rounded-full bg-[#eef4f0] px-2 py-0.5 text-[10px] font-semibold text-[#527265]">Read</span>}
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-6 text-[#586778]">{item.message}</p>
      </div>
      {unread && onRead && <button type="button" data-testid={`button-mark-notification-read-${item.id}`} onClick={onRead} disabled={busy} className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-[#e5c5ad] bg-white px-3 text-[11px] font-semibold text-[#94501f] transition hover:bg-[#fff3e8] disabled:opacity-50"><Check className="h-3.5 w-3.5"/>{busy ? 'Marking read' : 'Mark as read'}</button>}
    </div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-[#ece8e3] pt-3 text-[10px] text-[#8a929b]">
      <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5"/>Available {dateTime(item.startsAt)}</span>
      <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5"/>Expires {dateTime(item.expiresAt)}</span>
      {!unread && item.readAt && <span>Read {dateTime(item.readAt)}</span>}
    </div>
  </article>;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const query = useGetUserNotifications({ query: { queryKey: getGetUserNotificationsQueryKey() } });
  const markRead = useMarkUserNotificationRead();
  const [activeReadId, setActiveReadId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState('');
  const data = query.data;

  const read = (notificationId: string) => {
    setActiveReadId(notificationId);
    setMutationError('');
    markRead.mutate({ notificationId }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetUserNotificationsQueryKey() }); setActiveReadId(null); },
      onError: error => { setMutationError(errorText(error)); setActiveReadId(null); },
    });
  };

  if (query.isLoading) return <div data-testid="loading-notifications" className="space-y-5" aria-label="Loading notifications"><div className="h-8 w-56 animate-pulse rounded bg-[#e9eef0]"/><div className="h-28 animate-pulse rounded-lg bg-[#edf1f2]"/><div className="h-36 animate-pulse rounded-lg bg-[#edf1f2]"/></div>;
  if (query.isError || !data) return <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#e2e6e9] bg-white p-6" data-testid="error-notifications"><div className="flex items-center gap-3"><CircleAlert className="h-5 w-5 text-[#bd692d]"/><div><h1 className="text-sm font-semibold text-[#243244]">Notifications are unavailable</h1><p className="mt-1 text-xs text-[#778291]">Your read history is unchanged. Try loading it again.</p></div></div><button data-testid="button-retry-notifications" onClick={() => void query.refetch()} className="rounded-md border border-[#d8dfe4] px-4 py-2 text-xs font-semibold text-[#34536d]">Retry</button></section>;

  return <div className="fade-in space-y-8">
    <header>
      <div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#75869a]">WORKSPACE / ACCOUNT UPDATES</div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="display text-[32px] font-bold leading-tight text-[#192a3d]">Notifications</h1><p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#6c7b8b]">Platform notices for this account, with a history of what you have already seen.</p></div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[#e1e6e8] bg-[#f5f7f5] px-3 py-1.5 text-[11px] font-semibold text-[#647365]"><Bell className="h-3.5 w-3.5"/>{data.unread.length} unread</div>
      </div>
    </header>
    {mutationError && <Notice bad>{mutationError}</Notice>}
    <section aria-labelledby="unread-heading" className="space-y-3">
      <div className="flex items-end justify-between"><div><div className="mono mb-1 text-[9px] uppercase tracking-[.17em] text-[#9b6848]">NEEDS YOUR ATTENTION</div><h2 id="unread-heading" className="display text-[21px] font-bold text-[#263447]">Unread</h2></div><span className="text-[11px] text-[#89929c]">{data.unread.length} {data.unread.length === 1 ? 'notice' : 'notices'}</span></div>
      {data.unread.length ? <div className="space-y-3">{data.unread.map(item => <NotificationCard key={item.id} item={item} unread onRead={() => read(item.id)} busy={activeReadId === item.id && markRead.isPending}/>)}</div> :
        <div data-testid="empty-unread-notifications" className="rounded-lg border border-dashed border-[#d8e0e2] bg-[#f7f9f7] px-6 py-9 text-center"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#eaf1ed] text-[#557567]"><Check className="h-5 w-5"/></span><h3 className="mt-3 text-[13px] font-semibold text-[#344b42]">You’re all caught up</h3><p className="mt-1 text-[11px] text-[#788780]">New account notices will appear here when they are available.</p></div>}
    </section>
    <section aria-labelledby="history-heading" className="space-y-3">
      <div className="flex items-end justify-between border-b border-[#e3e8e9] pb-3"><div><div className="mono mb-1 text-[9px] uppercase tracking-[.17em] text-[#82909d]">ACCOUNT RECORD</div><h2 id="history-heading" className="display text-[21px] font-bold text-[#263447]">Read history</h2></div><span className="text-[11px] text-[#89929c]">{data.history.length} {data.history.length === 1 ? 'notice' : 'notices'}</span></div>
      {data.history.length ? <div className="space-y-3">{data.history.map(item => <NotificationCard key={item.id} item={item}/>)}</div> :
        <p data-testid="empty-notification-history" className="rounded-lg border border-[#e3e8e9] bg-white px-5 py-8 text-center text-[12px] text-[#7c8792]">Read notices will be kept here for your account.</p>}
    </section>
  </div>;
}

type Draft = { title: string; message: string; audience: 'broadcast' | 'focused'; startsAt: string; expiresAt: string };
const emptyDraft: Draft = { title: '', message: '', audience: 'broadcast', startsAt: '', expiresAt: '' };

function StatusTag({ status, notificationId }: { status: AdminNotification['status']; notificationId: string }) {
  const tone = status === 'active' ? 'bg-[#eaf5ef] text-[#397451]' : status === 'scheduled' ? 'bg-[#edf4fc] text-[#315f8b]' : status === 'disabled' ? 'bg-[#f0f2f4] text-[#66717e]' : 'bg-[#fff3e8] text-[#a95218]';
  return <span data-testid={`status-notification-${notificationId}`} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${tone}`}>{status}</span>;
}

export default function AdminNotificationsPage() {
  const queryClient = useQueryClient();
  const notificationsQuery = useListAdminNotifications({ query: { queryKey: getListAdminNotificationsQueryKey() } });
  const createNotification = useCreateAdminNotification();
  const updateStatus = useUpdateAdminNotificationStatus();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [search, setSearch] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<AdminUser[]>([]);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const userParams = useMemo(() => ({ search: search.trim(), status: 'all' as const, page: 1, pageSize: 8 }), [search]);
  const userQuery = useListAdminUsers(userParams, {
    query: { enabled: draft.audience === 'focused' && search.trim().length >= 2, queryKey: getListAdminUsersQueryKey(userParams) },
  });
  const items = notificationsQuery.data?.items ?? [];
  const busy = createNotification.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    const startsAt = new Date(draft.startsAt);
    const expiresAt = new Date(draft.expiresAt);
    if (draft.audience === 'focused' && selectedUsers.length === 0) {
      setNotice({ text: 'Choose at least one customer account for a focused notice.', bad: true });
      return;
    }
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= startsAt) {
      setNotice({ text: 'Expiry must be later than the start date and time.', bad: true });
      return;
    }
    createNotification.mutate({
      data: {
        title: draft.title.trim(), message: draft.message.trim(), audience: draft.audience,
        recipientUserIds: draft.audience === 'focused' ? selectedUsers.map(user => user.id) : [],
        startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString(),
      },
    }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListAdminNotificationsQueryKey() });
        setDraft(emptyDraft);
        setSelectedUsers([]);
        setNotice({ text: 'Platform notification created.' });
      },
      onError: error => setNotice({ text: errorText(error), bad: true }),
    });
  };

  const toggleStatus = (item: AdminNotification) => {
    setNotice(null);
    updateStatus.mutate({ notificationId: item.id, data: { enabled: !item.enabled } }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListAdminNotificationsQueryKey() }); },
      onError: error => setNotice({ text: errorText(error), bad: true }),
    });
  };

  const addUser = (user: AdminUser) => {
    setSelectedUsers(current => current.some(selected => selected.id === user.id) ? current : [...current, user]);
    setSearch('');
  };

  if (notificationsQuery.isLoading) return <div data-testid="loading-admin-notifications" className="space-y-5" aria-label="Loading platform notifications"><div className="h-8 w-64 animate-pulse rounded bg-[#e9eef2]"/><div className="h-64 animate-pulse rounded-lg bg-[#edf1f4]"/><div className="h-52 animate-pulse rounded-lg bg-[#edf1f4]"/></div>;
  if (notificationsQuery.isError) return <section data-testid="error-admin-notifications" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#e1e6eb] bg-white p-6"><div className="flex items-center gap-3"><CircleAlert className="h-5 w-5 text-[#bd692d]"/><div><h1 className="font-semibold text-[#1b2b3d]">Notification data is unavailable</h1><p className="mt-1 text-sm text-[#728092]">No changes have been made. Retry loading platform notices.</p></div></div><button data-testid="button-retry-admin-notifications" onClick={() => void notificationsQuery.refetch()} className="rounded-md border border-[#d6dfe7] px-4 py-2 text-sm font-semibold text-[#294d70]">Retry</button></section>;

  return <div className="fade-in space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#75869a]">PLATFORM / CUSTOMER COMMUNICATION</div><h1 className="display text-[32px] font-bold leading-tight text-[#192a3d]">Platform notifications</h1><p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#6c7b8b]">Publish account notices with an exact audience and a clear service window.</p></div>
      <div className="inline-flex items-center gap-2 rounded-md border border-[#dfe7ed] bg-[#f6f9fb] px-3 py-2 text-[11px] text-[#53677b]"><ShieldCheck className="h-4 w-4 text-[#3374a9]"/>Superadmin controls</div>
    </header>
    {notice && <Notice bad={notice.bad}>{notice.text}</Notice>}
    <section className="overflow-hidden rounded-lg border border-[#e1e6eb] bg-white" data-testid="panel-create-notification">
      <div className="flex items-center gap-3 border-b border-[#e9edf1] px-5 py-4 md:px-6"><span className="grid h-9 w-9 place-items-center rounded-md bg-[#fff1e6] text-[#a95720]"><Megaphone className="h-[17px] w-[17px]"/></span><div><h2 className="text-[15px] font-bold text-[#1d2d40]">Compose a notice</h2><p className="mt-0.5 text-[11px] text-[#788696]">Customers see active notices at the top of their workspace dashboard.</p></div></div>
      <form onSubmit={submit} className="space-y-5 p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#35445a]">Title</span><input data-testid="input-notification-title" required maxLength={120} value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="A concise subject for customers" className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/></label>
          <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#35445a]">Audience</span><select data-testid="select-notification-audience" value={draft.audience} onChange={event => { setDraft(current => ({ ...current, audience: event.target.value as Draft['audience'] })); setSelectedUsers([]); }} className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"><option value="broadcast">All customer accounts · broadcast</option><option value="focused">Selected customer accounts · focused</option></select></label>
        </div>
        <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#35445a]">Message</span><textarea data-testid="input-notification-message" required maxLength={5000} rows={4} value={draft.message} onChange={event => setDraft(current => ({ ...current, message: event.target.value }))} placeholder="Share what customers need to know…" className="w-full resize-y rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 py-2.5 text-[13px] leading-5 outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/></label>
        {draft.audience === 'focused' && <div className="space-y-3 rounded-md border border-[#e1e6eb] bg-[#fafbfd] p-4" data-testid="focused-audience-picker">
          <div className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 text-[#4c7192]"/><div><div className="text-[12px] font-semibold text-[#31475c]">Customer accounts</div><p className="mt-0.5 text-[10px] text-[#7d8996]">Search by name or email, then add each intended recipient.</p></div></div>
          {selectedUsers.length > 0 && <div className="flex flex-wrap gap-2">{selectedUsers.map(user => <span key={user.id} data-testid={`selected-notification-user-${user.id}`} className="inline-flex items-center gap-2 rounded-full border border-[#d9e4ec] bg-white px-2.5 py-1 text-[10px] font-medium text-[#36546e]">{user.firstName} {user.lastName}<button type="button" data-testid={`button-remove-notification-user-${user.id}`} aria-label={`Remove ${user.email}`} onClick={() => setSelectedUsers(current => current.filter(item => item.id !== user.id))} className="text-[#8995a1] hover:text-[#a95218]">×</button></span>)}</div>}
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8994a0]"/><input data-testid="input-notification-account-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search customer accounts" autoComplete="off" className="h-10 w-full rounded-md border border-[#d8dfe6] bg-white pl-9 pr-3 text-[12px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/></label>
          {search.trim().length >= 2 && <div className="max-h-52 overflow-y-auto rounded-md border border-[#e1e6eb] bg-white" data-testid="notification-account-results">{userQuery.isLoading || userQuery.isFetching ? <p className="px-3 py-2.5 text-[11px] text-[#788696]">Searching accounts…</p> : userQuery.isError ? <p role="alert" className="px-3 py-2.5 text-[11px] text-[#a84926]">{errorText(userQuery.error)}</p> : userQuery.data?.items.filter(user => !selectedUsers.some(selected => selected.id === user.id)).length ? userQuery.data.items.filter(user => !selectedUsers.some(selected => selected.id === user.id)).map(user => <button type="button" key={user.id} data-testid={`button-add-notification-user-${user.id}`} onClick={() => addUser(user)} className="block w-full border-b border-[#edf0f2] px-3 py-2.5 text-left last:border-0 hover:bg-[#f7f9fa]"><span className="block text-[12px] font-semibold text-[#26374a]">{user.firstName} {user.lastName}</span><span className="mt-0.5 block text-[11px] text-[#788696]">{user.email}</span></button>) : <p className="px-3 py-2.5 text-[11px] text-[#788696]">No matching accounts.</p>}</div>}
        </div>}
        <div className="grid gap-4 md:grid-cols-2"><label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#35445a]">Starts at</span><input data-testid="input-notification-starts-at" type="datetime-local" required value={draft.startsAt} onChange={event => setDraft(current => ({ ...current, startsAt: event.target.value }))} className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[12px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/></label><label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#35445a]">Expires at</span><input data-testid="input-notification-expires-at" type="datetime-local" required value={draft.expiresAt} onChange={event => setDraft(current => ({ ...current, expiresAt: event.target.value }))} className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[12px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/></label></div>
        {(createNotification.isError || updateStatus.isError) && <p role="alert" data-testid="status-admin-notification-error" className="text-[12px] text-[#a84926]">{errorText(createNotification.error || updateStatus.error)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-4"><p className="max-w-xl text-[10px] leading-5 text-[#788696]">Notices are visible only during their configured window. Disabling a notice stops future visibility without removing its history.</p><button data-testid="button-create-notification" type="submit" disabled={busy || !draft.title.trim() || !draft.message.trim() || (draft.audience === 'focused' && selectedUsers.length === 0)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Publishing…' : 'Create notification'}</button></div>
      </form>
    </section>

    <section data-testid="admin-notification-list">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="mono mb-1 text-[10px] uppercase tracking-[.17em] text-[#8290a0]">NOTICE REGISTER</div><h2 className="display text-[22px] font-bold text-[#1d2d40]">Published notices</h2><p className="mt-1 text-[12px] text-[#748292]">Monitor status and customer read-through; enabled state can be changed at any time.</p></div><span data-testid="text-notification-total" className="rounded-full border border-[#e0e6eb] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#69798a]">{items.length} total</span></div>
      {items.length ? <div className="space-y-3">{items.map(item => {
        const readRate = item.recipientCount > 0 ? Math.round(item.readCount / item.recipientCount * 100) : 0;
        return <article key={item.id} data-testid={`admin-notification-${item.id}`} className="rounded-lg border border-[#e1e6eb] bg-white p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><StatusTag status={item.status} notificationId={item.id}/><span className="rounded-full bg-[#f0f3f5] px-2.5 py-1 text-[10px] font-semibold capitalize text-[#647383]">{item.audience}</span></div><h3 className="text-[15px] font-bold text-[#263447]">{item.title}</h3><p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-[#687788]">{item.message}</p></div>
            <button type="button" data-testid={`button-${item.enabled ? 'disable' : 'enable'}-notification-${item.id}`} onClick={() => toggleStatus(item)} disabled={updateStatus.isPending} className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-[11px] font-semibold disabled:opacity-50 ${item.enabled ? 'border-[#ebc9ae] text-[#9b541e] hover:bg-[#fff7f0]' : 'border-[#cfe3d5] text-[#397451] hover:bg-[#f2f8f4]'}`}>{item.enabled ? 'Disable notice' : 'Enable notice'}</button>
          </div>
          <div className="mt-4 grid gap-3 border-t border-[#edf0f2] pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="text-[9px] uppercase tracking-[.12em] text-[#8b96a1]">Service window</div><div className="mt-1 text-[11px] font-medium text-[#516173]">{dateTime(item.startsAt)}<br/>to {dateTime(item.expiresAt)}</div></div>
            <div><div className="text-[9px] uppercase tracking-[.12em] text-[#8b96a1]">Recipients</div><div data-testid={`text-notification-recipients-${item.id}`} className="mono mt-1 text-[13px] font-medium text-[#34485e]">{item.recipientCount.toLocaleString()}</div></div>
            <div><div className="text-[9px] uppercase tracking-[.12em] text-[#8b96a1]">Read</div><div data-testid={`text-notification-reads-${item.id}`} className="mono mt-1 text-[13px] font-medium text-[#34485e]">{item.readCount.toLocaleString()} <span className="font-sans text-[10px] text-[#8b96a1]">· {readRate}%</span></div></div>
            <div><div className="text-[9px] uppercase tracking-[.12em] text-[#8b96a1]">Created</div><div className="mt-1 text-[11px] font-medium text-[#516173]">{dateTime(item.createdAt)}</div></div>
          </div>
        </article>;
      })}</div> : <div data-testid="empty-admin-notifications" className="rounded-lg border border-dashed border-[#d5dee5] bg-[#f7f9fa] px-6 py-12 text-center"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#e8eef3] text-[#55718b]"><Megaphone className="h-5 w-5"/></span><h3 className="mt-3 text-[14px] font-semibold text-[#344b61]">No platform notices yet</h3><p className="mt-1 text-[12px] text-[#788796]">Create a broadcast or focused notice to share a time-sensitive update with customers.</p></div>}
    </section>
  </div>;
}
