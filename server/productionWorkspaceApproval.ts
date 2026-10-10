import type { WorkspaceApproval } from './migrations';

// Reviewed against the protected 2026-10-10 production snapshot. Startup
// refuses the first migration if accounts, company assignments, or legacy
// sharing counts change before deployment.
export const productionWorkspaceApproval: WorkspaceApproval = {
  accounts: [
    {id:1,role:'user',isActive:1,companyId:2},
    {id:2,role:'user',isActive:1,companyId:2},
    {id:3,role:'user',isActive:1,companyId:null},
    {id:4,role:'user',isActive:1,companyId:null},
    {id:5,role:'user',isActive:1,companyId:null},
    {id:6,role:'user',isActive:1,companyId:null},
    {id:7,role:'user',isActive:1,companyId:null},
    {id:8,role:'user',isActive:1,companyId:null},
    {id:9,role:'admin',isActive:1,companyId:null},
    {id:10,role:'user',isActive:1,companyId:3},
    {id:11,role:'user',isActive:1,companyId:4},
  ],
  companyIds:[2,3,4],
  legacyShares:{
    trip_row_access:1,
    trip_group_access:2,
    trip_agency_access:12,
    trip_share_invitations:13,
  },
  legacyShareDigest:'d354164bd2eb72bf672fd4d8e5c824e720c682fb618b4d8db9fffb3d366e0751',
};

export const productionOwnerByCompanyId = {2:2,3:10,4:11};
export const productionInitialCompanySharing = {2:false};
