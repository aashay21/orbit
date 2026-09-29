const paths: Record<string, string> = {
  board: "M3 5.5A1.5 1.5 0 0 1 4.5 4h2A1.5 1.5 0 0 1 8 5.5v13A1.5 1.5 0 0 1 6.5 20h-2A1.5 1.5 0 0 1 3 18.5zM10 5.5A1.5 1.5 0 0 1 11.5 4h2A1.5 1.5 0 0 1 15 5.5v8a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5zM17 5.5A1.5 1.5 0 0 1 18.5 4h1A1.5 1.5 0 0 1 21 5.5v4A1.5 1.5 0 0 1 19.5 11h-1A1.5 1.5 0 0 1 17 9.5z",
  report: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  check: "m5 12 5 5 9-10",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  auto: "M12 21a9 9 0 1 0 0-18v18z M12 3a9 9 0 0 1 0 18",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  flag: "M5 21V4M5 4h12l-2 4 2 4H5",
  calendar: "M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4 10h16M8 2v4M16 2v4",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  note: "M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  chevron: "m9 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
  left: "m15 6-6 6 6 6",
  right: "m9 6 6 6-6 6",
  restore: "M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};

export function Icon({ name, size = 16, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

/** Claude's four-point spark, used wherever Claude made a change. */
export function Spark({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2c.6 4.8 2.9 8.3 10 10-7.1 1.7-9.4 5.2-10 10-.6-4.8-2.9-8.3-10-10 7.1-1.7 9.4-5.2 10-10z" />
    </svg>
  );
}
