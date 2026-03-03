import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const xlsx = require('xlsx');

const workbook = xlsx.readFile('./docs/●見積書（横-鏡あり） (25).xlsx');
const sheet = workbook.Sheets['見積書（横-鏡あり）'];
const json = xlsx.utils.sheet_to_json(sheet, { header: 1 });

fs.writeFileSync('output.json', JSON.stringify(json.slice(0, 30), null, 2));
