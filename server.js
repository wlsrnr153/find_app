const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 데이터 파일 경로
const DATA_FILE = './data/items.json';
const UPLOAD_DIR = './uploads';

// 디렉토리 생성
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// 파일 업로드 설정
const upload = multer({ dest: UPLOAD_DIR });

// 데이터 읽기
function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('데이터 읽기 오류:', error);
  }
  return [];
}

// 데이터 저장
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('데이터 저장 오류:', error);
    return false;
  }
}

// API 엔드포인트

// 모든 물품 조회
app.get('/api/items', (req, res) => {
  const items = readData();
  res.json(items);
});

// 물품 추가
app.post('/api/items', (req, res) => {
  const items = readData();
  const newItem = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    ...req.body
  };
  items.push(newItem);
  
  if (saveData(items)) {
    res.json({ success: true, item: newItem });
  } else {
    res.status(500).json({ success: false, message: '저장 실패' });
  }
});

// 물품 수정
app.put('/api/items/:id', (req, res) => {
  const items = readData();
  const index = items.findIndex(item => item.id === req.params.id);
  
  if (index !== -1) {
    items[index] = { ...items[index], ...req.body, id: req.params.id };
    if (saveData(items)) {
      res.json({ success: true, item: items[index] });
    } else {
      res.status(500).json({ success: false, message: '저장 실패' });
    }
  } else {
    res.status(404).json({ success: false, message: '물품을 찾을 수 없습니다' });
  }
});

// 물품 삭제
app.delete('/api/items/:id', (req, res) => {
  const items = readData();
  const filteredItems = items.filter(item => item.id !== req.params.id);
  
  if (saveData(filteredItems)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, message: '삭제 실패' });
  }
});

// 엑셀 다운로드
app.get('/api/export/excel', (req, res) => {
  const items = readData();
  
  if (items.length === 0) {
    return res.status(404).json({ success: false, message: '데이터가 없습니다' });
  }
  
  // 엑셀 데이터 준비
  const worksheetData = items.map(item => ({
    '조사자': item.surveyor || '',
    '물품명': item.itemName || '',
    '카테고리': item.category || '',
    '제조사': item.manufacturer || '',
    '모델명': item.model || '',
    '가로(cm)': item.width || '',
    '세로(cm)': item.height || '',
    '깊이(cm)': item.depth || '',
    '색상': item.color || '',
    '재질': item.material || '',
    '상태': item.condition || '',
    '비고': item.notes || '',
    '조사일시': item.timestamp ? new Date(item.timestamp).toLocaleString('ko-KR') : ''
  }));
  
  const worksheet = xlsx.utils.json_to_sheet(worksheetData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, '물품조사');
  
  // 컬럼 너비 설정
  worksheet['!cols'] = [
    { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
    { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 18 }
  ];
  
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  
  res.setHeader('Content-Disposition', `attachment; filename=물품조사_${new Date().toISOString().split('T')[0]}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// JSON 다운로드
app.get('/api/export/json', (req, res) => {
  const items = readData();
  res.setHeader('Content-Disposition', `attachment; filename=물품조사_${new Date().toISOString().split('T')[0]}.json`);
  res.setHeader('Content-Type', 'application/json');
  res.json(items);
});

// 엑셀/JSON 업로드
app.post('/api/import', upload.single('file'), (req, res) => {
  try {
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let importedItems = [];
    
    if (fileExt === '.json') {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      importedItems = JSON.parse(fileContent);
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);
      
      // 엑셀 데이터를 JSON 형식으로 변환
      importedItems = data.map(row => ({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        surveyor: row['조사자'] || '',
        itemName: row['물품명'] || '',
        category: row['카테고리'] || '',
        manufacturer: row['제조사'] || '',
        model: row['모델명'] || '',
        width: row['가로(cm)'] || '',
        height: row['세로(cm)'] || '',
        depth: row['깊이(cm)'] || '',
        color: row['색상'] || '',
        material: row['재질'] || '',
        condition: row['상태'] || '',
        notes: row['비고'] || ''
      }));
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: '지원하지 않는 파일 형식입니다' });
    }
    
    // 기존 데이터와 병합
    const existingItems = readData();
    const mergedItems = [...existingItems, ...importedItems];
    
    if (saveData(mergedItems)) {
      fs.unlinkSync(filePath);
      res.json({ 
        success: true, 
        message: `${importedItems.length}개 항목을 가져왔습니다`,
        count: importedItems.length 
      });
    } else {
      fs.unlinkSync(filePath);
      res.status(500).json({ success: false, message: '데이터 저장 실패' });
    }
  } catch (error) {
    console.error('업로드 오류:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: '파일 처리 중 오류가 발생했습니다' });
  }
});

// 모든 데이터 초기화
app.delete('/api/items', (req, res) => {
  if (saveData([])) {
    res.json({ success: true, message: '모든 데이터가 삭제되었습니다' });
  } else {
    res.status(500).json({ success: false, message: '삭제 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다`);
});

