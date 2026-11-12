import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, LoaderCircle, Pencil, Plus, RotateCcw, Tags, Trash2, X } from 'lucide-react';
import {
  useCreateContactTag, useDeleteContactTag, useListContactTags, useSetContactTags, useUpdateContactTag, getListContactTagsQueryKey,
} from '@workspace/api-client-react';
import type { ContactTag } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export const MAX_CONTACT_TAGS = 2;
export const TAG_NAME_MAX = 40;

// Muted, product-derived hues (Mailflow ink blue, ember orange, sage, slate, plum, ochre)
const TAG_TONES = [
  { bg: '#eaf2fb', fg: '#1f5491', dot: '#3a78c0', border: '#cfe0f3' },
  { bg: '#fff1e5', fg: '#9a4a16', dot: '#e08238', border: '#f4d6bd' },
  { bg: '#e8f3ee', fg: '#2a6a5b', dot: '#3f8f7a', border: '#cbe3d8' },
  { bg: '#eef0f4', fg: '#3f4b5c', dot: '#7a8698', border: '#d9dee6' },
  { bg: '#f4ecf5', fg: '#6c3b74', dot: '#9a5ea3', border: '#e4d3e7' },
  { bg: '#fbf4dc', fg: '#7a5a0c', dot: '#c49a22', border: '#efe1b0' },
];
function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}

const errorText = (error: unknown, fallback = 'Something went wrong. Please try again.') => {
  if (error && typeof error === 'object') {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
    if ('message' in error && (error as { message?: string }).message) return String((error as { message: string }).message);
  }
  return fallback;
};

export function invalidateContactTagQueries(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: q => {
      const k = q.queryKey[0];
      return typeof k === 'string' && (k.startsWith('/api/contact-tags') || k === '/api/contacts' || k.startsWith('/api/contacts/') || k.startsWith('/api/contacts?'));
    },
  });
}

function validateName(raw: string, tags: ContactTag[], exceptId?: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a tag name.';
  if (name.length > TAG_NAME_MAX) return `Use ${TAG_NAME_MAX} characters or fewer.`;
  if (tags.some(t => t.id !== exceptId && t.name.trim().toLowerCase() === name.toLowerCase())) return 'You already have a tag with this name.';
  return null;
}

function useTagLibrary() {
  return useListContactTags({ query: { queryKey: getListContactTagsQueryKey(), staleTime: 0, refetchOnWindowFocus: true } });
}

/* ---------- Badges ---------- */
export function ContactTagBadge({ tag, size = 'sm' }: { tag: ContactTag; size?: 'sm' | 'md' }) {
  const t = toneFor(tag.id);
  return (
    <span
      data-testid={`badge-contact-tag-${tag.id}`}
      title={tag.name}
      style={{ backgroundColor: t.bg, color: t.fg, borderColor: t.border }}
      className={`inline-flex max-w-[150px] items-center gap-1 rounded-[4px] border font-semibold leading-none ${size === 'md' ? 'px-2 py-1 text-[12px]' : 'px-1.5 py-[3px] text-[10.5px]'}`}
    >
      <span aria-hidden style={{ backgroundColor: t.dot }} className="h-1.5 w-1.5 shrink-0 rounded-full" />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

export function ContactTagBadges({ tags }: { tags?: ContactTag[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle" aria-label={`Tags: ${tags.map(t => t.name).join(', ')}`} data-testid="list-contact-tags">
      {tags.map(tag => <ContactTagBadge key={tag.id} tag={tag} />)}
    </span>
  );
}

/* ---------- Shared bits ---------- */
const btn = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55';
const btnPrimary = `${btn} border border-[#174f99] bg-[#174f99] text-white hover:bg-[#103f7e]`;
const btnOutline = `${btn} border border-[#d7dce3] bg-white text-[#283545] hover:bg-[#f7f9fb]`;
const btnQuiet = `${btn} border border-transparent text-[#596474] hover:bg-[#f4f6f8] hover:text-[#182333]`;
const btnDanger = `${btn} border border-[#edc5a7] bg-white text-[#b85b20] hover:bg-[#fff7f0]`;
const inputCls = 'h-9 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]';

function InlineError({ message, testId, onRetry }: { message: string; testId: string; onRetry?: () => void }) {
  return (
    <div role="alert" data-testid={testId} className="flex items-start gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2 text-[12px] leading-relaxed text-[#99501e]">
      <CircleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && <button type="button" data-testid={`${testId}-retry`} onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"><RotateCcw className="h-3 w-3" />Retry</button>}
    </div>
  );
}
function Notice({ message, testId }: { message: string; testId: string }) {
  return <div role="status" data-testid={testId} className="flex items-center gap-2 rounded-md border border-[#cbe3d8] bg-[#eef7f2] px-3 py-2 text-[12px] text-[#2a6a5b]"><Check className="h-3.5 w-3.5" />{message}</div>;
}
function ListSkeleton() {
  return <div className="space-y-2" aria-label="Loading tags" data-testid="status-tags-loading">{[0, 1, 2].map(i => <div key={i} className="h-10 animate-pulse rounded-md bg-[#f1f3f5]" />)}</div>;
}

/* ---------- Library ---------- */
function LibraryBody() {
  const qc = useQueryClient();
  const list = useTagLibrary();
  const create = useCreateContactTag();
  const update = useUpdateContactTag();
  const remove = useDeleteContactTag();
  const tags = useMemo(() => [...(list.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [list.data]);

  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<{ tag: ContactTag; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ContactTag | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    const err = validateName(newName, tags);
    if (err) { setNewError(err); return; }
    const name = newName.trim();
    create.mutate({ data: { name } }, {
      onSuccess: () => { setNewName(''); setNewError(null); setNotice(`Added "${name}".`); void invalidateContactTagQueries(qc); },
      onError: error => setNewError(errorText(error, 'The tag could not be added.')),
    });
  };

  const startRename = () => {
    if (!editingId) return;
    const tag = tags.find(t => t.id === editingId);
    if (!tag) return;
    const err = validateName(editName, tags, tag.id);
    if (err) { setEditError(err); return; }
    if (editName.trim() === tag.name) { setEditingId(null); return; }
    setConfirmError(null);
    setPendingRename({ tag, name: editName.trim() });
  };

  const confirmRename = () => {
    if (!pendingRename) return;
    const { tag, name } = pendingRename;
    update.mutate({ tagId: tag.id, data: { name } }, {
      onSuccess: () => { setPendingRename(null); setEditingId(null); setNotice(`Renamed to "${name}".`); void invalidateContactTagQueries(qc); },
      onError: error => setConfirmError(errorText(error, 'The tag could not be renamed. Your edit is kept.')),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const tag = pendingDelete;
    remove.mutate({ tagId: tag.id }, {
      onSuccess: () => { setPendingDelete(null); if (editingId === tag.id) setEditingId(null); setNotice(`Deleted "${tag.name}".`); void invalidateContactTagQueries(qc); },
      onError: error => setConfirmError(errorText(error, 'The tag could not be deleted.')),
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onCreate} className="space-y-1.5">
        <label htmlFor="input-new-contact-tag" className="text-[12px] font-semibold text-[#344154]">New tag</label>
        <div className="flex gap-2">
          <input id="input-new-contact-tag" data-testid="input-new-contact-tag" value={newName} maxLength={TAG_NAME_MAX + 10} placeholder="e.g. Warm intro, Board member"
            onChange={e => { setNewName(e.target.value); setNewError(null); setNotice(null); }} className={inputCls} aria-invalid={!!newError} />
          <button type="submit" data-testid="button-create-contact-tag" disabled={create.isPending} className={btnPrimary}>
            {create.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add
          </button>
        </div>
        <div className="flex justify-between text-[11px] text-[#808a97]"><span>Private to you. Names must be unique.</span><span className="mono">{newName.trim().length}/{TAG_NAME_MAX}</span></div>
        {newError && <InlineError message={newError} testId="status-create-tag-error" />}
      </form>

      {notice && <Notice message={notice} testId="status-tag-library-success" />}

      <div>
        <div className="mono mb-2 flex items-center justify-between text-[10px] uppercase tracking-[.14em] text-[#7d8794]">
          <span>Your library</span>{list.data && <span data-testid="text-tag-count">{tags.length} {tags.length === 1 ? 'tag' : 'tags'}</span>}
        </div>
        {list.isLoading ? <ListSkeleton /> : list.isError ? (
          <InlineError message="Your tags could not be loaded." testId="status-tags-error" onRetry={() => void list.refetch()} />
        ) : tags.length === 0 ? (
          <div data-testid="status-tags-empty" className="rounded-md border border-dashed border-[#d7dce3] bg-[#f8fafc] px-4 py-6 text-center">
            <Tags className="mx-auto h-5 w-5 text-[#7d8794]" />
            <div className="mt-2 text-[13px] font-semibold text-[#283545]">No tags yet</div>
            <p className="mt-1 text-[12px] text-[#687484]">Create a tag above, then assign up to two per contact.</p>
          </div>
        ) : (
          <ul className="max-h-[320px] divide-y divide-[#eef0f3] overflow-y-auto rounded-md border border-[#e0e4e9]">
            {tags.map(tag => (
              <li key={tag.id} data-testid={`row-contact-tag-${tag.id}`} className="px-3 py-2">
                {editingId === tag.id ? (
                  <form onSubmit={e => { e.preventDefault(); startRename(); }} className="space-y-1.5">
                    <div className="flex gap-2">
                      <input autoFocus aria-label={`Rename ${tag.name}`} data-testid={`input-rename-tag-${tag.id}`} value={editName}
                        onChange={e => { setEditName(e.target.value); setEditError(null); }} className={inputCls} />
                      <button type="submit" data-testid={`button-save-rename-${tag.id}`} className={btnPrimary}>Save</button>
                      <button type="button" data-testid={`button-cancel-rename-${tag.id}`} onClick={() => { setEditingId(null); setEditError(null); }} className={btnQuiet}>Cancel</button>
                    </div>
                    {editError && <InlineError message={editError} testId="status-rename-tag-error" />}
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <ContactTagBadge tag={tag} size="md" />
                    <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label={`Rename ${tag.name}`} data-testid={`button-rename-tag-${tag.id}`} className={`${btnQuiet} min-h-8 px-2`}
                        onClick={() => { setEditingId(tag.id); setEditName(tag.name); setEditError(null); setNotice(null); }}><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label={`Delete ${tag.name}`} data-testid={`button-delete-tag-${tag.id}`} className={`${btnQuiet} min-h-8 px-2 hover:text-[#b85b20]`}
                        onClick={() => { setConfirmError(null); setNotice(null); setPendingDelete(tag); }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={!!pendingRename} onOpenChange={o => { if (!o && !update.isPending) setPendingRename(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename tag?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingRename?.tag.name}" will become "{pendingRename?.name}" on every contact that uses it. Contacts themselves are not changed otherwise.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmError && <InlineError message={confirmError} testId="status-confirm-rename-error" />}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm-rename" disabled={update.isPending}>Keep editing</AlertDialogCancel>
            <button type="button" data-testid="button-confirm-rename" disabled={update.isPending} onClick={confirmRename} className={btnPrimary}>
              {update.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{update.isPending ? 'Renaming' : 'Rename tag'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={o => { if (!o && !remove.isPending) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This tag will be removed from your library and from every contact it is assigned to. The contacts themselves are not deleted or otherwise changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmError && <InlineError message={confirmError} testId="status-confirm-delete-error" />}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-tag" disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <button type="button" data-testid="button-confirm-delete-tag" disabled={remove.isPending} onClick={confirmDelete} className={btnDanger}>
              {remove.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{remove.isPending ? 'Deleting' : 'Delete tag'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ContactTagLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[480px]" data-testid="dialog-contact-tag-library">
        <DialogHeader>
          <div className="mono text-[10px] uppercase tracking-[.16em] text-[#7d8794]">Contacts / Tags</div>
          <DialogTitle className="display text-[22px] font-bold text-[#172334]">Tag library</DialogTitle>
          <DialogDescription className="text-[12.5px] text-[#687484]">Your personal labels for recognizing contacts at a glance. Each contact can carry up to two.</DialogDescription>
        </DialogHeader>
        {open && <LibraryBody />}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Editor ---------- */
export function ContactTagEditor({ contactId, contactName, tags, onClose }: { contactId: string; contactName: string; tags: ContactTag[]; onClose: () => void }) {
  const qc = useQueryClient();
  const list = useTagLibrary();
  const setTags = useSetContactTags();
  const initial = useRef(tags.map(t => t.id));
  const [selected, setSelected] = useState<string[]>(() => tags.map(t => t.id));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const library = useMemo(() => [...(list.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [list.data]);
  // Drop selections only when a refreshed library proves a tag was deleted; otherwise keep dirty state.
  useEffect(() => {
    if (!list.data) return;
    const ids = new Set(list.data.map(t => t.id));
    setSelected(prev => (prev.every(id => ids.has(id)) ? prev : prev.filter(id => ids.has(id))));
  }, [list.data]);

  const dirty = selected.length !== initial.current.length || selected.some(id => !initial.current.includes(id));
  const atLimit = selected.length >= MAX_CONTACT_TAGS;
  const toggle = (id: string) => {
    setSaved(false);
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= MAX_CONTACT_TAGS ? prev : [...prev, id]);
  };
  const save = () => {
    setTags.mutate({ contactId, data: { tagIds: selected } }, {
      onSuccess: result => {
        initial.current = result.map(t => t.id);
        setSelected(result.map(t => t.id));
        setSaved(true);
        void invalidateContactTagQueries(qc);
      },
    });
  };
  const selectedTags = selected.map(id => library.find(t => t.id === id) ?? tags.find(t => t.id === id)).filter((t): t is ContactTag => !!t);

  return (
    <>
      <Dialog open={!libraryOpen} onOpenChange={o => { if (!o && !setTags.isPending) onClose(); }}>
        <DialogContent className="max-w-[460px]" data-testid="dialog-contact-tag-editor">
          <DialogHeader>
            <div className="mono text-[10px] uppercase tracking-[.16em] text-[#7d8794]">Assign tags</div>
            <DialogTitle className="display truncate text-[22px] font-bold text-[#172334]" data-testid="text-tag-editor-contact">{contactName}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-[#687484]">Choose up to {MAX_CONTACT_TAGS} tags from your library.</DialogDescription>
          </DialogHeader>

          <div className="flex min-h-[34px] items-center justify-between gap-2 rounded-md bg-[#f6f8fa] px-3 py-1.5">
            <div className="flex flex-wrap gap-1" data-testid="list-selected-tags">
              {selectedTags.length ? selectedTags.map(t => <ContactTagBadge key={t.id} tag={t} size="md" />) : <span className="text-[12px] text-[#808a97]">No tags selected</span>}
            </div>
            <span className="mono shrink-0 text-[11px] text-[#596474]" data-testid="text-tag-selection-count">{selected.length}/{MAX_CONTACT_TAGS}</span>
          </div>

          {list.isLoading ? <ListSkeleton /> : list.isError ? (
            <InlineError message="Your tag library could not be loaded. Your selection is kept." testId="status-editor-tags-error" onRetry={() => void list.refetch()} />
          ) : library.length === 0 ? (
            <div data-testid="status-editor-no-library" className="rounded-md border border-dashed border-[#d7dce3] bg-[#f8fafc] px-4 py-6 text-center">
              <Tags className="mx-auto h-5 w-5 text-[#7d8794]" />
              <div className="mt-2 text-[13px] font-semibold text-[#283545]">Your tag library is empty</div>
              <p className="mt-1 text-[12px] text-[#687484]">Create a few tags first, then come back to assign them.</p>
              <button type="button" data-testid="button-editor-create-tags" onClick={() => setLibraryOpen(true)} className={`${btnPrimary} mt-3`}><Plus className="h-3.5 w-3.5" />Create tags</button>
            </div>
          ) : (
            <fieldset className="max-h-[280px] space-y-1 overflow-y-auto" aria-describedby="tag-limit-hint">
              <legend className="sr-only">Tags for {contactName}</legend>
              {library.map(tag => {
                const checked = selected.includes(tag.id);
                const disabled = !checked && atLimit;
                return (
                  <label key={tag.id} data-testid={`option-contact-tag-${tag.id}`}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors ${checked ? 'border-[#bcd3ee] bg-[#f3f8fd]' : 'border-transparent hover:bg-[#f6f8fa]'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                    <input type="checkbox" data-testid={`checkbox-contact-tag-${tag.id}`} checked={checked} disabled={disabled} onChange={() => toggle(tag.id)}
                      className="h-4 w-4 accent-[#174f99]" />
                    <ContactTagBadge tag={tag} size="md" />
                  </label>
                );
              })}
            </fieldset>
          )}
          <p id="tag-limit-hint" className="text-[11px] text-[#808a97]">{atLimit ? `Limit reached. Uncheck a tag to choose another.` : `Maximum of ${MAX_CONTACT_TAGS} tags per contact.`}</p>

          {setTags.isError && <InlineError message={`${errorText(setTags.error, 'Tags could not be saved.')} Your selection is kept.`} testId="status-save-tags-error" onRetry={save} />}
          {saved && !dirty && <Notice message="Tags saved." testId="status-save-tags-success" />}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eef0f3] pt-3">
            <div className="flex gap-1">
              <button type="button" data-testid="button-open-tag-library" onClick={() => setLibraryOpen(true)} className={btnQuiet}><Tags className="h-3.5 w-3.5" />Manage library</button>
              <button type="button" data-testid="button-clear-tag-selection" disabled={!selected.length || setTags.isPending} onClick={() => { setSelected([]); setSaved(false); }} className={btnQuiet}><X className="h-3.5 w-3.5" />Clear</button>
            </div>
            <div className="flex gap-2">
              <button type="button" data-testid="button-close-tag-editor" disabled={setTags.isPending} onClick={onClose} className={btnOutline}>{saved && !dirty ? 'Done' : 'Cancel'}</button>
              <button type="button" data-testid="button-save-contact-tags" disabled={!dirty || setTags.isPending} onClick={save} className={btnPrimary}>
                {setTags.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{setTags.isPending ? 'Saving' : 'Save tags'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ContactTagLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </>
  );
}
