interface ShinyTextProps {
  children: React.ReactNode;
  className?: string;
  shimmerWidth?: number;
}

export default function ShinyText({ children, className = '', shimmerWidth = 100 }: ShinyTextProps) {
  return (
    <span
      className={`inline-block bg-clip-text text-transparent animate-shiny-text ${className}`}
      style={{
        backgroundImage: `linear-gradient(
          120deg,
          rgba(0, 117, 227, 0.9) 0%,
          rgba(33, 150, 243, 1) 40%,
          rgba(255, 255, 255, 0.95) 50%,
          rgba(33, 150, 243, 1) 60%,
          rgba(0, 117, 227, 0.9) 100%
        )`,
        backgroundSize: `${shimmerWidth}% 100%`,
      }}
    >
      {children}
    </span>
  );
}
