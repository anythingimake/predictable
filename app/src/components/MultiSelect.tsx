import { useEffect, useRef, useState } from "react";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  options: Option[];
  /** Empty array = no filter (treated as "All"). */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Optional text rendered when selected is empty. Defaults to "All". */
  emptyLabel?: string;
}

/**
 * Compact multi-select dropdown. Renders a single button that opens a
 * popover with checkboxes. Closes on click-outside or Escape.
 *
 * Selected state is a list of option values. An empty list means "no filter"
 * — the parent should interpret that as "include everything".
 */
export function MultiSelect({ label, options, selected, onChange, emptyLabel = "All" }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(value: string) {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  }

  const summary = selected.length === 0
    ? emptyLabel
    : selected.length === 1
    ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
    : `${selected.length} selected`;

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`tap inline-flex items-center gap-2 px-3 py-1.5 rounded border text-xs transition-colors ${
          selected.length > 0
            ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-surface)]"
            : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        }`}
      >
        <span className="text-[var(--color-text-faint)] uppercase tracking-wide">{label}:</span>
        <span className="font-medium">{summary}</span>
        <span className="text-[10px] opacity-60" aria-hidden>▼</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-20 mt-1 min-w-[14rem] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elev)] shadow-xl py-1"
          style={{ boxShadow: "0 6px 24px rgba(0,0,0,0.5)" }}
        >
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="tap w-full text-left px-3 py-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] border-b border-[var(--color-border)]"
            >
              Clear all
            </button>
          )}
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label
                key={o.value}
                className="tap flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--color-surface)]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.value)}
                  className="accent-[var(--color-accent)]"
                />
                <span className={checked ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}>
                  {o.label}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
