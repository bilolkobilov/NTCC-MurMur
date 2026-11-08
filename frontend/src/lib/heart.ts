/**
 * A synthetic heart-sound trace (S1 + S2 thumps at 72 bpm) for brand art and empty states.
 * Never used to show a patient's recording — real audio is drawn by wavesurfer from the WAV file.
 */
export function heartSample(t: number): number {
  const beat = 60 / 72;
  const tb = t % beat;
  let v = 0;
  for (const [start, freq, amp] of [
    [0, 45, 1],
    [0.32, 65, 0.7],
  ] as const) {
    const d = tb - start;
    if (d >= 0 && d < 0.13) v += amp * Math.sin(2 * Math.PI * freq * d) * Math.exp(-d * 28);
  }
  return v;
}

/** SVG path for `seconds` of trace across a width × height box. */
export function tracePath(width: number, height: number, seconds: number, points = 1200): string {
  const mid = height / 2;
  const amp = height * 0.4;
  let d = "";
  for (let i = 0; i <= points; i++) {
    const x = (i / points) * width;
    const y = mid - heartSample((i / points) * seconds) * amp;
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}
