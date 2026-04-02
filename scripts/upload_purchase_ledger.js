import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const xlsx = require('xlsx');

// Load .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Environment variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function convertExcelDate(serial) {
    if (typeof serial === 'number' && serial > 40000) {
        // Excel base date is 1900-01-01 (or 1899-12-30 due to 1900 leap year bug)
        const date = new Date((serial - 25569) * 86400 * 1000);
        return date.toISOString().split('T')[0];
    }
    return null;
}

async function run() {
    try {
        const filePath = path.join(__dirname, '../docs/test_data/仕入帳.xlsx');
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
        }

        console.log(`Reading Excel file: ${filePath}`);
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        
        if (data.length <= 1) {
            console.log("No data rows found.");
            return;
        }

        const headers = data[0].map(h => (h ? String(h).trim() : ''));
        const colMap = {
            date: headers.findIndex(h => h.includes('月/日')),
            project_name: headers.findIndex(h => h.includes('工事名')),
            supplier: headers.findIndex(h => h.includes('購入先')),
            item_name: headers.findIndex(h => h.includes('名称')),
            note: headers.findIndex(h => h.includes('備考')),
            quantity: headers.findIndex(h => h.includes('数量')),
            unit: headers.findIndex(h => h.includes('単位')),
            unit_price: headers.findIndex(h => h.includes('単価')),
            amount: headers.findIndex(h => h.includes('金額'))
        };

        const recordsToInsert = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0 || row.every(c => c === null || c === undefined || c === '')) {
                continue;
            }

            // Extract values using colMap
            const rawDate = colMap.date >= 0 ? row[colMap.date] : null;
            const projectName = colMap.project_name >= 0 ? row[colMap.project_name] : null;
            const supplier = colMap.supplier >= 0 ? row[colMap.supplier] : null;
            const itemName = colMap.item_name >= 0 ? row[colMap.item_name] : null;
            const note = colMap.note >= 0 ? row[colMap.note] : null;
            const quantity = colMap.quantity >= 0 ? row[colMap.quantity] : null;
            const unit = colMap.unit >= 0 ? row[colMap.unit] : null;
            const unitPrice = colMap.unit_price >= 0 ? row[colMap.unit_price] : null;
            const amount = colMap.amount >= 0 ? row[colMap.amount] : null;

            // Basic parsing
            const parsedDate = convertExcelDate(rawDate);
            const parsedQty = typeof quantity === 'number' ? quantity : (parseFloat(quantity) || null);
            const parsedUnitPrice = typeof unitPrice === 'number' ? unitPrice : (parseFloat(unitPrice) || null);
            // Ignore NaN
            const qty = isNaN(parsedQty) ? null : parsedQty;
            const up = isNaN(parsedUnitPrice) ? null : parsedUnitPrice;
            
            // Note: sometimes amount is missing or calculated
            const parsedAmount = typeof amount === 'number' ? amount : (parseFloat(amount) || null);
            const amt = isNaN(parsedAmount) ? null : parsedAmount;

            recordsToInsert.push({
                date: parsedDate,
                project_name: projectName ? String(projectName).trim() : null,
                supplier: supplier ? String(supplier).trim() : null,
                item_name: itemName ? String(itemName).trim() : null,
                note: note ? String(note).trim() : null,
                quantity: qty,
                unit: unit ? String(unit).trim() : null,
                unit_price: up,
                amount: amt
            });
        }

        console.log(`Prepared ${recordsToInsert.length} records. Uploading to Supabase...`);

        // Batch insert in chunks of 500
        const chunkSize = 500;
        let successCount = 0;

        for (let i = 0; i < recordsToInsert.length; i += chunkSize) {
            const chunk = recordsToInsert.slice(i, i + chunkSize);
            const { error } = await supabase.from('PurchaseRecords').insert(chunk);
            if (error) {
                console.error(`Error inserting chunk ${i} to ${i + chunkSize}:`, error);
            } else {
                successCount += chunk.length;
                console.log(`Successfully inserted ${successCount} / ${recordsToInsert.length} records.`);
            }
        }

        console.log("Upload complete.");

    } catch (err) {
        console.error("An error occurred:", err);
    }
}

run();
