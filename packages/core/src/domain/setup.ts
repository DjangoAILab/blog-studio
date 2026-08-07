export type SetupCredentialStatus =
  | { readonly state: 'ready' }
  | {
      readonly state: 'not-ready';
      readonly nextAction: 'initialize-owner-credentials';
    };

export type SetupConfigurationStatus =
  | { readonly state: 'valid' }
  | {
      readonly state: 'invalid';
      readonly nextAction: 'repair-configuration';
    };

export type SetupSiteStatus =
  | { readonly state: 'registered' }
  | {
      readonly state: 'not-registered';
      readonly nextAction: 'discover-site';
    }
  | {
      readonly state: 'unavailable';
      readonly nextAction: 'repair-configuration';
    };

export interface StudioSetupStatus {
  readonly ready: boolean;
  readonly credentials: SetupCredentialStatus;
  readonly configuration: SetupConfigurationStatus;
  readonly site: SetupSiteStatus;
}
