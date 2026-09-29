import { useRef, useState } from "react";
import { format } from "date-fns";
import { describeRecurrence, nextOccurrence, parseDate, type Freq, type Recurrence } from "@shared/recurrence";
import { useStore } from "../store";
import { cx, today } from "../util";
import { Icon } from "./Icon";
import { Popover } from "./ui";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const LETTER = ["S", "M", "T", "W", "T", "F", "S"];

const PRESETS: { label: string; rule: (base: Date) => Recurrence }[] = [
  { label: "Every day", rule: () => ({ freq: "daily", interval: 1 }) },
  { label: "Every weekday", rule: () => ({ freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] }) },
  { label: "Every week", rule: (b) => ({ freq: "weekly", interval: 1, weekdays: [b.getDay()] }) },
  { label: "Every 2 weeks", rule: (b) => ({ freq: "weekly", interval: 2, weekdays: [b.getDay()] }) },
  { label: "Every month", rule: (b) => ({ freq: "monthly", interval: 1, monthDay: b.getDate() }) },
  { label: "Every year", rule: () => ({ freq: "yearly", interval: 1 }) },
];

/** Repeat control: a button with the rule in words, opening presets plus a custom editor. */
export function RecurrenceEditor({ value, dueDate, onChange }: {
  value: Recurrence | null;
  dueDate: string | null;
  onChange(r: Recurrence | null): void;
}) {
  const columns = useStore((s) => s.board?.columns ?? []);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Recurrence>(value ?? { freq: "weekly", interval: 1 });
  const base = parseDate(dueDate ?? today());
  const next = value ? nextOccurrence(value, dueDate ?? today(), today()) : null;

  const openEditor = () => {
    setDraft(value ?? { freq: "weekly", interval: 1, weekdays: [base.getDay()] });
    setOpen((o) => !o);
  };
  const apply = (r: Recurrence | null) => {
    onChange(r);
    setOpen(false);
  };
  const patch = (p: Partial<Recurrence>) => setDraft((d) => ({ ...d, ...p }));
  const toggleDay = (d: number) => {
    const days = new Set(draft.weekdays ?? []);
    if (days.has(d)) days.delete(d); else days.add(d);
    patch({ weekdays: [...days] });
  };

  return (
    <div className="recur">
      <button ref={ref} type="button" className={cx("field-btn recur-btn", value && "on")} onClick={openEditor}>
        <Icon name="repeat" size={14} />
        <span>{describeRecurrence(value)}</span>
        <Icon name="down" size={14} className="field-caret" />
      </button>
      {value && <span className="muted small recur-next">{next ? `next copy due ${format(parseDate(next), "EEE d MMM")}` : "series ends after this one"}</span>}

      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={300}>
        <div className="recur-presets">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="menu-item" onClick={() => apply({ ...p.rule(base), columnId: value?.columnId })}>
              <span>{p.label}</span>
            </button>
          ))}
          {value && <button type="button" className="menu-item danger" onClick={() => apply(null)}><span>Don't repeat</span></button>}
        </div>
        <div className="menu-sep" />
        <div className="recur-custom">
          <div className="menu-title">Custom</div>
          <div className="recur-row">
            <span className="muted small">Every</span>
            <input type="number" min={1} max={365} value={draft.interval} className="recur-n"
              onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })} />
            <select value={draft.freq} onChange={(e) => {
              const freq = e.target.value as Freq;
              patch({ freq, weekdays: freq === "weekly" ? draft.weekdays ?? [base.getDay()] : undefined, monthDay: freq === "monthly" ? base.getDate() : undefined });
            }}>
              <option value="daily">{draft.interval === 1 ? "day" : "days"}</option>
              <option value="weekly">{draft.interval === 1 ? "week" : "weeks"}</option>
              <option value="monthly">{draft.interval === 1 ? "month" : "months"}</option>
              <option value="yearly">{draft.interval === 1 ? "year" : "years"}</option>
            </select>
          </div>
          {draft.freq === "weekly" && (
            <div className="recur-days">
              {WEEK.map((d) => (
                <button key={d} type="button" className={cx("day-pill", draft.weekdays?.includes(d) && "on")} onClick={() => toggleDay(d)}>{LETTER[d]}</button>
              ))}
            </div>
          )}
          {draft.freq === "monthly" && (
            <div className="recur-row">
              <span className="muted small">On day</span>
              <input type="number" min={1} max={31} className="recur-n" value={draft.monthDay ?? base.getDate()}
                onChange={(e) => patch({ monthDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
            </div>
          )}
          <div className="recur-row">
            <span className="muted small">Ends</span>
            <input type="date" className="recur-date" value={draft.until ?? ""} onChange={(e) => patch({ until: e.target.value || null })} />
          </div>
          <div className="recur-row">
            <span className="muted small">New copy in</span>
            <select value={draft.columnId ?? ""} onChange={(e) => patch({ columnId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">First column</option>
              {columns.filter((c) => !c.isDone).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="recur-foot">
            <span className="muted small">{describeRecurrence(draft)}</span>
            <button type="button" className="btn primary" onClick={() => apply(draft)}>Set</button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
