import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  "https://quaollobtalcixmlpmps.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YW9sbG9idGFsY2l4bWxwbXBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDM0NjUsImV4cCI6MjA2NzYxOTQ2NX0.LR1GPcwvgj1J1MrYzWMK93YS5fV2RYNl5S8tGfCYbkg"
);

async function check() {
  const { data, error } = await supabase.from('WorkerCertifications').select('*').limit(3);
  console.log(JSON.stringify({ data, error }, null, 2));
}

check();
