export const getApproverStampName = (estimate, approver = estimate.approver) => {
  if (!estimate.approved_by || !estimate.approved_at) return '';
  const approvedBy = String(estimate.approved_by).trim();
  // Some approval records store the name itself; preserve that approval snapshot.
  if (!/^\d+$/.test(approvedBy)) return approvedBy.split(/[\s　]+/)[0];
  if (!approver || String(approver.id) !== approvedBy) return '';
  return String(approver.name || '').trim().split(/[\s　]+/)[0];
};
