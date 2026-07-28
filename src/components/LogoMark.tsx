interface LogoMarkProps {
  className?: string;
  title?: string;
}

/** 小白作家品牌标志：打开的书页与灵感星芒。 */
export function LogoMark({ className = "h-12 w-12", title }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="4" width="56" height="56" rx="17" fill="#4F46E5" />
      <path d="M4 38C16 31 22 48 39 40C50 35 53 25 60 22V43C60 52.4 52.4 60 43 60H21C11.6 60 4 52.4 4 43V38Z" fill="#6D5CE8" />
      <path d="M15 21.5C21.7 19.2 27 20.2 31.4 24.1V45.1C27.1 41.9 21.6 41 15 43.2V21.5Z" fill="white" />
      <path d="M49 21.5C42.3 19.2 37 20.2 32.6 24.1V45.1C36.9 41.9 42.4 41 49 43.2V21.5Z" fill="white" />
      <path d="M32 24V45.5" stroke="#C7D2FE" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M47.5 10L48.9 13.6L52.5 15L48.9 16.4L47.5 20L46.1 16.4L42.5 15L46.1 13.6L47.5 10Z" fill="#FCD34D" />
    </svg>
  );
}
