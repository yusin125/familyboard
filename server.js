const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data.json');
const DATA_EXAMPLE_PATH = path.join(__dirname, 'data.example.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- 데이터 저장소 (JSON 파일 기반, 쓰기 요청은 순차 처리) ----
let writeChain = Promise.resolve();

// data.json은 실제 가족 일정이 담기는 파일이라 저장소에 커밋하지 않는다(.gitignore).
// 처음 실행해 파일이 없으면 예시 데이터(data.example.json)로 만들어준다.
if (!fs.existsSync(DATA_PATH) && fs.existsSync(DATA_EXAMPLE_PATH)) {
  fs.copyFileSync(DATA_EXAMPLE_PATH, DATA_PATH);
}

function readData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveData(data) {
  writeChain = writeChain.then(() =>
    fsp.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8')
  );
  return writeChain;
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

const MEMBER_COLOR_PALETTE = [
  '#E3A542', // 머스타드 옐로
  '#EE8B72', // 코랄
  '#5B9BD5', // 하늘색
  '#6FAE8C', // 세이지 그린
  '#C98BC9', // 라벤더
  '#4FB8AE', // 민트
  '#D97A9C', // 로즈
  '#A6A15C' // 올리브
];

function pickColor(existingMembers) {
  const used = new Set(existingMembers.map((m) => m.color));
  const free = MEMBER_COLOR_PALETTE.find((c) => !used.has(c));
  return free || MEMBER_COLOR_PALETTE[existingMembers.length % MEMBER_COLOR_PALETTE.length];
}

// ---------- 구성원 API ----------
app.get('/api/members', (req, res) => {
  const data = readData();
  res.json(data.members);
});

app.post('/api/members', (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '이름을 입력해주세요.' });
  }
  const data = readData();
  const member = {
    id: newId(),
    name: name.trim(),
    color: color || pickColor(data.members)
  };
  data.members.push(member);
  saveData(data);
  res.status(201).json(member);
});

app.put('/api/members/:id', (req, res) => {
  const data = readData();
  const member = data.members.find((m) => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: '구성원을 찾을 수 없습니다.' });
  const { name, color } = req.body;
  if (name && name.trim()) member.name = name.trim();
  if (color) member.color = color;
  saveData(data);
  res.json(member);
});

app.delete('/api/members/:id', (req, res) => {
  const data = readData();
  const exists = data.members.some((m) => m.id === req.params.id);
  if (!exists) return res.status(404).json({ error: '구성원을 찾을 수 없습니다.' });
  data.members = data.members.filter((m) => m.id !== req.params.id);
  data.schedules = data.schedules.filter((s) => s.memberId !== req.params.id);
  saveData(data);
  res.status(204).end();
});

// ---------- 일정 API ----------
app.get('/api/schedules', (req, res) => {
  const data = readData();
  res.json(data.schedules);
});

function validateSchedule(body) {
  const { memberId, date, start, end, title } = body;
  if (!memberId || !date || !start || !end || !title || !title.trim()) {
    return '구성원, 날짜, 시작/종료 시간, 일정 내용은 필수입니다.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '날짜 형식이 올바르지 않습니다.';
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return '시간 형식이 올바르지 않습니다.';
  }
  if (start >= end) return '종료 시간은 시작 시간보다 늦어야 합니다.';
  return null;
}

app.post('/api/schedules', (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  const data = readData();
  if (!data.members.some((m) => m.id === req.body.memberId)) {
    return res.status(400).json({ error: '존재하지 않는 구성원입니다.' });
  }
  const schedule = {
    id: newId(),
    memberId: req.body.memberId,
    date: req.body.date,
    start: req.body.start,
    end: req.body.end,
    title: req.body.title.trim(),
    memo: req.body.memo ? String(req.body.memo).trim() : ''
  };
  data.schedules.push(schedule);
  saveData(data);
  res.status(201).json(schedule);
});

app.put('/api/schedules/:id', (req, res) => {
  const data = readData();
  const schedule = data.schedules.find((s) => s.id === req.params.id);
  if (!schedule) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  const merged = { ...schedule, ...req.body };
  const err = validateSchedule(merged);
  if (err) return res.status(400).json({ error: err });
  Object.assign(schedule, {
    memberId: merged.memberId,
    date: merged.date,
    start: merged.start,
    end: merged.end,
    title: merged.title.trim(),
    memo: merged.memo ? String(merged.memo).trim() : ''
  });
  saveData(data);
  res.json(schedule);
});

app.delete('/api/schedules/:id', (req, res) => {
  const data = readData();
  const exists = data.schedules.some((s) => s.id === req.params.id);
  if (!exists) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  data.schedules = data.schedules.filter((s) => s.id !== req.params.id);
  saveData(data);
  res.status(204).end();
});

// ---------- 로컬 IP 안내 ----------
function getLocalIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`패밀리보드 서버가 실행되었습니다. (포트: ${PORT})`);
  console.log(`- 이 PC에서 접속:  http://localhost:${PORT}`);
  const ips = getLocalIps();
  if (ips.length > 0) {
    ips.forEach((ip) => {
      console.log(`- 같은 와이파이의 다른 기기(휴대폰/태블릿/TV)에서 접속하려면:`);
      console.log(`    http://${ip}:${PORT}`);
    });
  } else {
    console.log('- 같은 와이파이의 다른 기기에서 접속하려면 이 PC의 로컬 IP를 확인해주세요. (ipconfig)');
  }
  console.log('='.repeat(60));
});
