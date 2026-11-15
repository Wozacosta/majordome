import type { SVGProps } from "react";

// The 16px-grid cloche from assets/brand/cloche-small.svg; the dome takes the text color.
export function MajordomeCloche(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 11a5 5 0 0 1 10 0Z" fill="currentColor" />
      <rect x="2" y="12" width="12" height="2" rx="1" fill="currentColor" />
      {/* oxlint-disable-next-line shadcn/no-raw-colors -- the knob is the brand's fixed live green in every theme */}
      <circle cx="8" cy="3" r="2" fill="#3ddc84" />
    </svg>
  );
}
