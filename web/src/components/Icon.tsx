import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CookingPot,
  Flashlight,
  FlashlightOff,
  HeartPulse,
  type LucideIcon,
  Minus,
  Plus,
  Search,
  Settings,
  Share2,
  Star,
  X,
} from "lucide-react";

const STROKE = 1.7;
const SIZE = 21;

const lucide = {
  back: ArrowLeft,
  check: Check,
  prev: ChevronLeft,
  down: ChevronDown,
  next: ChevronRight,
  copy: Copy,
  recipes: CookingPot,
  health: HeartPulse,
  torch: Flashlight,
  torchOff: FlashlightOff,
  minus: Minus,
  plus: Plus,
  search: Search,
  camera: Camera,
  settings: Settings,
  share: Share2,
  star: Star,
  close: X,
} satisfies Record<string, LucideIcon>;

/** Glyphs drawn for the mockups: the barcode, the scan frame, the plate, the bars of history and the food marks. */
const own = {
  barcode: "M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10",
  today: "M4 12c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7-8-3-8-7zM7 10c1 2 3 3 5 3s4-1 5-3",
  history: "M5 19V11M12 19V5M19 19v-5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4",
  bottle: "M7 4h10l1 16H6L7 4zM9 4V2h6v2",
  bag: "M4 8h16v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8zM8 8V6a4 4 0 0 1 8 0v2",
  bars: "M5 4h2v16M11 4v6a2 2 0 0 0 4 0V4M18 4v16",
  lines: "M4 7h16M4 12h16M4 17h10",
  label: "M7 4h10l1 16H6L7 4z",
} as const;

export type IconName = keyof typeof lucide | keyof typeof own;

export function Icon({
  name,
  size = SIZE,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  if (name in lucide) {
    const L = lucide[name as keyof typeof lucide];
    return <L size={size} strokeWidth={STROKE} aria-hidden="true" className={className} />;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={own[name as keyof typeof own]} />
    </svg>
  );
}
