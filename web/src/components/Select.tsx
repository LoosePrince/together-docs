import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean };

export default function Select({ value, options, onChange, disabled = false, placeholder = '请选择', label, className = '' }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find(option => option.value === value);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className={`select ${className}`} ref={root}>
    <button type="button" className={`select-trigger ${open ? 'open' : ''}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={label} onClick={() => setOpen(!open)}>
      <span className={!selected ? 'select-placeholder' : ''}>{selected?.label || placeholder}</span><ChevronDown size={14} />
    </button>
    {open && <div className="select-menu" role="listbox" id={listId} aria-label={label}>
      {options.map(option => <button type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} className={option.value === value ? 'is-selected' : ''} key={option.value} title={typeof option.label === 'string' ? option.label : undefined} onClick={() => { onChange(option.value); setOpen(false); }}>
        <span>{option.label}</span>{option.value === value && <Check size={14} />}
      </button>)}
    </div>}
  </div>;
}
