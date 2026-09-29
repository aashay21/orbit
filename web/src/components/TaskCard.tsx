import { memo, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Project, Tag, Task } from "@shared/types";
import { useStore } from "../store";
import { cx, dueInfo, PRIORITY_META, projectPath } from "../util";
import { Icon, Spark } from "./Icon";
import { PriorityBars } from "./ui";
import { describeRecurrence } from "@shared/recurrence";

interface CardProps {
  task: Task;
  project: Project | undefined;
  projects: Project[];
  tags: Tag[];
  done: boolean;
  lifted?: boolean;
}

export const CardBody = memo(function CardBody({ task, project, projects, tags, done, lifted }: CardProps) {
  const acc = project?.color ?? "#94a3b8";
  const pm = PRIORITY_META[task.priority];
  const path = projectPath(projects, task.projectId);
  const due = task.dueDate ? dueInfo(task.dueDate, done) : null;
  const taskTags = tags.filter((t) => task.tagIds.includes(t.id));
  const reminder = task.remindAt && !done && new Date(task.remindAt) > new Date() ? task.remindAt : null;
  const hasMeta = due || reminder || task.recurrence || task.subtasksTotal > 0 || taskTags.length > 0 || task.lastActor === "claude" || task.notesCount > 0;

  return (
    <article className={cx("card", done && "done", lifted && "lifted", task.blockedReason && !done && "blocked")} style={{ ["--acc" as string]: acc }}>
      <div className="r1">
        <span className="tid">{task.key}</span>
        {done ? (
          <span className="check"><Icon name="check" size={9} /></span>
        ) : pm.level > 0 ? (
          <span className="prio-wrap" style={{ ["--p" as string]: pm.color }} title={`${pm.label} priority`}>
            {pm.level >= 3 && pm.label.toUpperCase()}
            <PriorityBars level={pm.level} color={pm.color} pulse={task.priority === "urgent"} />
          </span>
        ) : null}
      </div>
      <h4>{task.title}</h4>
      {task.blockedReason && !done && <div className="blocked-line" title={task.blockedReason}><Icon name="block" size={12} /><span>{task.blockedReason}</span></div>}
      <div className="path">
        <i />
        {path.map((p, i) => <span key={i}>{i > 0 && <b> › </b>}{p}</span>)}
      </div>
      {hasMeta && (
        <div className="meta">
          {due && <span className={cx("due", due.state)}><Icon name="clock" size={12} />{due.label}</span>}
          {reminder && <span className="bell-ic" title={`Reminder ${new Date(reminder).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}><Icon name="bell" size={12} /></span>}
          {task.recurrence && !task.nextKey && <span className="repeat-ic" title={describeRecurrence(task.recurrence)}><Icon name="repeat" size={12} /></span>}
          {task.subtasksTotal > 0 && <SubtaskRing done={task.subtasksDone} total={task.subtasksTotal} color={acc} />}
          {task.notesCount > 0 && <span className="notes-count" title={`${task.notesCount} note${task.notesCount === 1 ? "" : "s"}`}><Icon name="note" size={12} />{task.notesCount}</span>}
          <span className="end">
            {taskTags.slice(0, 2).map((t) => <span key={t.id} className="tag" style={{ ["--t" as string]: t.color }}>{t.name}</span>)}
            {taskTags.length > 2 && <span className="tag">+{taskTags.length - 2}</span>}
            {task.lastActor === "claude" && <span className="spark" title="Last updated by Claude"><Spark /></span>}
          </span>
        </div>
      )}
    </article>
  );
});

function SubtaskRing({ done, total, color }: { done: number; total: number; color: string }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" title={`${done} of ${total} subtasks done`}>
      <svg viewBox="0 0 14 14" width={13} height={13}>
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
        <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${(c * done) / total} ${c}`} transform="rotate(-90 7 7)" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      </svg>
      {done}/{total}
    </span>
  );
}

export function SortableCard(props: Omit<CardProps, "lifted">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.key,
    data: { type: "task", columnId: props.task.columnId },
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={cx("card-slot", isDragging && "placeholder")} {...attributes} {...listeners}
      onClick={() => useStore.getState().set({ openTask: props.task.key })}
      onKeyDown={(e) => {
        if (e.key === "Enter") useStore.getState().set({ openTask: props.task.key });
        else listeners?.onKeyDown?.(e);
      }}>
      <CardBody {...props} />
    </div>
  );
}
