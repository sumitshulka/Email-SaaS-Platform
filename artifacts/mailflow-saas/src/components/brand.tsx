export function MailflowIcon({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#142035"/>
      <path d="M7 25V10l9 9 9-9" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19.5 7.5H25V13" stroke="#E83D4A" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function MailflowBrand({ small = false }: { small?: boolean }) {
  return (
    <span className={`inline-flex items-center ${small ? 'gap-2' : 'gap-2.5'}`}>
      <MailflowIcon className={small ? 'h-7 w-7' : 'h-8 w-8'}/>
      <span className={`display lowercase font-extrabold leading-none tracking-[-.04em] text-[#142035] ${small ? 'text-[19px]' : 'text-[21px]'}`}>mailflow</span>
    </span>
  );
}
