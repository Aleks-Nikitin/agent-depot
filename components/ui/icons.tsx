import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

export const LockIcon = (p: IconProps) => <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
export const ClockIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
export const CheckIcon = (p: IconProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const XIcon = (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const PlayIcon = (p: IconProps) => <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" /></Svg>;
export const SearchIcon = (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Svg>;
export const PlusIcon = (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const EditIcon = (p: IconProps) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></Svg>;
export const TrashIcon = (p: IconProps) => <Svg {...p}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" /></Svg>;
export const AlertIcon = (p: IconProps) => <Svg {...p}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></Svg>;
export const BanIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></Svg>;
export const SparkIcon = (p: IconProps) => <Svg {...p}><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></Svg>;
export const ToolIcon = (p: IconProps) => <Svg {...p}><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 1-2-2z" /></Svg>;
export const ChevronDownIcon = (p: IconProps) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const ChevronRightIcon = (p: IconProps) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const RefreshIcon = (p: IconProps) => <Svg {...p}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" /></Svg>;
export const SunIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" /></Svg>;
export const MoonIcon = (p: IconProps) => <Svg {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></Svg>;
