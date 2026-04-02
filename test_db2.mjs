import fetch from 'node-fetch'; // In Node 18+ global fetch is available, so no need to import actually. Let's just use global fetch.

async function check() {
  const url = "https://quaollobtalcixmlpmps.supabase.co/rest/v1/?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YW9sbG9idGFsY2l4bWxwbXBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDM0NjUsImV4cCI6MjA2NzYxOTQ2NX0.LR1GPcwvgj1J1MrYzWMK93YS5fV2RYNl5S8tGfCYbkg";
  const res = await fetch(url);
  const spec = await res.json();
  const certDef = spec.definitions.WorkerCertifications || spec.definitions.workercertifications;
  if (certDef) {
    console.log("Columns:", Object.keys(certDef.properties));
  } else {
    console.log("Definition not found in OpenAPI spec");
  }
}

check();
