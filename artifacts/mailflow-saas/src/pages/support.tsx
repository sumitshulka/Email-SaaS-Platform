import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { Form } from '@/components/ui/form';
import {
  AlertCircle, ArrowLeft, ArrowUpRight, ChevronRight, CircleHelp,
  Clock3, LifeBuoy, LoaderCircle, MessageSquareText, Plus, Search, Send,
  ShieldCheck, Ticket, X,
} from 'lucide-react';
import {
  getGetAdminSupportTicketQueryKey,
  getGetSupportTicketQueryKey,
  getListAdminSupportTicketsQueryKey,
  getListSupportTicketsQueryKey,
  useCreateSupportTicket,
  useGetAdminSupportTicket,
  useGetSupportTicket,
  useListAdminSupportTickets,
  useListSupportTickets,
  useReplyToAdminSupportTicket,
  useReplyToSupportTicket,
  useUpdateAdminSupportTicketStatus,
} from '@workspace/api-client-react';
import type {
  AdminSupportTicketSummary,
  ListAdminSupportTicketsParams,
  SupportTicketMessage,
  SupportTicketStatus,
  SupportTicketSummary,
} from '@workspace/api-client-react';

type TicketStatus = SupportTicketStatus;

const statuses: TicketStatus[] = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'];
const statusNames: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_customer: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};
const statusTone: Record<TicketStatus, string> = {
  open: 'bg-[#eaf3ff] text-[#205b9d] before:bg-[#4486c5]',
  in_progress: 'bg-[#fff2e6] text-[#a85d22] before:bg-[#db8a43]',
  waiting_on_customer: 'bg-[#fff2e6] text-[#a85d22] before:bg-[#db8a43]',
  resolved: 'bg-[#e8f4ef] text-[#347562] before:bg-[#4c9a7e]',
  closed: 'bg-[#eff1f3] text-[#66717e] before:bg-[#9aa2ac]',
};
const formatDate = (date: string, compact = false) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, compact
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);
};
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message)
  : 'Something went wrong. Please try again.';

function StatusBadge({ status }: { status: TicketStatus }) {
  return <span data-testid={`status-ticket-${status}`} className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold before:h-1.5 before:w-1.5 before:rounded-full ${statusTone[status]}`}>{statusNames[status]}</span>;
}

function Button({
  children, onClick, type = 'button', disabled = false, variant = 'primary', className = '', testId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  variant?: 'primary' | 'outline' | 'quiet';
  className?: string;
  testId: string;
}) {
  const variants = {
    primary: 'border-[#174f99] bg-[#174f99] text-white hover:bg-[#103f7e]',
    outline: 'border-[#d7dfe7] bg-white text-[#344154] hover:bg-[#f5f8fb]',
    quiet: 'border-transparent bg-transparent text-[#66717e] hover:bg-[#f1f5f8]',
  };
  return <button data-testid={testId} type={type} onClick={onClick} disabled={disabled} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${variants[variant]} ${className}`}>{children}</button>;
}

function QueryError({ retry }: { retry: () => void }) {
  return <div role="alert" data-testid="status-support-error" className="m-5 flex items-start gap-3 rounded-lg border border-[#efd8c3] bg-[#fff8f1] p-4 text-[#8d5126]">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">We couldn't load these tickets</p><p className="mt-1 text-[12px] text-[#8e7868]">Your support history is unchanged. Try loading it again.</p></div>
    <button data-testid="button-support-retry" onClick={retry} className="text-[12px] font-bold underline underline-offset-2">Retry</button>
  </div>;
}

function QueueSkeleton() {
  return <div className="space-y-2 p-3" aria-label="Loading support tickets">{[0, 1, 2, 3].map(item => <div key={item} className="rounded-lg border border-[#e9edf0] p-4"><div className="h-3 w-2/3 animate-pulse rounded bg-[#e8edf1]" /><div className="mt-3 h-2.5 w-1/3 animate-pulse rounded bg-[#eef1f3]" /><div className="mt-4 h-2.5 w-1/4 animate-pulse rounded bg-[#eef1f3]" /></div>)}</div>;
}

function MessageThread({ messages, admin = false }: { messages: SupportTicketMessage[]; admin?: boolean }) {
  if (!messages.length) return <div className="mx-auto my-12 max-w-sm text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f0f5f7] text-[#64818b]"><MessageSquareText className="h-5 w-5" /></div><p className="mt-3 text-sm font-semibold text-[#344154]">No messages yet</p><p className="mt-1 text-xs text-[#7c8791]">The conversation will appear here.</p></div>;
  return <div className="space-y-6" data-testid="list-support-messages">
    {messages.map((message, index) => {
      const fromSupport = message.authorRole === 'SUPERADMIN';
      const isRight = admin ? fromSupport : !fromSupport;
      return <article key={message.id} data-testid={`card-support-message-${message.id}`} className={`flex items-start gap-3 ${isRight ? 'flex-row-reverse' : ''}`}>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${fromSupport ? 'bg-[#e8f1f7] text-[#315e7c]' : 'bg-[#f7eee4] text-[#885a31]'}`}>{initials(message.authorName) || (fromSupport ? 'MF' : 'U')}</div>
        <div className={`min-w-0 max-w-[min(680px,88%)] ${isRight ? 'text-right' : ''}`}>
          <div className={`mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#7b8792] ${isRight ? 'justify-end' : ''}`}>
            <span className="font-semibold text-[#344154]">{message.authorName}</span>
            {fromSupport && <span className="rounded bg-[#edf4f5] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-[#4a737b]">Mailflow support</span>}
            <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
          </div>
          <div className={`whitespace-pre-wrap break-words rounded-xl px-4 py-3 text-left text-[13px] leading-6 ${isRight ? 'rounded-tr-sm bg-[#eaf2fa] text-[#263f58]' : 'rounded-tl-sm border border-[#e5e9ec] bg-white text-[#374656]'}`}>{message.message}</div>
        </div>
        {index === 0 && <span className="sr-only">First message</span>}
      </article>;
    })}
  </div>;
}

function ReplyBox({ onSubmit, isPending, error, admin = false, disabled = false, reopensTicket = false }: {
  onSubmit: (message: string) => Promise<void>;
  isPending: boolean;
  error?: string;
  admin?: boolean;
  disabled?: boolean;
  reopensTicket?: boolean;
}) {
  const form = useForm<{ message: string }>({ defaultValues: { message: '' } });
  const message = form.watch('message');
  const submit = form.handleSubmit(values => {
    if (!values.message.trim() || isPending || disabled) return;
    void onSubmit(values.message.trim()).then(() => form.reset()).catch(() => undefined);
  });
  return <Form {...form}><form onSubmit={submit} className="border-t border-[#e9edf0] bg-[#fbfcfc] p-4 sm:p-5">
    {error && <p role="alert" className="mb-3 rounded-md border border-[#efd8c3] bg-[#fff8f1] px-3 py-2 text-xs text-[#99501e]">{error}</p>}
    <label htmlFor={admin ? 'admin-ticket-reply' : 'ticket-reply'} className="sr-only">Write a reply</label>
    <textarea {...form.register('message', {
      required: 'Enter a reply.',
      maxLength: { value: 10000, message: 'Replies can be up to 10,000 characters.' },
      validate: value => value.trim().length > 0 || 'Enter a reply.',
    })} id={admin ? 'admin-ticket-reply' : 'ticket-reply'} data-testid={admin ? 'input-admin-ticket-reply' : 'input-ticket-reply'} maxLength={10000} disabled={disabled || isPending} placeholder={disabled ? 'This conversation is closed.' : 'Write a reply…'} className="min-h-[94px] w-full resize-y rounded-lg border border-[#dce3e8] bg-white px-3.5 py-3 text-[13px] leading-6 text-[#263645] outline-none placeholder:text-[#98a4ad] focus:border-[#6f94b8] focus:ring-2 focus:ring-[#e0ebf5] disabled:bg-[#f3f5f6]" />
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      {form.formState.errors.message && <p role="alert" className="w-full text-xs text-[#99501e]">{form.formState.errors.message.message}</p>}
      <p className="text-[11px] text-[#8a949d]">{disabled ? 'This ticket is closed to replies.' : admin ? 'Your reply will appear in the customer’s conversation.' : reopensTicket ? 'Your reply will reopen this ticket.' : 'Replies appear in this conversation.'}</p>
      <Button type="submit" testId={admin ? 'button-send-admin-reply' : 'button-send-ticket-reply'} disabled={disabled || isPending || !message.trim()}><span>{isPending ? 'Sending…' : 'Send reply'}</span>{isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</Button>
    </div>
  </form></Form>;
}

function TicketQueue<T extends SupportTicketSummary>({
  items, selectedId, onSelect, loading, error, retry, admin = false,
}: {
  items: T[];
  selectedId?: string;
  onSelect: (id: string) => void;
  loading: boolean;
  error: boolean;
  retry: () => void;
  admin?: boolean;
}) {
  return <section className="overflow-hidden rounded-xl border border-[#e0e6ea] bg-white">
    <div className="flex h-[60px] items-center justify-between border-b border-[#edf0f2] px-4"><div><h2 className="text-[13px] font-bold text-[#273746]">{admin ? 'All requests' : 'Your requests'}</h2><p className="mt-0.5 text-[10px] text-[#86929c]">{loading ? 'Refreshing tickets' : `${items.length} ${items.length === 1 ? 'ticket' : 'tickets'}`}</p></div><Ticket className="h-4 w-4 text-[#9aa6af]" /></div>
    {error ? <QueryError retry={retry} /> : loading ? <QueueSkeleton /> : items.length === 0
      ? <div className="px-5 py-12 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#f0f5f7] text-[#708990]"><CircleHelp className="h-5 w-5" /></div><p className="mt-3 text-[13px] font-semibold text-[#344154]">{admin ? 'No matching requests' : 'No support requests yet'}</p><p className="mx-auto mt-1 max-w-[220px] text-[11px] leading-5 text-[#87929b]">{admin ? 'Try another search or status filter.' : 'When you contact our team, your conversation will be kept here.'}</p></div>
      : <div className="max-h-[min(70vh,760px)] overflow-y-auto p-2">
        {items.map(ticket => {
          const active = selectedId === ticket.id;
          const adminTicket = ticket as T & Partial<AdminSupportTicketSummary>;
          return <button key={ticket.id} type="button" data-testid={`button-select-ticket-${ticket.id}`} onClick={() => onSelect(ticket.id)} className={`mb-1 w-full rounded-lg border p-3.5 text-left transition-colors ${active ? 'border-[#b8cfe3] bg-[#f2f7fb]' : 'border-transparent hover:border-[#e7ebee] hover:bg-[#fafbfc]'}`}>
            <div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-[13px] font-semibold leading-5 text-[#273746]">{ticket.subject}</span><ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? 'text-[#376c9b]' : 'text-[#a4adb5]'}`} /></div>
            {admin && <div className="mt-1 truncate text-[11px] text-[#647583]">{adminTicket.requesterFirstName} {adminTicket.requesterLastName}<span className="mx-1.5 text-[#c1c8cd]">/</span>{adminTicket.requesterEmail}</div>}
            <div className="mt-2.5 flex items-center justify-between gap-2"><StatusBadge status={ticket.status} /><span className="flex items-center gap-1 text-[10px] text-[#8b969f]"><Clock3 className="h-3 w-3" />{formatDate(ticket.lastMessageAt, true)}</span></div>
          </button>;
        })}
      </div>}
  </section>;
}

function CreateTicketForm({ onCancel, onCreate, pending, error }: {
  onCancel: () => void;
  onCreate: (subject: string, message: string) => void;
  pending: boolean;
  error?: string;
}) {
  const form = useForm<{ subject: string; message: string }>({ defaultValues: { subject: '', message: '' } });
  const subject = form.watch('subject');
  const message = form.watch('message');
  const submit = form.handleSubmit(values => {
    if (!values.subject.trim() || !values.message.trim() || pending) return;
    onCreate(values.subject.trim(), values.message.trim());
  });
  return <div className="flex min-h-[560px] flex-col">
    <div className="border-b border-[#e9edf0] px-5 py-5 sm:px-7"><button type="button" data-testid="button-cancel-new-ticket" onClick={onCancel} className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#75818b] hover:text-[#174f99]"><ArrowLeft className="h-3.5 w-3.5" />Back to your tickets</button><div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-[#edf4f7] text-[#4e7385]"><LifeBuoy className="h-5 w-5" /></div><div><p className="mono text-[9px] uppercase tracking-[.14em] text-[#66808a]">A person will get back to you</p><h2 className="mt-1 text-xl font-bold tracking-[-.035em] text-[#223442]">Start a conversation</h2><p className="mt-1 text-[12px] text-[#78858e]">Tell us what you need help with. Your account team will reply here.</p></div></div></div>
    <Form {...form}><form onSubmit={submit} className="flex flex-1 flex-col gap-5 p-5 sm:p-7">
      <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">Subject</span><input {...form.register('subject', {
        required: 'Enter a subject.',
        maxLength: { value: 160, message: 'Subjects can be up to 160 characters.' },
        validate: value => value.trim().length > 0 || 'Enter a subject.',
      })} data-testid="input-new-ticket-subject" maxLength={160} placeholder="A short summary of your question" className="h-11 w-full rounded-md border border-[#d8e0e7] bg-white px-3 text-[13px] text-[#1e2d3d] outline-none transition focus:border-[#5c88b6] focus:ring-2 focus:ring-[#dce9f5] placeholder:text-[#9aa5b0]" /></label>
      <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">What can we help with?</span><textarea {...form.register('message', {
        required: 'Enter a message.',
        maxLength: { value: 10000, message: 'Messages can be up to 10,000 characters.' },
        validate: value => value.trim().length > 0 || 'Enter a message.',
      })} data-testid="input-new-ticket-message" maxLength={10000} placeholder="Share the details that will help us understand the issue…" className="min-h-[170px] w-full resize-y rounded-md border border-[#d8e0e7] bg-white px-3 py-3 text-[13px] leading-6 text-[#1e2d3d] outline-none placeholder:text-[#9aa5b0] focus:border-[#5c88b6] focus:ring-2 focus:ring-[#dce9f5]" /></label>
      {(form.formState.errors.subject || form.formState.errors.message) && <p role="alert" className="text-xs text-[#99501e]">{form.formState.errors.subject?.message || form.formState.errors.message?.message}</p>}
      {error && <p role="alert" className="rounded-md border border-[#efd8c3] bg-[#fff8f1] px-3 py-2.5 text-xs text-[#99501e]">{error}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-5"><p className="text-[11px] text-[#87929b]">A reply will appear in this conversation.</p><Button type="submit" testId="button-create-support-ticket" disabled={pending || !subject.trim() || !message.trim()}>{pending ? 'Opening ticket…' : 'Open support ticket'}{pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}</Button></div>
    </form></Form>
  </div>;
}

export function SupportTicketsPage() {
  const queryClient = useQueryClient();
  const list = useListSupportTickets({
    query: { queryKey: getListSupportTicketsQueryKey(), refetchInterval: 30_000 },
  });
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    new URLSearchParams(window.location.search).get('ticketId') || undefined,
  );
  const [creating, setCreating] = useState(false);
  const selectedTicketId = selectedId || list.data?.items[0]?.id;
  const detail = useGetSupportTicket(selectedTicketId || '', {
    query: {
      enabled: !!selectedTicketId,
      queryKey: getGetSupportTicketQueryKey(selectedTicketId || ''),
      refetchInterval: 30_000,
    },
  });
  const create = useCreateSupportTicket();
  const reply = useReplyToSupportTicket();
  const selected = detail.data?.ticket;

  const openTicket = (subject: string, message: string) => create.mutate({ data: { subject, message } }, {
    onSuccess: response => {
      queryClient.setQueryData(getGetSupportTicketQueryKey(response.ticket.id), response);
      void queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
      setSelectedId(response.ticket.id);
      setCreating(false);
    },
  });
  const sendReply = (message: string) => {
    if (!selectedTicketId) return Promise.reject(new Error('Select a support ticket first.'));
    return reply.mutateAsync({ ticketId: selectedTicketId, data: { message } }).then(() => {
      void queryClient.invalidateQueries({ queryKey: getGetSupportTicketQueryKey(selectedTicketId) });
      void queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
    });
  };

  return <main data-testid="page-customer-support" className="min-h-[100dvh] bg-[#f5f7f7] px-4 py-7 text-[#20303d] sm:px-6 lg:px-9 lg:py-9">
    <div className="mx-auto max-w-[1260px]">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><div className="mono mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-[#71858a]"><span className="h-px w-5 bg-[#df8a48]" />ACCOUNT SERVICE</div><h1 className="text-[30px] font-bold leading-tight tracking-[-.05em] text-[#20343f] sm:text-[34px]">Support</h1><p className="mt-2 max-w-xl text-[13px] leading-6 text-[#718087]">A direct line to the people behind Mailflow. Your account questions and replies stay together here.</p></div>
        {!creating && <Button testId="button-new-support-ticket" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New ticket</Button>}
      </header>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,350px)_minmax(0,1fr)]">
        <div className={creating ? 'hidden lg:block' : ''}>
          <TicketQueue items={list.data?.items || []} selectedId={selectedTicketId} onSelect={id => { setSelectedId(id); setCreating(false); }} loading={list.isLoading} error={list.isError} retry={() => void list.refetch()} />
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-[#e2e9e9] bg-[#edf3f1] p-4"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4f8177]" /><p className="text-[11px] leading-5 text-[#687c78]">Conversations are visible only to you and the Mailflow support team.</p></div>
        </div>
        <section className="min-h-[560px] overflow-hidden rounded-xl border border-[#e0e6ea] bg-white shadow-[0_4px_18px_rgba(41,64,74,.035)]">
          {creating ? <CreateTicketForm onCancel={() => setCreating(false)} onCreate={openTicket} pending={create.isPending} error={create.isError ? errorMessage(create.error) : undefined} /> :
          selectedTicketId ? detail.isError ? <QueryError retry={() => void detail.refetch()} /> : detail.isLoading ? <div className="space-y-5 p-6" aria-label="Loading ticket"><div className="h-5 w-2/5 animate-pulse rounded bg-[#e9eef0]" /><div className="h-3 w-1/4 animate-pulse rounded bg-[#eff2f3]" /><div className="mt-12 h-24 animate-pulse rounded-lg bg-[#f2f5f5]" /><div className="ml-auto h-24 w-3/4 animate-pulse rounded-lg bg-[#edf3f6]" /></div> :
            <><div className="border-b border-[#e9edf0] px-5 py-5 sm:px-7"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><button type="button" aria-label="Back to ticket list" data-testid="button-back-ticket-list" onClick={() => setSelectedId(undefined)} className="mr-1 rounded-md p-1.5 text-[#78858e] hover:bg-[#f3f6f7] lg:hidden"><ArrowLeft className="h-4 w-4" /></button><StatusBadge status={selected?.status || 'open'} /><span className="text-[11px] text-[#8a969e]">Opened {selected ? formatDate(selected.createdAt, true) : ''}</span></div><span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[#839098]"><Clock3 className="h-3.5 w-3.5" />Updated {selected ? formatDate(selected.lastMessageAt, true) : ''}</span></div><h2 data-testid="text-selected-ticket-subject" className="mt-3 text-[19px] font-bold leading-snug tracking-[-.03em] text-[#243642]">{selected?.subject}</h2></div>
              <div className="min-h-[330px] px-5 py-6 sm:px-7"><MessageThread messages={detail.data?.messages || []} /></div>
              <ReplyBox onSubmit={sendReply} isPending={reply.isPending} error={reply.isError ? errorMessage(reply.error) : undefined} reopensTicket={selected?.status === 'closed' || selected?.status === 'resolved'} /></>
          : <div className="grid min-h-[560px] place-items-center px-6 py-12 text-center"><div className="max-w-[300px]"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#edf4f5] text-[#5f7e83]"><MessageSquareText className="h-6 w-6" /></div><h2 className="mt-4 text-[17px] font-bold text-[#293d49]">Your support conversation</h2><p className="mt-2 text-[12px] leading-5 text-[#7c8990]">Choose a ticket to read the conversation, or start a new one whenever you need us.</p><Button testId="button-empty-new-ticket" onClick={() => setCreating(true)} className="mt-5"><Plus className="h-4 w-4" />Open a ticket</Button></div></div>}
        </section>
      </div>
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8e8] pt-4 text-[10px] text-[#8b979b]"><span className="flex items-center gap-2"><LifeBuoy className="h-3.5 w-3.5" />Mailflow account service</span><span>Ticket replies are handled by our support team.</span></footer>
    </div>
  </main>;
}

const adminStatusOptions: Array<{ value: ListAdminSupportTicketsParams['status']; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_on_customer', label: 'Waiting on customer' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export function AdminSupportTicketsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ListAdminSupportTicketsParams['status']>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const params = useMemo<ListAdminSupportTicketsParams>(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    status: status || 'all',
  }), [search, status]);
  const list = useListAdminSupportTickets(params, {
    query: { queryKey: getListAdminSupportTicketsQueryKey(params), refetchInterval: 30_000 },
  });
  const selectedTicketId = (selectedId && list.data?.items.some(item => item.id === selectedId) ? selectedId : undefined) || list.data?.items[0]?.id;
  const detail = useGetAdminSupportTicket(selectedTicketId || '', {
    query: {
      enabled: !!selectedTicketId,
      queryKey: getGetAdminSupportTicketQueryKey(selectedTicketId || ''),
      refetchInterval: 30_000,
    },
  });
  const reply = useReplyToAdminSupportTicket();
  const updateStatus = useUpdateAdminSupportTicketStatus();
  const ticket = detail.data?.ticket;

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListAdminSupportTicketsQueryKey() }),
    selectedTicketId ? queryClient.invalidateQueries({ queryKey: getGetAdminSupportTicketQueryKey(selectedTicketId) }) : Promise.resolve(),
  ]);
  const sendReply = (message: string) => {
    if (!selectedTicketId) return Promise.reject(new Error('Select a support ticket first.'));
    return reply.mutateAsync({ ticketId: selectedTicketId, data: { message } }).then(() => { void refresh(); });
  };
  const changeStatus = (nextStatus: TicketStatus) => {
    if (!selectedTicketId || nextStatus === ticket?.status) return;
    updateStatus.mutate({ ticketId: selectedTicketId, data: { status: nextStatus } }, {
      onSuccess: response => {
        queryClient.setQueryData(getGetAdminSupportTicketQueryKey(selectedTicketId), response);
        void queryClient.invalidateQueries({ queryKey: getListAdminSupportTicketsQueryKey() });
      },
    });
  };

  return <main data-testid="page-admin-support" className="min-h-[100dvh] bg-[#f4f6f6] px-4 py-7 text-[#20303d] sm:px-6 lg:px-9 lg:py-9">
    <div className="mx-auto max-w-[1440px]">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><div className="mono mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-[#71858a]"><span className="h-px w-5 bg-[#df8a48]" />PLATFORM ACCOUNT SERVICE</div><h1 className="text-[30px] font-bold leading-tight tracking-[-.05em] text-[#20343f] sm:text-[34px]">Support desk</h1><p className="mt-2 max-w-xl text-[13px] leading-6 text-[#718087]">Customer conversations, handled directly by the Mailflow team.</p></div>
        <div className="flex items-center gap-2 rounded-lg border border-[#dce5e4] bg-[#edf3f1] px-3.5 py-2.5 text-[11px] font-medium text-[#668078]"><ShieldCheck className="h-4 w-4" />Superadmin workspace</div>
      </header>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[230px] flex-1 sm:max-w-[410px]"><span className="sr-only">Search tickets and requesters</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#89969e]" /><input data-testid="input-admin-support-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search subject, name, or email" maxLength={160} className="h-10 w-full rounded-md border border-[#dce3e7] bg-white pl-9 pr-9 text-[12px] text-[#344154] outline-none placeholder:text-[#98a3ab] focus:border-[#6e94b7] focus:ring-2 focus:ring-[#e0ebf5]" />{search && <button type="button" aria-label="Clear search" data-testid="button-clear-support-search" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#8a959d] hover:bg-[#f1f4f5]"><X className="h-3.5 w-3.5" /></button>}</label>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-[#65747e]"><span>Status</span><select data-testid="select-admin-support-status-filter" value={status} onChange={event => setStatus(event.target.value as ListAdminSupportTicketsParams['status'])} className="h-10 min-w-[160px] rounded-md border border-[#dce3e7] bg-white px-3 text-[12px] font-medium text-[#344154] outline-none focus:border-[#6e94b7] focus:ring-2 focus:ring-[#e0ebf5]">{adminStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {list.isFetching && !list.isLoading && <span className="flex items-center gap-1.5 text-[10px] text-[#8a969e]"><LoaderCircle className="h-3 w-3 animate-spin" />Updating</span>}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(310px,390px)_minmax(0,1fr)]">
        <TicketQueue items={list.data?.items || []} selectedId={selectedTicketId} onSelect={setSelectedId} loading={list.isLoading} error={list.isError} retry={() => void list.refetch()} admin />
        <section className="min-h-[590px] overflow-hidden rounded-xl border border-[#e0e6ea] bg-white shadow-[0_4px_18px_rgba(41,64,74,.035)]">
          {!selectedTicketId ? <div className="grid min-h-[590px] place-items-center px-6 py-12 text-center"><div className="max-w-[320px]"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#edf4f5] text-[#5f7e83]"><MessageSquareText className="h-6 w-6" /></div><h2 className="mt-4 text-[17px] font-bold text-[#293d49]">Select a customer request</h2><p className="mt-2 text-[12px] leading-5 text-[#7c8990]">Choose a conversation from the queue to review the account details and reply.</p></div></div>
          : detail.isError ? <QueryError retry={() => void detail.refetch()} /> : detail.isLoading ? <div className="space-y-5 p-6" aria-label="Loading conversation"><div className="h-5 w-2/5 animate-pulse rounded bg-[#e9eef0]" /><div className="h-14 w-1/2 animate-pulse rounded bg-[#f0f3f4]" /><div className="mt-12 h-24 animate-pulse rounded-lg bg-[#f2f5f5]" /><div className="ml-auto h-24 w-3/4 animate-pulse rounded-lg bg-[#edf3f6]" /></div> :
            <><div className="border-b border-[#e9edf0] px-5 py-5 sm:px-7"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={ticket?.status || 'open'} /><span className="text-[10px] text-[#8b969f]">Opened {ticket ? formatDate(ticket.createdAt) : ''}</span></div><h2 data-testid="text-admin-selected-ticket-subject" className="mt-3 text-[19px] font-bold leading-snug tracking-[-.03em] text-[#243642]">{ticket?.subject}</h2><div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-[#f6f8f8] p-3">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e6eee9] text-[11px] font-bold text-[#4e7465]">{initials(`${ticket?.requesterFirstName || ''} ${ticket?.requesterLastName || ''}`)}</span>
                    <span className="min-w-0"><span data-testid="text-support-requester-name" className="block text-[12px] font-semibold text-[#344154]">{ticket?.requesterFirstName} {ticket?.requesterLastName}</span><span data-testid="text-support-requester-email" className="block truncate text-[11px] text-[#78858e]">{ticket?.requesterEmail}</span></span>
                  </div></div>
                  <label className="block min-w-[168px] space-y-1.5"><span className="mono text-[9px] uppercase tracking-[.13em] text-[#7f8b91]">Ticket status</span><select data-testid="select-admin-ticket-status" value={ticket?.status || 'open'} disabled={updateStatus.isPending} onChange={event => changeStatus(event.target.value as TicketStatus)} className="h-10 w-full rounded-md border border-[#dce3e7] bg-white px-3 text-[12px] font-semibold text-[#344154] outline-none focus:border-[#6e94b7] focus:ring-2 focus:ring-[#e0ebf5] disabled:opacity-60">{statuses.map(item => <option key={item} value={item}>{statusNames[item]}</option>)}</select>{updateStatus.isPending && <span className="block text-[10px] text-[#87939a]">Saving status…</span>}</label>
                </div>{updateStatus.isError && <p role="alert" className="mt-3 text-xs text-[#99501e]">{errorMessage(updateStatus.error)}</p>}</div>
              <div className="min-h-[330px] px-5 py-6 sm:px-7"><MessageThread messages={detail.data?.messages || []} admin /></div>
              <ReplyBox onSubmit={sendReply} isPending={reply.isPending} error={reply.isError ? errorMessage(reply.error) : undefined} admin disabled={ticket?.status === 'closed'} /></>}
        </section>
      </div>
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8e8] pt-4 text-[10px] text-[#8b979b]"><span className="flex items-center gap-2"><LifeBuoy className="h-3.5 w-3.5" />Mailflow support desk</span><span>Replies are sent by the signed-in support team member.</span></footer>
    </div>
  </main>;
}
