import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as sharing from '../components/CompanyTripSharingToggle';

describe('company sharing toggle accessibility',()=>{
  it.each([true,false])('renders the saved %s state with a company-specific accessible label and manager exception',enabled=>{
    expect(typeof (sharing as any).CompanyTripSharingToggle).toBe('function');
    const html=renderToStaticMarkup(React.createElement((sharing as any).CompanyTripSharingToggle,{companyName:'Synthetic Company',enabled,onChange:async()=>{}}));
    expect(html).toContain('role="switch"');
    expect(html).toContain(`aria-checked="${enabled}"`);
    expect(html).toContain('Synthetic Company');
    expect(html).toContain('المدير والمالك');
    expect(html.includes('checked=""')).toBe(enabled);
  });
});
