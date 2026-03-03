import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function testInsert() {
    console.log('Testing insert to Projects...');
    const { data, error } = await supabase
        .from('Projects')
        .insert([{ name: 'Test Project via Script' }])
        .select();

    if (error) {
        console.error('Insert Failed:', error);
    } else {
        console.log('Insert Success:', data);

        // Clean up
        if (data && data[0]) {
            await supabase.from('Projects').delete().eq('id', data[0].id);
            console.log('Cleaned up test project.');
        }
    }
}

testInsert();
