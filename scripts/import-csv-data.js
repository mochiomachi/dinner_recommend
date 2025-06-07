import fs from 'fs';
import path from 'path';

// CSVファイルを読み込んでSQLに変換
function csvToSql(csvFile, outputFile) {
    const csvData = fs.readFileSync(csvFile, 'utf8');
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');
    
    let sql = '-- Sample meals data for dinner recommend bot\n\n';
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        
        // Extract values with proper handling of empty fields
        const userId = values[0];
        const ateDate = values[1];
        const dish = values[2];
        const tagsValue = values[3] || 'その他';
        const tags = JSON.stringify([tagsValue]); // Convert to JSON array
        const rating = values[4] || '4'; // Default rating
        const mood = values[5] || '満足'; // Default mood
        const decided = values[6] || '1'; // Default decided
        
        sql += `INSERT INTO meals (user_id, ate_date, dish, tags, rating, mood, decided) VALUES ('${userId}', '${ateDate}', '${dish}', '${tags}', ${rating}, '${mood}', ${decided});\n`;
    }
    
    fs.writeFileSync(outputFile, sql);
    console.log(`✅ SQL file created: ${outputFile}`);
    console.log(`📝 Records: ${lines.length - 1}`);
}

// スクリプト実行
const csvFile = path.join(process.cwd(), 'sample-meals-data.csv');
const outputFile = path.join(process.cwd(), 'sample-meals-import.sql');

try {
    csvToSql(csvFile, outputFile);
    
    console.log('\n🚀 Next steps:');
    console.log('1. Review the generated SQL file: sample-meals-import.sql');
    console.log('2. Import to D1 database:');
    console.log('   wrangler d1 execute dinner-recommend-db --file=./sample-meals-import.sql --remote');
} catch (error) {
    console.error('❌ Error:', error.message);
}