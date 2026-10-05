export const outboundAlertsAllowed = (env:NodeJS.ProcessEnv) =>
  env.VITEST === 'true' || env.NODE_ENV === 'test'
  || (env.UMRAH_DEPLOYMENT_ENV !== 'staging' && env.NODE_ENV !== 'staging')
  || env.STAGING_OUTBOUND_ALERTS === 'true';
