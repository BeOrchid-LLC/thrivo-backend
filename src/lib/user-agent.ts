import { UAParser } from "ua-parser-js";

export type ParsedUserAgent = {
  deviceType: string | null;
  osName: string | null;
  osVersion: string | null;
  browserName: string | null;
  browserVersion: string | null;
};

/**
 * Marketing-grade device/OS/browser parsing -- heuristic, not authoritative
 * (see the raw user-agent string kept alongside this on the capture row for
 * re-derivation if a parse was wrong or the library's rules change).
 * ua-parser-js only sets device.type for "mobile"/"tablet"; everything else
 * (including no User-Agent header at all) is treated as "desktop".
 */
export function parseUserAgent(ua: string | undefined): ParsedUserAgent {
  if (!ua) {
    return {
      deviceType: null,
      osName: null,
      osVersion: null,
      browserName: null,
      browserVersion: null,
    };
  }

  const { device, os, browser } = new UAParser(ua).getResult();

  return {
    deviceType: device.type ?? "desktop",
    osName: os.name ?? null,
    osVersion: os.version ?? null,
    browserName: browser.name ?? null,
    browserVersion: browser.version ?? null,
  };
}
