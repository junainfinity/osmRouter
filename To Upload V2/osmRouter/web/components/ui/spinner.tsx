export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block rounded-full border-[1.5px] border-[var(--border-strong)] border-t-[var(--accent)] animate-[spin_700ms_linear_infinite]"
      style={{ width: size, height: size }}
    />
  );
}
