import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleAlert, ContactRound, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import {
  getListContactsQueryKey,
  useCreateContact,
  useDeleteContact,
  useListContacts,
} from "@workspace/api-client-react";
import type { ContactInput } from "@workspace/api-client-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

function requestError(error: unknown): string {
  if (error && typeof error === "object") {
    if ("data" in error && error.data && typeof error.data === "object" && "error" in error.data) {
      const message = error.data.error;
      if (typeof message === "string") return message;
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "The request could not be completed. Please try again.";
}

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const contactsQuery = useListContacts();
  const createContact = useCreateContact();
  const deleteContact = useDeleteContact();
  const form = useForm<ContactInput>({
    defaultValues: { firstName: "", lastName: "", email: "" },
  });
  const data = contactsQuery.data;
  const progress = data && data.quota.limit > 0
    ? Math.min(100, (data.quota.used / data.quota.limit) * 100)
    : 0;

  const submit = (values: ContactInput) => {
    createContact.mutate(
      { data: { firstName: values.firstName.trim(), lastName: values.lastName.trim(), email: values.email.trim().toLowerCase() } },
      {
        onSuccess: () => {
          form.reset();
          void queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        },
      },
    );
  };

  const remove = (contactId: string) => {
    deleteContact.mutate(
      { contactId },
      { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() }) },
    );
  };

  if (contactsQuery.isLoading) {
    return (
      <div className="space-y-5" aria-label="Loading contacts" data-testid="loading-contacts">
        <div className="h-8 w-56 animate-pulse rounded bg-[#e9eef2]" />
        <div className="h-32 animate-pulse rounded-lg bg-[#edf1f4]" />
        <div className="h-72 animate-pulse rounded-lg bg-[#edf1f4]" />
      </div>
    );
  }

  if (contactsQuery.isError || !data) {
    return (
      <section className="rounded-lg border border-[#e1e6eb] bg-white p-6" data-testid="error-contacts">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 text-[#bd692d]" />
          <div>
            <h1 className="text-[15px] font-semibold text-[#1d2d40]">Contacts could not be loaded</h1>
            <p className="mt-1 text-[12px] text-[#748292]">No contacts were changed.</p>
            <button
              data-testid="button-retry-contacts"
              onClick={() => void contactsQuery.refetch()}
              className="mt-4 rounded-md border border-[#d5dfe7] px-3 py-2 text-[11px] font-semibold text-[#315879]"
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  const quota = data.quota;
  const atLimit = !quota.canAdd && !quota.requiresSubscription;

  return (
    <div className="fade-in space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#75869a]">WORKSPACE / CONTACTS</div>
          <h1 className="display text-[32px] font-bold leading-tight text-[#192a3d]">Contacts</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#6c7b8b]">
            Save and manage the people in your workspace. Each contact counts toward your package limit.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md border border-[#dfe7ed] bg-[#f6f9fb] px-3 py-2 text-[11px] text-[#53677b]">
          <ContactRound className="h-4 w-4 text-[#3374a9]" />
          {quota.used.toLocaleString()} of {quota.limit.toLocaleString()} contacts
        </span>
      </header>

      <section className="rounded-lg border border-[#dce5ec] bg-white p-5 md:p-6" data-testid="contact-quota">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mono text-[9px] uppercase tracking-[.16em] text-[#8290a0]">CONTACT CAPACITY</div>
            <h2 className="mt-2 text-[15px] font-bold text-[#20354a]">
              {quota.requiresSubscription
                ? "An active package is required to add contacts"
                : `${quota.remaining.toLocaleString()} contact${quota.remaining === 1 ? "" : "s"} remaining`}
            </h2>
            <p className="mt-1 text-[11px] text-[#758394]">
              {quota.requiresSubscription
                ? "Your saved contacts remain available. Choose a package to add more."
                : "The lower of your package allowance and the platform contact ceiling applies."}
            </p>
          </div>
          {quota.requiresSubscription && (
            <Link href="/plans" data-testid="link-contacts-plans" className="inline-flex items-center gap-2 rounded-md bg-[#174f99] px-3.5 py-2.5 text-[11px] font-semibold text-white no-underline">
              View packages <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-[#edf1f4]"
          role="progressbar"
          aria-label="Contact limit used"
          aria-valuemin={0}
          aria-valuemax={quota.limit}
          aria-valuenow={Math.min(quota.used, quota.limit)}
          data-testid="progress-contact-quota"
        >
          <div className="h-full rounded-full bg-[#3a78a9] transition-all" style={{ width: `${progress}%` }} />
        </div>
        {atLimit && (
          <p data-testid="status-contact-limit-reached" role="status" className="mt-3 text-[11px] text-[#965323]">
            Your limit is full. Remove a contact or choose a package with a higher contact allowance. Existing contacts are kept if a package limit is reduced.
          </p>
        )}
        {quota.requiresSubscription && quota.used > 0 && (
          <p className="mt-3 text-[11px] text-[#6f7f8f]">
            Your current contacts are kept, but adding contacts is disabled until your subscription is active.
          </p>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.72fr)]">
        <div className="overflow-hidden rounded-lg border border-[#e1e6eb] bg-white">
          <div className="flex items-center justify-between border-b border-[#e9edf1] px-5 py-4">
            <div>
              <h2 className="text-[14px] font-bold text-[#1d2d40]">Saved contacts</h2>
              <p className="mt-1 text-[11px] text-[#788696]">{data.contacts.length.toLocaleString()} saved</p>
            </div>
          </div>
          {data.contacts.length === 0 ? (
            <div className="grid min-h-52 place-items-center p-8 text-center" data-testid="empty-contacts">
              <div>
                <ContactRound className="mx-auto h-7 w-7 text-[#8396a8]" />
                <h3 className="mt-3 text-[14px] font-semibold text-[#2b3c4e]">No contacts saved yet</h3>
                <p className="mt-1 text-[12px] text-[#778797]">Add a name and email address to create your first contact.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#edf0f2]">
              {data.contacts.map((contact) => (
                <article
                  key={contact.id}
                  data-testid={`row-contact-${contact.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <h3 data-testid={`text-contact-name-${contact.id}`} className="truncate text-[13px] font-semibold text-[#26374a]">{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.name}</h3>
                    <p data-testid={`text-contact-email-${contact.id}`} className="mt-1 truncate text-[11px] text-[#758394]">{contact.email}</p>
                    <p className="mt-1 text-[10px] text-[#8994a0]">Added {new Date(contact.createdAt).toLocaleDateString()}</p>
                  </div>
                  <button
                    data-testid={`button-delete-contact-${contact.id}`}
                    type="button"
                    onClick={() => remove(contact.id)}
                    disabled={deleteContact.isPending}
                    aria-label={`Delete ${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email}`}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#e2e6ea] px-3 text-[11px] font-semibold text-[#7b4b42] hover:bg-[#fff6f3] disabled:opacity-50"
                  >
                    {deleteContact.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Remove
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        <section className="h-fit rounded-lg border border-[#e1e6eb] bg-white p-5 md:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-[#edf4fa] text-[#265e91]"><Plus className="h-4 w-4" /></span>
            <div>
              <h2 className="text-[14px] font-bold text-[#1d2d40]">Add a contact</h2>
              <p className="mt-0.5 text-[11px] text-[#788696]">Names and email addresses are private to your workspace.</p>
            </div>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="mt-5 space-y-4">
              <FormField
                control={form.control}
                name="firstName"
                rules={{
                  required: "Enter a first name.",
                  maxLength: { value: 100, message: "Up to 100 characters." },
                  validate: value => value.trim().length > 0 || "Enter a first name.",
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <input
                        {...field}
                        data-testid="input-contact-first-name"
                        maxLength={100}
                        disabled={!quota.canAdd || createContact.isPending}
                        placeholder="e.g. Alex"
                        className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8] disabled:bg-[#f3f5f7]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                rules={{
                  required: "Enter a last name.",
                  maxLength: { value: 100, message: "Up to 100 characters." },
                  validate: value => value.trim().length > 0 || "Enter a last name.",
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <input
                        {...field}
                        data-testid="input-contact-last-name"
                        maxLength={100}
                        disabled={!quota.canAdd || createContact.isPending}
                        placeholder="e.g. Morgan"
                        className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8] disabled:bg-[#f3f5f7]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                rules={{
                  required: "Enter an email address.",
                  maxLength: { value: 254, message: "Email addresses can be up to 254 characters." },
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address." },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address</FormLabel>
                    <FormControl>
                      <input
                        {...field}
                        data-testid="input-contact-email"
                        type="email"
                        autoComplete="email"
                        maxLength={254}
                        disabled={!quota.canAdd || createContact.isPending}
                        placeholder="alex@example.com"
                        className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8] disabled:bg-[#f3f5f7]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {createContact.isError && (
                <p role="alert" data-testid="status-contact-create-error" className="text-[12px] text-[#a84926]">
                  {requestError(createContact.error)}
                </p>
              )}
              {deleteContact.isError && (
                <p role="alert" data-testid="status-contact-delete-error" className="text-[12px] text-[#a84926]">
                  {requestError(deleteContact.error)}
                </p>
              )}
              <button
                data-testid="button-submit-contact"
                type="submit"
                disabled={!quota.canAdd || createContact.isPending}
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createContact.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {createContact.isPending ? "Saving contact" : "Save contact"}
              </button>
            </form>
          </Form>
        </section>
      </section>
    </div>
  );
}