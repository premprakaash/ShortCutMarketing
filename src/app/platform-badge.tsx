import { platformInfo } from "@/lib/platforms";

export function PlatformLogo({ id, size = 32 }: { id: string; size?: number }) {
  const p = platformInfo(id);
  return (
    <span className="pf-logo" style={{ background: p.color, width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {p.short[0]}
    </span>
  );
}

export function PlatformBadge({ id }: { id: string }) {
  const p = platformInfo(id);
  return (
    <span className="badge">
      <span className="dot" style={{ background: p.color }} />
      {p.short}
    </span>
  );
}
