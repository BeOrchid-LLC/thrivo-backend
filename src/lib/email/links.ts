import { env } from "../../env";

const APP_PATHS = {
  dashboard: "/dashboard",
  log: "/log",
  metrics: "/metrics",
  subscription: "/settings/subscription",
} as const;

export type EmailAppDestination = keyof typeof APP_PATHS;

export function emailAppLink(destination: EmailAppDestination): string {
  return new URL(APP_PATHS[destination], env.PUBLIC_APP_URL).toString();
}

export function emailPublicLink(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid public email path");
  return new URL(path, env.PUBLIC_APP_URL).toString();
}
