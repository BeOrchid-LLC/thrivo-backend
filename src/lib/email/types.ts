/**
 * Engine-agnostic email template contract. Templates are plain functions that
 * map typed props to a subject + rendered body — no UI framework in the backend.
 * A2/A5 may swap the rendering engine (e.g. React Email) behind this interface
 * without touching callers or the worker.
 */
export type RenderedBody = { html: string; text?: string };

export type EmailTemplate<P> = {
  subject: (props: P) => string;
  render: (props: P) => RenderedBody;
};
