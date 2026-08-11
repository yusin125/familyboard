require('express-async-errors');
const express = require('express');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { readData, saveData } = require('./lib/db');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
app.get('/api/members', async (req, res) => {
  const data = await readData();
  res.json(data.members);
});

app.post('/api/members', async (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '이름을 입력해주세요.' });
  }
  const data = await readData();
  const member = {
    id: newId(),
    name: name.trim(),
    color: color || pickColor(data.members)
  };
  data.members.push(member);
  await saveData(data);
  res.status(201).json(member);
});

app.put('/api/members/:id', async (req, res) => {
  const data = await readData();
  const member = data.members.find((m) => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: '구성원을 찾을 수 없습니다.' });
  const { name, color } = req.body;
  if (name && name.trim()) member.name = name.trim();
  if (color) member.color = color;
  await saveData(data);
  res.json(member);
});

app.delete('/api/members/:id', async (req, res) => {
  const data = await readData();
  const exists = data.members.some((m) => m.id === req.params.id);
  if (!exists) return res.status(404).json({ error: '구성원을 찾을 수 없습니다.' });
  data.members = data.members.filter((m) => m.id !== req.params.id);
  data.schedules = data.schedules.filter((s) => s.memberId !== req.params.id);
  data.recurringRules = data.recurringRules.filter((r) => r.memberId !== req.params.id);
  data.memos = data.memos.filter((mo) => mo.memberId !== req.params.id);
  await saveData(data);
  res.status(204).end();
});

// ---------- 일정 API ----------
app.get('/api/schedules', async (req, res) => {
  const data = await readData();
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

app.post('/api/schedules', async (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  const data = await readData();
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
  await saveData(data);
  res.status(201).json(schedule);
});

app.put('/api/schedules/:id', async (req, res) => {
  const data = await readData();
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
  await saveData(data);
  res.json(schedule);
});

app.delete('/api/schedules/:id', async (req, res) => {
  const data = await readData();
  const exists = data.schedules.some((s) => s.id === req.params.id);
  if (!exists) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  data.schedules = data.schedules.filter((s) => s.id !== req.params.id);
  await saveData(data);
  res.status(204).end();
});

// ---------- 반복 일정 API ----------
// 반복 일정은 "규칙(rule)"과 그 규칙으로 생성된 실제 일정(schedules)을 함께 관리한다.
// 규칙을 등록/수정하면 해당 기간·요일에 맞춰 개별 일정을 미리 생성해 저장해두므로,
// 그리드에서는 일반 일정과 완전히 동일하게 조회/클릭/수정/삭제가 가능하다.
// (규칙을 수정하면 그 규칙으로 생성됐던 기존 일정은 모두 지우고 새 조건으로 다시 생성한다)
function noEndHorizon() {
  const now = new Date();
  return new Date(now.getFullYear() + 5, 11, 31); // 주간 이동 가능 범위(YEAR_MAX)와 동일하게 맞춘 상한
}

function generateRecurringSchedules(rule) {
  const [sy, sm, sd] = rule.startDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = rule.endDate
    ? (() => { const [ey, em, ed] = rule.endDate.split('-').map(Number); return new Date(ey, em - 1, ed); })()
    : noEndHorizon();
  const daysSet = new Set(rule.daysOfWeek);
  const results = [];
  const cur = new Date(start);
  while (cur <= end) {
    if (daysSet.has(cur.getDay())) {
      results.push({
        id: newId(),
        memberId: rule.memberId,
        date: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
        start: rule.start,
        end: rule.end,
        title: rule.title,
        memo: '',
        recurringId: rule.id
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

function validateRecurring(body) {
  const { memberId, title, daysOfWeek, startDate, endDate, start, end } = body;
  if (!memberId || !title || !title.trim()) return '구성원과 일정 제목은 필수입니다.';
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return '반복 요일을 하나 이상 선택해주세요.';
  if (daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return '반복 요일 값이 올바르지 않습니다.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) return '시작 날짜 형식이 올바르지 않습니다.';
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return '종료 날짜 형식이 올바르지 않습니다.';
  if (endDate && endDate < startDate) return '종료 날짜는 시작 날짜보다 빠를 수 없습니다.';
  if (!/^\d{2}:\d{2}$/.test(start || '') || !/^\d{2}:\d{2}$/.test(end || '')) return '시간 형식이 올바르지 않습니다.';
  if (start >= end) return '종료 시간은 시작 시간보다 늦어야 합니다.';
  return null;
}

app.get('/api/recurring', async (req, res) => {
  const data = await readData();
  res.json(data.recurringRules);
});

app.post('/api/recurring', async (req, res) => {
  const err = validateRecurring(req.body);
  if (err) return res.status(400).json({ error: err });
  const data = await readData();
  if (!data.members.some((m) => m.id === req.body.memberId)) {
    return res.status(400).json({ error: '존재하지 않는 구성원입니다.' });
  }
  const rule = {
    id: newId(),
    memberId: req.body.memberId,
    title: req.body.title.trim(),
    daysOfWeek: [...new Set(req.body.daysOfWeek)].sort((a, b) => a - b),
    startDate: req.body.startDate,
    endDate: req.body.endDate || null,
    start: req.body.start,
    end: req.body.end
  };
  data.recurringRules.push(rule);
  data.schedules.push(...generateRecurringSchedules(rule));
  await saveData(data);
  res.status(201).json(rule);
});

app.put('/api/recurring/:id', async (req, res) => {
  const data = await readData();
  const rule = data.recurringRules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: '반복 일정을 찾을 수 없습니다.' });
  const merged = { ...rule, ...req.body };
  const err = validateRecurring(merged);
  if (err) return res.status(400).json({ error: err });
  if (!data.members.some((m) => m.id === merged.memberId)) {
    return res.status(400).json({ error: '존재하지 않는 구성원입니다.' });
  }
  Object.assign(rule, {
    memberId: merged.memberId,
    title: merged.title.trim(),
    daysOfWeek: [...new Set(merged.daysOfWeek)].sort((a, b) => a - b),
    startDate: merged.startDate,
    endDate: merged.endDate || null,
    start: merged.start,
    end: merged.end
  });
  data.schedules = data.schedules.filter((s) => s.recurringId !== rule.id);
  data.schedules.push(...generateRecurringSchedules(rule));
  await saveData(data);
  res.json(rule);
});

app.delete('/api/recurring/:id', async (req, res) => {
  const data = await readData();
  const exists = data.recurringRules.some((r) => r.id === req.params.id);
  if (!exists) return res.status(404).json({ error: '반복 일정을 찾을 수 없습니다.' });
  data.recurringRules = data.recurringRules.filter((r) => r.id !== req.params.id);
  data.schedules = data.schedules.filter((s) => s.recurringId !== req.params.id);
  await saveData(data);
  res.status(204).end();
});

// ---------- 가족 메모보드 API (임시 기능: 추후 별도 게시판 기능으로 대체 예정) ----------
app.get('/api/memos', async (req, res) => {
  const data = await readData();
  res.json(data.memos);
});

app.post('/api/memos', async (req, res) => {
  const { memberId, text } = req.body;
  if (!memberId || !text || !text.trim()) {
    return res.status(400).json({ error: '작성자와 내용을 입력해주세요.' });
  }
  const data = await readData();
  if (!data.members.some((m) => m.id === memberId)) {
    return res.status(400).json({ error: '존재하지 않는 구성원입니다.' });
  }
  const memo = {
    id: newId(),
    memberId,
    text: text.trim().slice(0, 200),
    createdAt: new Date().toISOString()
  };
  data.memos.push(memo);
  await saveData(data);
  res.status(201).json(memo);
});

app.delete('/api/memos/:id', async (req, res) => {
  const data = await readData();
  const exists = data.memos.some((m) => m.id === req.params.id);
  if (!exists) return res.status(404).json({ error: '메모를 찾을 수 없습니다.' });
  data.memos = data.memos.filter((m) => m.id !== req.params.id);
  await saveData(data);
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

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// Vercel 등 서버리스 환경에서는 이 파일을 require해서 요청마다 app을 호출할 뿐,
// 직접 실행(node server.js)할 때만 포트를 열어 로컬 서버로 띄운다.
if (require.main === module) {
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
}

module.exports = app;
