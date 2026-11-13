import { OPEN_NAME_PLACEHOLDER_KEYS, OPTIONAL_PLACEHOLDER_KEYS, type OptionalPlaceholderKey, type PlaceholderFallbackMap } from '@/lib/open-campaign';

const LABELS: Record<OptionalPlaceholderKey, { label: string; example: string }> = {
  firstName: { label: 'First name', example: 'there' },
  lastName: { label: 'Last name', example: 'your team' },
  fullName: { label: 'Full name', example: 'there' },
  companyName: { label: 'Company', example: 'your company' },
  phoneNumber: { label: 'Phone', example: 'your phone number' },
  linkedinUrl: { label: 'LinkedIn URL', example: 'your profile' },
};

export function PlaceholderFallbackFields({ mode, values, missing, onChange }: {
  mode: 'open' | 'standard';
  values: PlaceholderFallbackMap;
  missing: OptionalPlaceholderKey[];
  onChange: (key: OptionalPlaceholderKey, value: string) => void;
}) {
  const keys = mode === 'open' ? OPEN_NAME_PLACEHOLDER_KEYS : [...OPTIONAL_PLACEHOLDER_KEYS];
  return (
    <section data-testid="panel-placeholder-fallbacks" aria-label="Placeholder fallbacks" className="rounded-md border border-[#e4e9ef] bg-white p-3">
      <h3 className="text-[12px] font-semibold text-[#344154]">Fallback values</h3>
      <p className="mt-1 text-[11px] leading-5 text-[#687587]">
        A recipient’s actual value always takes precedence. The fallback is used only when that value is blank or whitespace.
        Every field you use (except email) needs a fallback before you continue or save
        {mode === 'standard' ? ', because contact data can change before sending.' : '. Setting a name fallback also makes that field available when some uploaded rows lack it.'}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map(key => {
          const required = missing.includes(key);
          return (
            <label key={key} className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#344154]">
                {LABELS[key].label} <span className="mono text-[10px] font-normal text-[#73869a]">{`{{${key}}}`}</span>
                {required && <span className="ml-auto text-[10px] font-semibold text-[#b85b20]">Required</span>}
              </span>
              <input
                data-testid={`input-placeholder-fallback-${key}`}
                aria-invalid={required || undefined}
                maxLength={200}
                value={values[key] ?? ''}
                onChange={event => onChange(key, event.target.value)}
                placeholder={`e.g. ${LABELS[key].example}`}
                className={`h-9 w-full rounded-md border bg-white px-3 text-[12px] text-[#182333] outline-none transition placeholder:text-[#a0a8b3] focus:ring-2 focus:ring-[#dbe8f7] ${required ? 'border-[#edc5a7] focus:border-[#b85b20]' : 'border-[#d8dde4] focus:border-[#3b73b8]'}`}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
