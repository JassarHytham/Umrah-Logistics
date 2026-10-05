type ShareReview = {
  reviewRef: string;
  scope: string;
  recipientUserId: number | null;
  grantorUserId: number | null;
  sourceWorkspaceId: null;
  candidateSourceWorkspaceIds: number[];
  reviewRequired: true;
  issues: string[];
};

export function inspectWorkspaceReadiness(options: { dbPath: string }): {
  reportVersion: number;
  generatedAt: string;
  readyForMigration: false;
  totals: { accounts: number; customerAccounts: number; companies: number; trips: number; activeTrips: number; deletedTrips: number };
  accounts: { userId: number; active: boolean; existingCompanyId: number | null; candidateWorkspaceId: number | null; activeTripCount: number; deletedTripCount: number; reviewRequired: true; issues: string[] }[];
  platformAdminUserIds: number[];
  workspaces: { workspaceId: number; candidateMemberUserIds: number[]; ownerUserId: null; reviewRequired: true }[];
  orphanTripCount: number;
  platformAdminTripCount: number;
  invalidTripJsonCount: number;
  shares: ShareReview[];
  invitations: (ShareReview & { invitationId: number; status: string })[];
  settings: { userId: number | null; hasTelegramConfig: boolean; hasTemplates: boolean; hasAlertSettings: boolean; legacyDeletedRowCount: number | null; issues: string[] }[];
  integrationReviews: { workspaceId: number; configuredUserIds: number[]; reviewRequired: true }[];
};
