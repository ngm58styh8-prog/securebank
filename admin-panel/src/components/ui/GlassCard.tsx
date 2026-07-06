import clsx from "clsx";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function GlassCard({
  children,
  className,
  onClick
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={clsx("gv-glass p-4 md:p-5", className, onClick && "cursor-pointer hover:bg-white/[0.08]")}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gv-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-gv-primary">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-gv-muted">{description}</p>
    </div>
  );
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="gv-glass p-4">
          <div className="gv-skeleton mb-3 h-3 w-16" />
          <div className="gv-skeleton h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export function StatusChip({
  status
}: {
  status: string;
}) {
  const lower = status.toLowerCase();
  const color =
    lower.includes("active") || lower.includes("approved") || lower.includes("verified")
      ? "bg-gv-success/20 text-gv-success"
      : lower.includes("frozen") || lower.includes("pending") || lower.includes("review")
        ? "bg-gv-warning/20 text-gv-warning"
        : lower.includes("suspend") || lower.includes("reject")
          ? "bg-gv-danger/20 text-gv-danger"
          : "bg-white/10 text-gv-muted";

  return <span className={clsx("gv-chip", color)}>{status}</span>;
}

export function Avatar({
  name,
  email,
  size = "md"
}: {
  name: string;
  email: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "h-9 w-9 text-xs", md: "h-12 w-12 text-sm", lg: "h-16 w-16 text-lg" };
  const initials = name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  let hue = 0;
  for (let i = 0; i < email.length; i++) hue += email.charCodeAt(i);

  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-white/10",
        sizes[size]
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${220 + (hue % 80)}, 70%, 45%), hsl(${250 + (hue % 60)}, 80%, 55%))`
      }}
    >
      {initials}
    </div>
  );
}
