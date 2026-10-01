import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ConfirmActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  destructive?: boolean;
  pending?: boolean;
  testId?: string;
};

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm,
  destructive = true,
  pending = false,
  testId = 'dialog-confirm-action',
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid={testId}
        className="z-[100] w-[calc(100%-2rem)] rounded-xl border border-[#dfe4ea] bg-white p-5 text-[#182333] shadow-xl sm:p-6"
      >
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="display text-[21px] font-bold text-[#172334]">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] leading-6 text-[#687484]">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel
            data-testid="button-cancel-confirmation"
            disabled={pending}
            className="mt-0 min-h-10 rounded-md border-[#d7dce3] bg-white px-4 text-[13px] font-semibold text-[#283545] hover:bg-[#f7f9fb]"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <button
              type="button"
              data-testid="button-confirm-action"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (!pending) onConfirm();
              }}
              className={`inline-flex min-h-10 items-center justify-center rounded-md border px-4 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${
                destructive
                  ? 'border-[#b85b20] bg-[#b85b20] text-white hover:bg-[#974713]'
                  : 'border-[#174f99] bg-[#174f99] text-white hover:bg-[#103f7e]'
              }`}
            >
              {pending ? 'Working…' : confirmLabel}
            </button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}