import { useRef, useState } from "react";
import { addDays, format, parseISO, setHours, setMinutes, startOfDay } from "date-fns";
import { useStore } from "../store";
import { cx } from "../util";
import { Icon } from "./Icon";
import { Popover } from "./ui";

const at = (d: Date, h: number, m = 0) => setMinutes(setHours(startOfDay(d), h), m);
/** Value for <input type="datetime-local"> in local time. */
const toLocalInput = (iso: string) => format(new Date(iso), "yyyy-MM-dd'T'HH:mm");

/** "Remind me" control: quick picks, an exact date-time, or clear. Reminders arrive in Teams. */
export function RemindEditor({ value, dueDate, onChange }: { value: string | null; dueDate: string | null; onChange(iso: string | null): void }) {
  const ready = useStore((s) => s.stats?.notificationsReady ?? false);
  const set = useStore((s) => s.set);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const past = value ? new Date(value) < now : false;

  const quick: [string, Date][] = [
    ["In 1 hour", new Date(now.getTime() + 3_600_000)],
    ...(now.getHours() < 17 ? [["This evening, 18:00", at(now, 18)] as [string, Date]] : []),
    ["Tomorrow, 09:00", at(addDays(now, 1), 9)],
    ...(dueDate ? [
      ["Day before due, 09:00", at(addDays(parseISO(dueDate), -1), 9)] as [string, Date],
      ["On the due day, 09:00", at(parseISO(dueDate), 9)] as [string, Date],
    ] : []),
    ["Next Monday, 09:00", at(addDays(now, ((8 - now.getDay()) % 7) || 7), 9)],
  ].filter(([, d]) => (d as Date) > now) as [string, Date][];

  const pick = (d: Date | null) => {
    onChange(d ? d.toISOString() : null);
    setOpen(false);
  };

  return (
    <div className="remind">
      <button ref={ref} type="button" className={cx("field-btn", value && (past ? "remind-past" : "remind-on"))} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" size={14} />
        <span>{value ? `${format(new Date(value), "EEE d MMM, HH:mm")}${past ? " · sent" : ""}` : "No reminder"}</span>
        <Icon name="down" size={14} className="field-caret" />
      </button>
      {value && !ready && (
        <button type="button" className="mini-btn warn" onClick={() => set({ view: "settings", openTask: null })}>Set up Teams to get it</button>
      )}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={270}>
        {quick.map(([label, d]) => (
          <button key={label} type="button" className="menu-item" onClick={() => pick(d)}>
            <span>{label}</span><kbd>{format(d, "EEE HH:mm")}</kbd>
          </button>
        ))}
        <div className="menu-sep" />
        <div className="remind-custom">
          <span className="muted small">Exact time</span>
          <input type="datetime-local" defaultValue={value ? toLocalInput(value) : ""} min={format(now, "yyyy-MM-dd'T'HH:mm")}
            onChange={(e) => e.target.value && onChange(new Date(e.target.value).toISOString())} />
        </div>
        {value && <button type="button" className="menu-item danger" onClick={() => pick(null)}><span>Remove reminder</span></button>}
      </Popover>
    </div>
  );
}
