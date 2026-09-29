import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { Project } from "@shared/types";
import { cx, flattenTree, projectTree } from "../util";
import { Icon } from "./Icon";

const spring = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;

/** Floating panel anchored to an element; closes on outside click, Escape, or scroll. */
export function Popover({ anchor, open, onClose, children, align = "start", width, className }: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  align?: "start" | "end";
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = width ?? 220;
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    const up = r.bottom + 320 > innerHeight && r.top > 320;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchor]);

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={ref}
          className={cx("popover", className)}
          style={{ top: pos.top, left: pos.left, width: width ?? 220, transformOrigin: pos.up ? "bottom" : "top", translate: pos.up ? "0 -100%" : undefined }}
          initial={{ opacity: 0, scale: 0.96, y: pos.up ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
          transition={spring}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, danger, active, hint }: {
  icon?: string;
  children: ReactNode;
  onClick(): void;
  danger?: boolean;
  active?: boolean;
  hint?: string;
}) {
  return (
    <button className={cx("menu-item", danger && "danger", active && "active")} onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}
      <span>{children}</span>
      {hint && <kbd>{hint}</kbd>}
      {active && <Icon name="check" size={14} className="menu-check" />}
    </button>
  );
}

export function Modal({ open, onClose, children, className, label }: {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <motion.div role="dialog" aria-label={label} className={cx("modal", className)}
            initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.14 } }} transition={spring}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Button that asks "Sure?" on first click and acts on the second. */
export function ConfirmButton({ children, confirmLabel = "Click again to confirm", onConfirm, className, icon }: {
  children: ReactNode;
  confirmLabel?: string;
  onConfirm(): void;
  className?: string;
  icon?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={cx("btn ghost danger", armed && "armed", className)} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {icon && <Icon name={icon} size={15} />}
      {armed ? confirmLabel : children}
    </button>
  );
}

/** Dropdown listing the project tree; used in task forms. */
export function ProjectPicker({ projects, value, onChange, placeholder = "Choose project" }: {
  projects: Project[];
  value: number | null;
  onChange(id: number): void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const flat = flattenTree(projectTree(projects));
  const current = projects.find((p) => p.id === value);
  return (
    <>
      <button ref={ref} type="button" className="field-btn" onClick={() => setOpen((o) => !o)}>
        {current ? (
          <><span className="dot" style={{ ["--acc" as string]: current.color }} />{current.name}</>
        ) : (
          <span className="muted">{placeholder}</span>
        )}
        <Icon name="down" size={14} className="field-caret" />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={260}>
        <div className="menu-scroll">
          {flat.length === 0 && <div className="menu-empty">No projects yet</div>}
          {flat.map((p) => (
            <button key={p.id} className={cx("menu-item", p.id === value && "active")} style={{ paddingLeft: 12 + p.depth * 16 }}
              onClick={() => { onChange(p.id); setOpen(false); }}>
              <span className={p.depth ? "ring-dot" : "dot"} style={{ ["--acc" as string]: p.color }} />
              <span>{p.name}</span>
              {p.key && <kbd>{p.key}</kbd>}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function PriorityBars({ level, color, pulse }: { level: number; color: string; pulse?: boolean }) {
  return (
    <span className={cx("prio", pulse && "pulse")} style={{ ["--p" as string]: color }} aria-hidden="true">
      {[1, 2, 3, 4].map((i) => <span key={i} className={i <= level ? "f" : ""} />)}
    </span>
  );
}
