const XLSX = require('xlsx');
const path = require('path');

function analyzeFile(fileName) {
  const filePath = path.join(__dirname, fileName);
  console.log(`\n==================================================`);
  console.log(`PHÂN TÍCH FILE: ${fileName}`);
  console.log(`==================================================`);
  
  const workbook = XLSX.readFile(filePath);
  console.log(`Danh sách các Sheet:`, workbook.SheetNames);
  
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // Chuyển đổi worksheet sang dạng JSON array of arrays (để phân tích cấu trúc thô trước)
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  console.log(`Tổng số dòng đọc được: ${rawData.length}`);
  
  // In ra 20 dòng đầu tiên để phân tích header và data
  console.log(`\n--- 20 DÒNG ĐẦU TIÊN CỦA SHEET "${firstSheetName}" ---`);
  rawData.slice(0, 20).forEach((row, index) => {
    console.log(`Dòng ${index + 1}:`, JSON.stringify(row));
  });
}

analyzeFile('vias.xlsx');
analyzeFile('skypec.xls');
