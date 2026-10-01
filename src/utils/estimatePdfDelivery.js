import { deliverEstimatePdf } from '../supabaseEstimatePdf';

export const estimatePdfFileName = (estimate) => {
  const title = String(estimate.title || '見積書').trim() || '見積書';
  const customer = String(estimate.customer?.name || '顧客名未設定').trim() || '顧客名未設定';
  return `${title}（${customer}）`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.pdf';
};

export const publishEstimatePdf = deliverEstimatePdf;
