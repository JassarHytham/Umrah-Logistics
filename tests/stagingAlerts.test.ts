import { describe, expect, it } from 'vitest';
import { outboundAlertsAllowed } from '../server/deployment';

describe('staging alert safety in compatibility mode',()=>{
  it('suppresses outbound staging alerts even when workspace migration is disabled',()=>{
    expect(outboundAlertsAllowed({NODE_ENV:'production',UMRAH_DEPLOYMENT_ENV:'staging',STAGING_WORKSPACES_ENABLED:'false'})).toBe(false);
  });
  it('allows only explicit staging opt-in, synthetic tests, or non-staging behavior',()=>{
    expect(outboundAlertsAllowed({NODE_ENV:'production',UMRAH_DEPLOYMENT_ENV:'staging',STAGING_OUTBOUND_ALERTS:'true'})).toBe(true);
    expect(outboundAlertsAllowed({NODE_ENV:'test',UMRAH_DEPLOYMENT_ENV:'staging'})).toBe(true);
    expect(outboundAlertsAllowed({NODE_ENV:'production'})).toBe(true);
  });
});
