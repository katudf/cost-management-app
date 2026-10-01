import { supabase } from './lib/supabase';

export const deliverEstimatePdf = async (blob, fileName) => {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw userError || new Error('PDF配信にはログインが必要です。');
  const bucket = supabase.storage.from('estimate-pdf-previews');
  // Clean up abandoned previews belonging to this user after one day.
  const { data: folders } = await bucket.list(user.id, { limit: 100 });
  for (const folder of folders || []) {
    if (folder.id) continue;
    const prefix = `${user.id}/${folder.name}`;
    const { data: files } = await bucket.list(prefix, { limit: 100 });
    const expired = (files || []).filter(file => Date.now() - Date.parse(file.created_at) > 86400000);
    if (expired.length) await bucket.remove(expired.map(file => `${prefix}/${file.name}`));
  }
  const path = `${user.id}/${crypto.randomUUID()}/estimate.pdf`;
  const { error } = await bucket.upload(path, blob, { contentType: 'application/pdf', upsert: false });
  if (error) throw error;
  const { data, error: signError } = await bucket.createSignedUrl(path, 3600);
  if (signError) { await bucket.remove([path]); throw signError; }
  const signed = new URL(data.signedUrl);
  const url = new URL(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/estimate-pdf/' + encodeURIComponent(fileName));
  url.searchParams.set('path', path);
  url.searchParams.set('token', signed.searchParams.get('token'));
  return { url: url.href, release: () => bucket.remove([path]) };
};
