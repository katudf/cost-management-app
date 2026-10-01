Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  const token = url.searchParams.get('token') || '';
  if (!/^[0-9a-f-]+\/[0-9a-f-]+\/estimate\.pdf$/.test(path) || !token || request.method !== 'GET') return new Response('Invalid PDF request', {status:400});
  const upstream = new URL(`${Deno.env.get('SUPABASE_URL')}/storage/v1/object/sign/estimate-pdf-previews/${path}`);
  upstream.searchParams.set('token', token);
  const pdf = await fetch(upstream);
  if (!pdf.ok) return new Response('PDFの有効期限が切れました。プレビューを開き直してください。', {status:pdf.status});
  if (!pdf.headers.get('content-type')?.includes('application/pdf')) return new Response('Invalid PDF response', {status:502});
  const fileName = decodeURIComponent(url.pathname.split('/').pop() || 'estimate.pdf').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(pdf.body, {headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="estimate.pdf"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'private, no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Disposition',
  }});
});
