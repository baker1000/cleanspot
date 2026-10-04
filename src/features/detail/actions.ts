// Which actions the detail page offers. Mirrors the server rules (confirm_report, claim_report,
// submit_cleanup, can_work_on_report) so people are not offered buttons that can only fail; the
// server still decides.
import type { ReportDetail } from './api';

export type ConfirmAction = 'hidden' | 'own' | 'needs_account' | 'done' | 'available';
export type ClaimAction =
  'hidden' | 'needs_account' | 'hazardous' | 'join' | 'available' | 'mine' | 'taken';

export interface Actions {
  confirm: ConfirmAction;
  claim: ClaimAction;
  /** The claimer (or staff) can upload the after-photo now. */
  cleanup: boolean;
}

export function availableActions(report: ReportDetail, registered: boolean): Actions {
  const open = report.status === 'reported' || report.status === 'confirmed';
  const viewer = registered ? report.viewer : null;
  const staff = viewer?.role === 'staff';

  let confirm: ConfirmAction = 'hidden';
  if (open) {
    if (report.reportedByMe) confirm = 'own';
    else if (!registered) confirm = 'needs_account';
    else if (viewer?.confirmed) confirm = 'done';
    else confirm = 'available';
  }

  let claim: ClaimAction = 'hidden';
  if (report.status === 'in_progress') {
    claim = report.claimedByMe ? 'mine' : 'taken';
  } else if (open) {
    if (report.isHazardous && !staff) claim = 'hazardous';
    else if (!registered) claim = 'needs_account';
    else if (viewer?.role === 'none') claim = viewer.publicTenantId ? 'join' : 'hidden';
    else claim = 'available';
  }

  return { confirm, claim, cleanup: claim === 'mine' };
}

/** Route in the browser (OpenStreetMap) or in a map app via a geo: link. */
export function navigationLinks({ lat, lng }: { lat: number; lng: number }) {
  const at = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return {
    web: `https://www.openstreetmap.org/directions?route=%3B${encodeURIComponent(at)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`,
    app: `geo:${at}?q=${at}`,
  };
}
