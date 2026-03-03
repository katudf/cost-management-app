import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://quaollobtalcixmlpmps.supabase.co"
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YW9sbG9idGFsY2l4bWxwbXBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDM0NjUsImV4cCI6MjA2NzYxOTQ2NX0.LR1GPcwvgj1J1MrYzWMK93YS5fV2RYNl5S8tGfCYbkg"

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkSchema() {
    const { data: pData, error: pError } = await supabase.from('Projects').select('*').limit(1)
    console.log('Projects Error:', pError)
    console.log('Projects Data Keys:', pData && pData.length > 0 ? Object.keys(pData[0]) : pData)

    const { data: ptData, error: ptError } = await supabase.from('ProjectTasks').select('*').limit(1)
    console.log('ProjectTasks Error:', ptError)
    console.log('ProjectTasks Data Keys:', ptData && ptData.length > 0 ? Object.keys(ptData[0]) : ptData)

    const { data: trData, error: trError } = await supabase.from('TaskRecords').select('*').limit(1)
    console.log('TaskRecords Error:', trError)
    console.log('TaskRecords Data Keys:', trData && trData.length > 0 ? Object.keys(trData[0]) : trData)
}

checkSchema()
