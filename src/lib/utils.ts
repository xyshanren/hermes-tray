// v0.2 cn() helper — standard shadcn pattern for class merging.
// Combines clsx (conditional class names) + tailwind-merge (deduplicates Tailwind utilities).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}