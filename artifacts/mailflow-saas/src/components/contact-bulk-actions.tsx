import { useState } from "react";
import type { ContactBulkUpdate, ContactList } from "@workspace/api-client-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

type Props = {
  count: number;
  lists: ContactList[];
  listsUnavailable: boolean;
  pending: boolean;
  onClear: () => void;
  onApply: (action: Omit<ContactBulkUpdate, "contactIds">) => void;
};

export function ContactBulkActions({ count, lists, listsUnavailable, pending, onClear, onApply }: Props) {
  const [listId, setListId] = useState("");
  const [confirmAction, setConfirmAction] = useState<"subscribe" | "unsubscribe" | null>(null);
  const [consent, setConsent] = useState(false);
  const buttonClass = "rounded-md border border-[#cbd8e3] bg-white px-3 py-2 text-[11px] font-semibold text-[#315879] disabled:opacity-50";
  return (
    <div className="space-y-3 border-b border-[#dce5ec] bg-[#eef5fc] px-5 py-4" data-testid="contact-bulk-actions">
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#315879]">
        <strong>{count.toLocaleString()} selected across pages</strong>
        <button type="button" disabled={pending} onClick={onClear} className="text-[11px] underline disabled:opacity-50">Clear selection</button>
        <span className="text-[10px]">Up to 1,000 contacts per action.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="List for selected contacts" value={listId} disabled={pending || listsUnavailable}
          onChange={event => setListId(event.target.value)}
          className="h-9 max-w-full rounded-md border border-[#cbd8e3] bg-white px-2 text-[12px]">
          <option value="">Choose a list</option>
          {lists.map(list => <option key={list.id} value={list.id}>{list.name}{list.active ? "" : " (inactive)"}</option>)}
        </select>
        <button type="button" className={buttonClass} disabled={pending || !listId || listsUnavailable || !lists.some(list => list.id === listId)}
          onClick={() => onApply({ action: "add_to_list", listId })}>Add to list</button>
        <button type="button" className={buttonClass} disabled={pending}
          onClick={() => { setConsent(false); setConfirmAction("subscribe"); }}>Mark subscribed</button>
        <button type="button" className={buttonClass} disabled={pending}
          onClick={() => setConfirmAction("unsubscribe")}>Mark unsubscribed</button>
      </div>
      <p className="text-[11px] text-[#586e82]">Adding to a list keeps existing memberships and does not change subscription status.</p>
      {listsUnavailable && <p role="alert" className="text-[11px] text-[#a84926]">Lists could not be loaded. Retry loading the page to assign a list.</p>}
      {!listsUnavailable && lists.length === 0 && <p className="text-[11px] text-[#586e82]">Create a list on the Lists page before assigning contacts.</p>}
      <AlertDialog open={confirmAction !== null} onOpenChange={open => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {count.toLocaleString()} contacts {confirmAction === "subscribe" ? "subscribed" : "unsubscribed"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "subscribe"
                ? "Only subscribe people who have given permission to receive your emails. Bounced addresses will be skipped. Previously suppressed campaign emails will not be requeued."
                : "These contacts will no longer be eligible for campaign emails. Emails still queued will be suppressed; an email already being sent cannot be recalled."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmAction === "subscribe" && <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 accent-[#174f99]" />
            I confirm these contacts have given permission to receive emails.
          </label>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending || (confirmAction === "subscribe" && !consent)}
              onClick={() => { if (confirmAction) onApply({ action: confirmAction, consentConfirmed: consent }); }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
