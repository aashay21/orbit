import { memo, useMemo } from "react";

/** Background layer: twinkling stars at night, drifting light motes at dawn. Both render; CSS shows one. */
export const Sky = memo(function Sky() {
  const stars = useMemo(
    () =>
      Array.from({ length: 150 }, (_, i) => {
        const size = Math.random() < 0.92 ? 1 + Math.random() : 2.2;
        return (
          <span key={i} className="star" style={{
            left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, width: size, height: size,
            ["--o" as string]: 0.25 + Math.random() * 0.6, ["--d" as string]: `${3 + Math.random() * 5}s`,
            ["--delay" as string]: `${-Math.random() * 6}s`,
          }} />
        );
      }),
    [],
  );
  const motes = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const size = 4 + Math.random() * 9;
        return (
          <span key={i} className="mote" style={{
            left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, width: size, height: size,
            ["--d" as string]: `${7 + Math.random() * 6}s`, ["--delay" as string]: `${-Math.random() * 8}s`,
          }} />
        );
      }),
    [],
  );
  return (
    <div className="sky" aria-hidden="true">
      <div className="sky-glow" />
      <div className="stars">{stars}</div>
      <div className="motes">{motes}</div>
    </div>
  );
});
