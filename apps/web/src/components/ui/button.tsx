import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "md" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong active:bg-primary-strong border border-primary",
  secondary: "bg-surface-2 text-fg border border-border hover:border-fg/50 hover:bg-surface-3",
  ghost: "bg-transparent text-fg border border-transparent hover:bg-surface-2",
  danger: "bg-transparent text-crit border border-crit/60 hover:bg-crit/10",
  accent: "bg-accent text-on-accent border border-accent hover:brightness-95",
};
const sizes: Record<Size, string> = {
  md: "min-h-11 px-4 text-sm gap-2",
  sm: "min-h-11 lg:min-h-9 px-3 text-sm gap-1.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-lg font-medium whitespace-nowrap",
        "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98]",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150",
        "hover:text-fg disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        variant === "ghost" && "text-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
