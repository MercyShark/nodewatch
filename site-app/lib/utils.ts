/** Join class names, skipping falsy ones (the shadcn `cn` without tailwind-merge; classes here never conflict). */
export function cn(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}
