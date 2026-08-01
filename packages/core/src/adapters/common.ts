export const ADAPTER_API_VERSION = 1 as const;

export interface AdapterDescriptor {
  readonly apiVersion: typeof ADAPTER_API_VERSION;
  readonly id: string;
  readonly displayName: string;
}

export interface AdapterDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}
