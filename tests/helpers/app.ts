import { buildApp } from "../../src/app";

/**
 * Build the real app for integration tests (no listener). Once A1-4 lands, an
 * authenticated-request helper (injecting a session/`c.var.user`) plugs in here.
 */
export const makeTestApp = () => buildApp();
