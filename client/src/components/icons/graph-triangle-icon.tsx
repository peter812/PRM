import { SVGProps } from "react";

export function GraphTriangleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <line x1="12" y1="6" x2="5.5" y2="18" />
      <line x1="12" y1="6" x2="18.5" y2="18" />
      <line x1="5.5" y1="18" x2="18.5" y2="18" />
      <circle cx="12" cy="6" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="18" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="18" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
