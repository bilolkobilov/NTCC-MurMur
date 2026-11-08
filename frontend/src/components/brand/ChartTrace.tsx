import { tracePath } from "../../lib/heart";

/**
 * The product's signature: a trace on millimetre chart paper. One big square = 0.2 s (5 small squares).
 * Here: decorative, synthetic (login page). Real recordings use the same grid in the exam view.
 */
export function ChartTrace({ seconds = 4, className = "" }: { seconds?: number; className?: string }) {
  const width = seconds * 200; // 200 px per second → 40 px per 0.2 s big square, 8 px small square
  const height = 160;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className={`chart-grid block ${className}`}
      aria-hidden="true"
    >
      <path d={tracePath(width, height, seconds)} fill="none" stroke="var(--color-signal)" strokeWidth="1.6" />
    </svg>
  );
}
