import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "-2px" }}
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => <Icon {...p}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></Icon>;
export const IconGlobe = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.5 3.7 5.5 3.7 8.5s-1.2 6-3.7 8.5"/><path d="M12 3.5c-2.5 2.5-3.7 5.5-3.7 8.5s1.2 6 3.7 8.5"/></Icon>;
export const IconDevice = (p: IconProps) => <Icon {...p}><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8"/><path d="M12 16v4"/></Icon>;
export const IconCard = (p: IconProps) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></Icon>;
export const IconCog = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></Icon>;
export const IconShield = (p: IconProps) => <Icon {...p}><path d="M12 3 4 6v6c0 4.5 3.5 8.5 8 9 4.5-.5 8-4.5 8-9V6l-8-3z"/></Icon>;
export const IconUsers = (p: IconProps) => <Icon {...p}><path d="M16 19v-2a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v2"/><circle cx="9.5" cy="8" r="3"/><path d="M21 19v-2a3 3 0 0 0-2.3-2.9"/><path d="M16 5.1A3 3 0 0 1 16 11"/></Icon>;
export const IconServer = (p: IconProps) => <Icon {...p}><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="7" cy="7.5" r="0.7" fill="currentColor"/><circle cx="7" cy="16.5" r="0.7" fill="currentColor"/></Icon>;
export const IconChart = (p: IconProps) => <Icon {...p}><path d="M3 20h18"/><path d="M6 20V10"/><path d="M11 20V4"/><path d="M16 20v-7"/></Icon>;
export const IconList = (p: IconProps) => <Icon {...p}><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="3.5" cy="6" r="0.8" fill="currentColor"/><circle cx="3.5" cy="12" r="0.8" fill="currentColor"/><circle cx="3.5" cy="18" r="0.8" fill="currentColor"/></Icon>;
export const IconSearch = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.5-3.5"/></Icon>;
export const IconBell = (p: IconProps) => <Icon {...p}><path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 18a2 2 0 0 0 4 0"/></Icon>;
export const IconPlus = (p: IconProps) => <Icon {...p}><path d="M12 5v14"/><path d="M5 12h14"/></Icon>;
export const IconCheck = (p: IconProps) => <Icon {...p}><path d="M4 12.5 9.5 18 20 7"/></Icon>;
export const IconX = (p: IconProps) => <Icon {...p}><path d="M6 6 18 18"/><path d="M18 6 6 18"/></Icon>;
export const IconCopy = (p: IconProps) => <Icon {...p}><rect x="8" y="8" width="13" height="13" rx="1.5"/><path d="M16 8V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3"/></Icon>;
export const IconExternal = (p: IconProps) => <Icon {...p}><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></Icon>;
export const IconChevR = (p: IconProps) => <Icon {...p}><path d="m9 6 6 6-6 6"/></Icon>;
export const IconChevD = (p: IconProps) => <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>;
export const IconArrowUp = (p: IconProps) => <Icon {...p}><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></Icon>;
export const IconArrowDn = (p: IconProps) => <Icon {...p}><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></Icon>;
export const IconArrowR = (p: IconProps) => <Icon {...p}><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></Icon>;
export const IconTrash = (p: IconProps) => <Icon {...p}><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></Icon>;
export const IconRefresh = (p: IconProps) => <Icon {...p}><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></Icon>;
export const IconLock = (p: IconProps) => <Icon {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></Icon>;
export const IconKey = (p: IconProps) => <Icon {...p}><circle cx="8" cy="14" r="4"/><path d="m11 11 9-9"/><path d="m15 7 2 2"/><path d="m18 4 2 2"/></Icon>;
export const IconLogout = (p: IconProps) => <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></Icon>;
export const IconMoon = (p: IconProps) => <Icon {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></Icon>;
export const IconSun = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></Icon>;
export const IconDots = (p: IconProps) => <Icon {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/></Icon>;
export const IconDownload = (p: IconProps) => <Icon {...p}><path d="M12 3v13"/><path d="m6 11 6 6 6-6"/><path d="M5 21h14"/></Icon>;
export const IconBolt = (p: IconProps) => <Icon {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></Icon>;
export const IconCircle = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9"/></Icon>;
export const IconLink = (p: IconProps) => <Icon {...p}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></Icon>;
export const IconBook = (p: IconProps) => <Icon {...p}><path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h10"/></Icon>;
export const IconClock = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></Icon>;
export const IconCheckCircle = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></Icon>;
export const IconAlert = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.6" fill="currentColor"/></Icon>;
export const IconWarn = (p: IconProps) => <Icon {...p}><path d="M12 3 2 20h20z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></Icon>;

export function Wordmark({ size = 16 }: { size?: number }) {
  const dim = size + 10;
  return (
    <div className="flex items-center gap-2.5">
      {/* Brand mark — two PNGs, CSS in globals.css picks the right one based on data-theme */}
      <span className="brand-mark relative inline-block" style={{ width: dim, height: dim }}>
        <img
          src="/osm-mark-on-light.png"
          alt=""
          aria-hidden="true"
          className="brand-mark-on-light absolute inset-0 w-full h-full object-contain"
        />
        <img
          src="/osm-mark-on-dark.png"
          alt=""
          aria-hidden="true"
          className="brand-mark-on-dark absolute inset-0 w-full h-full object-contain"
        />
      </span>
      <span style={{ fontSize: size, fontWeight: 600, letterSpacing: "-0.015em" }} className="text-[var(--text)]">
        osm<span className="text-[var(--text-muted)] font-medium">Router</span>
      </span>
    </div>
  );
}
