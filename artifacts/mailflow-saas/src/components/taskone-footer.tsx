export function TaskoneAttribution() {
  return (
    <span data-testid="taskone-attribution">
      Mailflow is a product of Taskone Solutions Pvt Ltd. Visit{' '}
      <a
        href="https://www.taskone.world"
        target="_blank"
        rel="noreferrer"
        className="font-semibold underline underline-offset-2"
      >
        Taskone
      </a>{' '}
      for details.
    </span>
  );
}

export function TaskoneAttributionFooter() {
  return (
    <footer data-testid="taskone-attribution-footer" className="border-t border-[#e7ebef] bg-[#fbfcfd] px-5 py-4 text-center text-[11px] leading-5 text-[#667586]">
      <TaskoneAttribution/>
    </footer>
  );
}
