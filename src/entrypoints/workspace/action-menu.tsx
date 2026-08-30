import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ActionMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onSelect(): void | Promise<void>;
}

export function ActionMenu({
  label,
  icon,
  items,
  align = "end",
}: {
  label: string;
  icon: ReactNode;
  items: readonly ActionMenuItem[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="action-menu" ref={hostRef}>
      <button
        className="icon-button"
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
      </button>
      {open && (
        <div className={`action-menu-popover align-${align}`} role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.id}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                void item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
