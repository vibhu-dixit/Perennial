// Botanical line icons — single stroke, currentColor.

type P = { size?: number; className?: string; title?: string };

const svg = (size: number, className: string | undefined, title: string | undefined, children: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title && <title>{title}</title>}
    {children}
  </svg>
);

export const Sun = ({ size = 14, className, title }: P) =>
  svg(size, className, title, <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>);

export const Drop = ({ size = 14, className, title }: P) =>
  svg(size, className, title, <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />);

export const Sprout = ({ size = 16, className, title }: P) =>
  svg(size, className, title, <>
    <path d="M12 21v-9" />
    <path d="M12 12c-4.5 0-7-3-7-7 4 0 7 2.5 7 7Z" />
    <path d="M12 10c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5Z" />
  </>);

export const Frost = ({ size = 18, className, title }: P) =>
  svg(size, className, title, <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2" />);

export const Bug = ({ size = 18, className, title }: P) =>
  svg(size, className, title, <>
    <ellipse cx="12" cy="14" rx="5" ry="6" />
    <path d="M12 8v12M9 5l1.5 2M15 5l-1.5 2M7 11H3M21 11h-4M7 16H3M21 16h-4" />
  </>);

export const Cloud = ({ size = 18, className, title }: P) =>
  svg(size, className, title, <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z" />);

export const Soil = ({ size = 18, className, title }: P) =>
  svg(size, className, title, <path d="M3 15h18M5 19h14M8 11c1-2 3-2 4 0s3 2 4 0" />);

export const Plus = ({ size = 16, className }: P) => svg(size, className, undefined, <path d="M12 5v14M5 12h14" />);

export const Logo = ({ size = 34 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
    <circle cx="20" cy="20" r="19" fill="#e3e8d8" />
    <path d="M20 33V18" stroke="#3b2a1e" strokeWidth="2" strokeLinecap="round" />
    <path d="M20 21c-7 0-10.5-4.5-10.5-10.5 6 0 10.5 3.5 10.5 10.5Z" fill="#7f9272" />
    <path d="M20 17.5c0-6 3.5-9.5 10.5-9.5 0 6-3.5 9.5-10.5 9.5Z" fill="#c1623f" />
    <path d="M13 33h14" stroke="#9a6b45" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const threatIcon = (kind: string) =>
  ({ frost: <Frost />, pest: <Bug />, disease: <Bug />, weather: <Cloud />, soil: <Soil /> })[kind] ?? <Cloud />;
