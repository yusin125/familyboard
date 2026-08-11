(function () {
  'use strict';

  // ---------- 상수 ----------
  const START_HOUR = 6;
  const END_HOUR = 24;
  const SLOT_MIN = 30;
  const TOTAL_SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MIN; // 36
  const POLL_INTERVAL_MS = 8000;
  const TALL_BLOCK_MIN_HEIGHT = 46; // 이 높이(px) 이상이면 제목을 여러 줄로 줄바꿈
  const COLOR_PALETTE = ['#E3A542', '#EE8B72', '#5B9BD5', '#6FAE8C', '#C98BC9', '#4FB8AE', '#D97A9C', '#A6A15C'];

  const MIN_COL_WIDTH = 24;
  const MAX_COL_WIDTH = 170;
  const MIN_ROW_HEIGHT = 18; // 이보다 작아지면 안 읽히므로 이 아래로는 줄이지 않는다(가독성 최소 높이)
  const COMFORTABLE_ROW_HEIGHT = 34; // 여유 공간이 있어도 행을 이 이상으로 늘리지 않고, 대신 시간대를 더 보여준다
  const COMFORTABLE_ROW_HEIGHT_TV = 40; // 1500px 이상 큰 화면(거실 TV)용
  const OPEN_MIN_DAYS = 6; // 패널 열림: 스크롤 없이 최소 월~토(6일)
  const OPEN_MIN_SLOTS = 30; // 패널 열림: 스크롤 없이 최소 06:00~21:00(15시간=30칸)
  const CLOSED_MIN_SLOTS = TOTAL_SLOTS; // 패널 닫힘: 06:00~24:00 전체를 목표로 시도(부족하면 MIN_ROW_HEIGHT로 절충 후 세로 스크롤 허용)

  const TODAY_REAL = new Date();
  const YEAR_MIN = TODAY_REAL.getFullYear();
  const YEAR_MAX = YEAR_MIN + 5;

  // ---------- 날짜 유틸 ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseISODate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  const MIN_WEEK_START = mondayOf(new Date(YEAR_MIN, 0, 1));
  const MAX_WEEK_START = mondayOf(new Date(YEAR_MAX, 11, 31));

  function timeToSlot(t) {
    const [h, m] = t.split(':').map(Number);
    return ((h - START_HOUR) * 60 + m) / SLOT_MIN;
  }
  function slotToTime(i) {
    const totalMin = START_HOUR * 60 + i * SLOT_MIN;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${pad(h)}:${pad(m)}`;
  }
  function clampSlot(x) { return Math.min(Math.max(x, 0), TOTAL_SLOTS); }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // ---------- 상태 ----------
  const state = {
    mode: 'viewer',
    members: [],
    schedules: [],
    recurringRules: [],
    memos: [],
    selectedMemoMemberId: null,
    selectedMemberIds: new Set(),
    weekStart: mondayOf(TODAY_REAL),
    miniCalMonth: { year: TODAY_REAL.getFullYear(), month: TODAY_REAL.getMonth() },
    editingScheduleId: null,
    editingRecurringId: null,
    sidebarCollapsed: false
  };
  const knownMemberIds = new Set();

  // ---------- DOM 참조 ----------
  const $ = (id) => document.getElementById(id);
  const weekLabel = $('weekLabel');
  const prevWeekBtn = $('prevWeekBtn');
  const nextWeekBtn = $('nextWeekBtn');
  const todayBtn = $('todayBtn');
  const modeToggleBtn = $('modeToggleBtn');
  const miniMonthLabel = $('miniMonthLabel');
  const miniCalGrid = $('miniCalGrid');
  const miniPrevMonth = $('miniPrevMonth');
  const miniNextMonth = $('miniNextMonth');
  const sidebar = $('sidebar');
  const sidebarToggleBtn = $('sidebarToggleBtn');
  const memberFilterList = $('memberFilterList');
  const manageMembersBtn = $('manageMembersBtn');
  const boardScroll = $('boardScroll');
  const boardHeader = $('boardHeader');
  const boardBody = $('boardBody');

  const scheduleModal = $('scheduleModal');
  const scheduleModalTitle = $('scheduleModalTitle');
  const scheduleForm = $('scheduleForm');
  const fMember = $('fMember');
  const fDate = $('fDate');
  const fStart = $('fStart');
  const fEnd = $('fEnd');
  const fTitle = $('fTitle');
  const fMemo = $('fMemo');
  const scheduleFormError = $('scheduleFormError');
  const deleteScheduleBtn = $('deleteScheduleBtn');
  const cancelScheduleBtn = $('cancelScheduleBtn');

  const memberModal = $('memberModal');
  const memberManageList = $('memberManageList');
  const addMemberForm = $('addMemberForm');
  const newMemberName = $('newMemberName');
  const memberFormError = $('memberFormError');
  const closeMemberModalBtn = $('closeMemberModalBtn');

  const manageRecurringBtn = $('manageRecurringBtn');
  const recurringModal = $('recurringModal');
  const recurringForm = $('recurringForm');
  const rMember = $('rMember');
  const rTitle = $('rTitle');
  const rDaysOfWeek = $('rDaysOfWeek');
  const rStartDate = $('rStartDate');
  const rEndDate = $('rEndDate');
  const rNoEnd = $('rNoEnd');
  const rStart = $('rStart');
  const rEnd = $('rEnd');
  const recurringFormError = $('recurringFormError');
  const recurringSubmitBtn = $('recurringSubmitBtn');
  const cancelRecurringEditBtn = $('cancelRecurringEditBtn');
  const recurringList = $('recurringList');
  const closeRecurringModalBtn = $('closeRecurringModalBtn');

  const memoList = $('memoList');
  const memoForm = $('memoForm');
  const memoMemberBtn = $('memoMemberBtn');
  const memoMemberDropdown = $('memoMemberDropdown');
  const memoText = $('memoText');

  const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토']; // index = Date#getDay()
  const DOW_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일 순으로 표시

  // ---------- API ----------
  async function apiGet(path) {
    const r = await fetch(path);
    if (!r.ok) throw { error: '데이터를 불러오지 못했습니다.' };
    return r.json();
  }
  async function apiSend(method, path, body) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    const text = await r.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { /* ignore */ } }
    if (!r.ok) throw (data || { error: '요청 처리 중 오류가 발생했습니다.' });
    return data;
  }

  // ---------- 렌더링: 상단/네비게이션 ----------
  function renderModeUI() {
    const isAdmin = state.mode === 'admin';
    document.body.classList.toggle('mode-admin', isAdmin);
    modeToggleBtn.classList.toggle('active', isAdmin);
    modeToggleBtn.setAttribute('aria-pressed', String(isAdmin));
  }

  function renderWeekNav() {
    const start = state.weekStart;
    const end = addDays(start, 6);
    weekLabel.textContent = `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일(월) ~ ${end.getMonth() + 1}월 ${end.getDate()}일(일)`;
    prevWeekBtn.disabled = start <= MIN_WEEK_START;
    nextWeekBtn.disabled = start >= MAX_WEEK_START;
  }

  function renderMiniCal() {
    const { year, month } = state.miniCalMonth;
    miniMonthLabel.textContent = `${year}년 ${month + 1}월`;
    miniCalGrid.innerHTML = '';
    const firstOfMonth = new Date(year, month, 1);
    const gridStart = mondayOf(firstOfMonth);
    const todayIso = toISODate(TODAY_REAL);
    const weekEndExclusive = addDays(state.weekStart, 7);

    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const iso = toISODate(d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mini-day';
      btn.dataset.date = iso;
      btn.textContent = String(d.getDate());
      if (d.getMonth() !== month) btn.classList.add('other-month');
      const holidayName = window.FB_HOLIDAYS[iso];
      if (holidayName || d.getDay() === 0) btn.classList.add('holiday');
      else if (d.getDay() === 6) btn.classList.add('saturday');
      if (iso === todayIso) btn.classList.add('today');
      if (d >= state.weekStart && d < weekEndExclusive) btn.classList.add('in-week');
      if (holidayName) btn.title = holidayName;
      miniCalGrid.appendChild(btn);
    }
    miniPrevMonth.disabled = year <= YEAR_MIN && month <= 0;
    miniNextMonth.disabled = year >= YEAR_MAX && month >= 11;
  }

  function renderMemberFilter() {
    renderMemoMemberPicker();
    memberFilterList.innerHTML = '';
    state.members.forEach((m) => {
      const row = el('label', 'member-filter-item');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.id = m.id;
      cb.checked = state.selectedMemberIds.has(m.id);
      const swatch = el('span', 'member-swatch');
      swatch.style.background = m.color;
      const name = el('span', 'member-filter-name', m.name);
      row.appendChild(cb);
      row.appendChild(swatch);
      row.appendChild(name);
      memberFilterList.appendChild(row);
    });
  }

  function populateMemberSelect(select) {
    const prev = select.value;
    select.innerHTML = '';
    state.members.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      select.appendChild(opt);
    });
    if (prev) select.value = prev;
  }

  function renderScheduleFormMemberOptions() {
    populateMemberSelect(fMember);
    populateMemberSelect(rMember);
  }

  // 시작/종료 시간 select는 그리드 칸(30분 단위)에 대응하는 값만 옵션으로 제공한다.
  // (예전 <input type="time">은 일부 브라우저에서 1분 단위 스크롤이 나오고, 24:00을 표현하지 못해
  //  자정 종료 일정에서 "종료 시간은 시작 시간보다 늦어야 합니다" 오류가 잘못 발생했다)
  function buildTimeOptions(select, fromSlot, toSlot) {
    select.innerHTML = '';
    for (let i = fromSlot; i <= toSlot; i++) {
      const opt = document.createElement('option');
      opt.value = slotToTime(i);
      opt.textContent = slotToTime(i);
      select.appendChild(opt);
    }
  }

  function renderMemberManageList() {
    memberManageList.innerHTML = '';
    state.members.forEach((m) => {
      const row = el('div', 'member-manage-row');

      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = 'color-dot-btn';
      colorBtn.style.background = m.color;
      colorBtn.title = '클릭하여 색상 변경';
      colorBtn.addEventListener('click', async () => {
        const idx = COLOR_PALETTE.indexOf(m.color);
        const newColor = COLOR_PALETTE[(idx + 1) % COLOR_PALETTE.length];
        try {
          await apiSend('PUT', `/api/members/${m.id}`, { color: newColor });
          await refreshMembers();
        } catch (err) { memberFormError.textContent = err.error || '색상 변경에 실패했습니다.'; }
      });

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = m.name;
      nameInput.maxLength = 10;
      nameInput.addEventListener('change', async () => {
        const val = nameInput.value.trim();
        if (!val) { nameInput.value = m.name; return; }
        try {
          await apiSend('PUT', `/api/members/${m.id}`, { name: val });
          await refreshMembers();
        } catch (err) {
          memberFormError.textContent = err.error || '이름 변경에 실패했습니다.';
          nameInput.value = m.name;
        }
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'small-icon-btn';
      delBtn.textContent = '✕';
      delBtn.title = '삭제';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`'${m.name}' 구성원을 삭제하면 이 구성원의 모든 일정도 함께 삭제됩니다. 계속할까요?`)) return;
        try {
          await apiSend('DELETE', `/api/members/${m.id}`);
          await refreshMembers();
        } catch (err) { memberFormError.textContent = err.error || '삭제에 실패했습니다.'; }
      });

      row.appendChild(colorBtn);
      row.appendChild(nameInput);
      row.appendChild(delBtn);
      memberManageList.appendChild(row);
    });
  }

  // ---------- 렌더링: 반복 일정 관리 모달 ----------
  function buildDaysOfWeekPicker() {
    rDaysOfWeek.innerHTML = '';
    DOW_DISPLAY_ORDER.forEach((dow) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dow-btn';
      btn.dataset.dow = String(dow);
      btn.textContent = DOW_LABELS[dow];
      btn.addEventListener('click', () => btn.classList.toggle('active'));
      rDaysOfWeek.appendChild(btn);
    });
  }

  function getSelectedDaysOfWeek() {
    return Array.from(rDaysOfWeek.querySelectorAll('.dow-btn.active')).map((b) => Number(b.dataset.dow));
  }

  function setSelectedDaysOfWeek(days) {
    const set = new Set(days);
    Array.from(rDaysOfWeek.querySelectorAll('.dow-btn')).forEach((b) => {
      b.classList.toggle('active', set.has(Number(b.dataset.dow)));
    });
  }

  function formatDaysOfWeek(days) {
    const set = new Set(days);
    return DOW_DISPLAY_ORDER.filter((d) => set.has(d)).map((d) => DOW_LABELS[d]).join('·');
  }

  function resetRecurringForm() {
    state.editingRecurringId = null;
    recurringForm.reset();
    setSelectedDaysOfWeek([]);
    rEndDate.disabled = false;
    rEndDate.required = true;
    recurringSubmitBtn.textContent = '추가';
    cancelRecurringEditBtn.classList.add('hidden');
    recurringFormError.textContent = '';
  }

  function fillRecurringFormForEdit(rule) {
    state.editingRecurringId = rule.id;
    rMember.value = rule.memberId;
    rTitle.value = rule.title;
    setSelectedDaysOfWeek(rule.daysOfWeek);
    rStartDate.value = rule.startDate;
    if (rule.endDate) {
      rNoEnd.checked = false;
      rEndDate.value = rule.endDate;
      rEndDate.disabled = false;
      rEndDate.required = true;
    } else {
      rNoEnd.checked = true;
      rEndDate.value = '';
      rEndDate.disabled = true;
      rEndDate.required = false;
    }
    rStart.value = rule.start;
    rEnd.value = rule.end;
    recurringSubmitBtn.textContent = '수정 저장';
    cancelRecurringEditBtn.classList.remove('hidden');
    recurringFormError.textContent = '';
  }

  function renderRecurringList() {
    recurringList.innerHTML = '';
    if (state.recurringRules.length === 0) {
      recurringList.appendChild(el('div', 'recurring-empty', '등록된 반복 일정이 없습니다.'));
      return;
    }
    state.members.forEach((member) => {
      const rules = state.recurringRules.filter((r) => r.memberId === member.id);
      if (rules.length === 0) return;

      const groupTitle = el('div', 'recurring-group-title');
      const dot = el('span', 'member-swatch');
      dot.style.background = member.color;
      groupTitle.appendChild(dot);
      groupTitle.appendChild(el('span', null, member.name));
      recurringList.appendChild(groupTitle);

      const ol = document.createElement('ol');
      ol.className = 'recurring-items';
      rules.forEach((rule, idx) => {
        const li = document.createElement('li');
        li.className = 'recurring-item';
        const period = rule.endDate ? `${rule.startDate} ~ ${rule.endDate}` : `${rule.startDate} ~ 종료없음`;
        const body = el(
          'div',
          'ri-body',
          `${rule.title} · ${formatDaysOfWeek(rule.daysOfWeek)} · ${period} · ${rule.start}~${rule.end}`
        );
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'small-icon-btn';
        editBtn.textContent = '✎';
        editBtn.title = '수정';
        editBtn.addEventListener('click', () => fillRecurringFormForEdit(rule));
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'small-icon-btn';
        delBtn.textContent = '✕';
        delBtn.title = '삭제';
        delBtn.addEventListener('click', async () => {
          if (!confirm(`'${rule.title}' 반복 일정을 삭제하면 이 규칙으로 생성된 모든 일정도 함께 삭제됩니다. 계속할까요?`)) return;
          try {
            await apiSend('DELETE', `/api/recurring/${rule.id}`);
            if (state.editingRecurringId === rule.id) resetRecurringForm();
            await refreshRecurring();
            await refreshSchedules();
          } catch (err) {
            recurringFormError.textContent = err.error || '삭제에 실패했습니다.';
          }
        });
        li.appendChild(el('span', 'ri-num', `${idx + 1}.`));
        li.appendChild(body);
        li.appendChild(editBtn);
        li.appendChild(delBtn);
        ol.appendChild(li);
      });
      recurringList.appendChild(ol);
    });
  }

  async function refreshRecurring() {
    state.recurringRules = await apiGet('/api/recurring');
    renderRecurringList();
  }

  function openRecurringModal() {
    resetRecurringForm();
    renderScheduleFormMemberOptions();
    renderRecurringList();
    recurringModal.classList.remove('hidden');
  }
  function closeRecurringModal() {
    recurringModal.classList.add('hidden');
    resetRecurringForm();
  }

  // ---------- 렌더링: 가족 메모보드 (임시 기능) ----------
  // 작성자는 이름 텍스트 없이 구성원 필터와 같은 색상 점 아이콘만으로 구분한다(공간 절약).
  // 입력줄에는 현재 선택된 구성원의 점 1개만 버튼으로 보이고, 클릭하면 나머지 구성원을 고르는
  // 작은 팝업이 뜬다(채팅 앱의 입력줄처럼 한 줄에 [작성자 점]+[입력창]+[전송]이 들어가게 하기 위함).
  function closeMemoMemberDropdown() {
    memoMemberDropdown.classList.add('hidden');
  }

  function renderMemoMemberPicker() {
    const existingIds = new Set(state.members.map((m) => m.id));
    if (!state.selectedMemoMemberId || !existingIds.has(state.selectedMemoMemberId)) {
      state.selectedMemoMemberId = state.members.length > 0 ? state.members[0].id : null;
    }

    const selected = state.members.find((m) => m.id === state.selectedMemoMemberId);
    memoMemberBtn.style.background = selected ? selected.color : '#ccc';
    memoMemberBtn.title = selected ? selected.name : '작성자 선택';

    memoMemberDropdown.innerHTML = '';
    state.members.forEach((m) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'memo-dot-option' + (m.id === state.selectedMemoMemberId ? ' active' : '');
      opt.style.background = m.color;
      opt.title = m.name;
      opt.dataset.id = m.id;
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedMemoMemberId = m.id;
        closeMemoMemberDropdown();
        renderMemoMemberPicker();
      });
      memoMemberDropdown.appendChild(opt);
    });
  }

  function renderMemoBoard() {
    memoList.innerHTML = '';
    const sorted = [...state.memos].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (sorted.length === 0) {
      memoList.appendChild(el('div', 'memo-empty', '아직 남긴 메모가 없어요.'));
      return;
    }
    sorted.forEach((memo) => {
      const member = state.members.find((m) => m.id === memo.memberId);
      const row = el('div', 'memo-item');
      const dot = el('span', 'member-swatch');
      dot.style.background = member ? member.color : '#ccc';
      dot.title = member ? member.name : '(알 수 없음)';
      const text = el('span', 'memo-text', memo.text);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'small-icon-btn memo-del-btn';
      delBtn.textContent = '✕';
      delBtn.title = '삭제';
      delBtn.addEventListener('click', async () => {
        if (!confirm('이 메모를 삭제할까요?')) return;
        try {
          await apiSend('DELETE', `/api/memos/${memo.id}`);
          await refreshMemos();
        } catch (err) {
          alert(err.error || '삭제에 실패했습니다.');
        }
      });
      row.appendChild(dot);
      row.appendChild(text);
      row.appendChild(delBtn);
      memoList.appendChild(row);
    });
  }

  async function refreshMemos() {
    state.memos = await apiGet('/api/memos');
    renderMemoBoard();
  }

  // ---------- 렌더링: 보드(그리드) ----------
  function getRowHeight() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--row-height');
    return parseFloat(v) || 26;
  }

  function memberChipLabel(name) {
    if (document.body.classList.contains('col-very-compact')) return name.slice(0, 1);
    if (document.body.classList.contains('col-compact')) return name.length > 2 ? name.slice(0, 2) : name;
    return name;
  }

  function getTimeColWidth() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--time-col-width');
    return parseFloat(v) || 54;
  }

  function getHeaderHeights() {
    const cs = getComputedStyle(document.documentElement);
    const header1 = parseFloat(cs.getPropertyValue('--header1-height')) || 40;
    const header2 = parseFloat(cs.getPropertyValue('--header2-height')) || 30;
    return header1 + header2;
  }

  // 가로: "스크롤 없이 기본으로 보이는 범위"가 아래 기준을 만족하도록 열 너비를 계산한다.
  //   - 왼쪽 패널이 열려있으면: 최소 월~토(6일)는 스크롤 없이 보이게 (일요일은 가로 스크롤 허용)
  //   - 왼쪽 패널이 닫혀있으면: 구성원 5명 이하일 때 7일 전체가 스크롤 없이 보이게
  //     (닫혀있어도 구성원 6명 이상이면 억지로 욱여넣지 않고 가로 스크롤 허용 — 기존과 동일)
  // 세로: 마찬가지로 아래 기준을 만족하도록 행 높이를 계산한다.
  //   - 왼쪽 패널이 열려있으면: 최소 06:00~21:00(15시간=30칸)
  //   - 왼쪽 패널이 닫혀있으면: 06:00~24:00 전체(TOTAL_SLOTS)를 목표로 하되, 그러면 칸 높이가
  //     MIN_ROW_HEIGHT보다 작아질 화면에서는 가독성을 위해 MIN_ROW_HEIGHT를 지키고 그만큼
  //     세로 스크롤을 아주 약간 허용한다(아래 rowHeight 계산 로직이 자동으로 절충함).
  function computeGridFit() {
    const visibleMembers = state.members.filter((m) => state.selectedMemberIds.has(m.id));
    const memberCount = visibleMembers.length;
    const containerWidth = boardScroll.clientWidth;
    const containerHeight = boardScroll.clientHeight;
    if (!containerWidth || !containerHeight) return;

    const sidebarOpen = !state.sidebarCollapsed;
    const timeColWidth = getTimeColWidth();

    // ---- 가로: 열 너비 ----
    const shouldFitWidth = sidebarOpen ? memberCount > 0 : memberCount > 0 && memberCount <= 5;
    if (shouldFitWidth) {
      const targetDays = sidebarOpen ? OPEN_MIN_DAYS : 7;
      const totalCols = targetDays * memberCount;
      // .day-group/.day-col-group 는 각각 오른쪽 구분선(2px)이 있어 순수 열 너비 합계보다
      // (보이는 요일 수) x 2px 만큼 더 차지한다. 이를 빼지 않으면 정확히 안 맞아 스크롤이 생김.
      const DAY_BORDER = 2;
      let colWidth = Math.floor((containerWidth - timeColWidth - targetDays * DAY_BORDER) / totalCols);
      colWidth = Math.min(Math.max(colWidth, MIN_COL_WIDTH), MAX_COL_WIDTH);
      document.documentElement.style.setProperty('--col-width', colWidth + 'px');
      document.body.classList.toggle('col-compact', colWidth < 65);
      document.body.classList.toggle('col-very-compact', colWidth < 48);
    } else {
      document.documentElement.style.removeProperty('--col-width');
      document.body.classList.remove('col-compact', 'col-very-compact');
    }

    // ---- 세로: 행 높이 ----
    // 목표 칸 수를 "정확히" 채우도록 늘리는 대신, 편안한 높이를 상한으로 두고 그보다 여유 공간이
    // 남으면 행을 더 키우지 않고 그만큼 시간대가 더 보이도록 한다(헤더를 줄여 확보한 공간도 동일하게 적용됨).
    const targetSlots = sidebarOpen ? OPEN_MIN_SLOTS : CLOSED_MIN_SLOTS;
    const headerHeight = getHeaderHeights();
    const comfortable = containerWidth >= 1500 ? COMFORTABLE_ROW_HEIGHT_TV : COMFORTABLE_ROW_HEIGHT;
    const neededForTarget = (containerHeight - headerHeight) / targetSlots;
    let rowHeight = Math.min(comfortable, neededForTarget);
    rowHeight = Math.max(rowHeight, MIN_ROW_HEIGHT);
    rowHeight = Math.floor(rowHeight * 10) / 10;
    document.documentElement.style.setProperty('--row-height', rowHeight + 'px');
  }

  function applyResponsiveLayout() {
    computeGridFit();
    renderBoard();
  }

  function computeBusySlots(schedules) {
    const busy = new Array(TOTAL_SLOTS).fill(false);
    schedules.forEach((s) => {
      const startSlot = Math.floor(clampSlot(timeToSlot(s.start)));
      const endSlot = Math.ceil(clampSlot(timeToSlot(s.end)));
      for (let i = startSlot; i < endSlot; i++) {
        if (i >= 0 && i < TOTAL_SLOTS) busy[i] = true;
      }
    });
    return busy;
  }

  function layoutItems(items) {
    const sorted = [...items].sort((a, b) => a._start - b._start || a._end - b._end);
    const columnEnds = [];
    sorted.forEach((it) => {
      let placed = false;
      for (let c = 0; c < columnEnds.length; c++) {
        if (columnEnds[c] <= it._start) {
          it._col = c;
          columnEnds[c] = it._end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        it._col = columnEnds.length;
        columnEnds.push(it._end);
      }
    });
    const colCount = columnEnds.length || 1;
    sorted.forEach((it) => { it._colCount = colCount; });
    return sorted;
  }

  function renderBoard() {
    // 그리드가 다시 그려지면 이전 DOM을 참조하던 진행 중인 칸 선택/블록 드래그 상태는 무효화된다.
    clearSlotSelection();
    cancelDragCopy();
    const days = [...Array(7)].map((_, i) => addDays(state.weekStart, i));
    const visibleMembers = state.members.filter((m) => state.selectedMemberIds.has(m.id));

    boardHeader.innerHTML = '';
    boardBody.innerHTML = '';
    boardHeader.appendChild(el('div', 'corner'));

    if (visibleMembers.length === 0) {
      const note = el('div', 'day-group');
      note.style.padding = '10px 16px';
      note.style.display = 'flex';
      note.style.alignItems = 'center';
      note.textContent = '왼쪽에서 구성원을 선택해주세요';
      boardHeader.appendChild(note);
      boardBody.appendChild(el('div', 'empty-board-msg', '선택된 구성원이 없습니다. 왼쪽 사이드바에서 한 명 이상 선택하면 일정이 표시됩니다.'));
      return;
    }

    const rowHeight = getRowHeight();
    const todayIso = toISODate(TODAY_REAL);

    // 헤더
    days.forEach((day) => {
      const iso = toISODate(day);
      const dow = ['일', '월', '화', '수', '목', '금', '토'][day.getDay()];
      const holidayName = window.FB_HOLIDAYS[iso];
      const isHoliday = !!holidayName || day.getDay() === 0;
      const isSaturday = day.getDay() === 6;
      const isToday = iso === todayIso;

      const group = el('div', 'day-group' + (isToday ? ' is-today' : ''));
      const title = el('div', 'day-title' + (isHoliday ? ' holiday' : '') + (isSaturday ? ' saturday' : ''));
      title.appendChild(el('span', 'date-line', `${day.getMonth() + 1}/${day.getDate()}(${dow})`));
      if (holidayName) title.appendChild(el('span', 'holiday-name', holidayName));
      title.title = holidayName ? `${dow}요일, ${holidayName}` : `${dow}요일`;
      group.appendChild(title);

      const memberRow = el('div', 'member-row');
      visibleMembers.forEach((m) => {
        const chip = el('div', 'member-chip');
        chip.title = m.name;
        const dot = el('span', 'dot');
        dot.style.background = m.color;
        chip.appendChild(dot);
        chip.appendChild(el('span', null, memberChipLabel(m.name)));
        memberRow.appendChild(chip);
      });
      group.appendChild(memberRow);
      boardHeader.appendChild(group);
    });

    // 본문
    const timeCol = el('div', 'time-col');
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const isHour = i % 2 === 0;
      const label = el('div', 'time-label' + (isHour ? ' hour' : ''), isHour ? `${pad(START_HOUR + i / 2)}:00` : '');
      label.style.height = rowHeight + 'px';
      timeCol.appendChild(label);
    }
    boardBody.appendChild(timeCol);

    const now = new Date();
    // 실제 현재 시각을 기준으로 "이미 지나간" 칸을 계산한다(과거 날짜는 항상 전체가 지나간 시간).
    // 매 렌더링마다 실제 현재 시각으로 다시 계산되므로 다른 주로 이동했다 돌아와도 항상 정확하다.
    const nowSlotFloat = ((now.getHours() - START_HOUR) * 60 + now.getMinutes()) / SLOT_MIN;
    const nowSlot = Math.floor(nowSlotFloat);

    let todayGroupEl = null;

    days.forEach((day) => {
      const iso = toISODate(day);
      const isToday = iso === todayIso;
      const isPastDay = iso < todayIso;
      const daySchedules = state.schedules.filter((s) => s.date === iso);

      const group = el('div', 'day-col-group' + (isToday ? ' is-today' : ''));

      visibleMembers.forEach((member) => {
        const col = el('div', 'member-col');
        col.style.height = TOTAL_SLOTS * rowHeight + 'px';

        const memberDaySchedulesRaw = daySchedules.filter((s) => s.memberId === member.id);
        const busy = computeBusySlots(memberDaySchedulesRaw);

        for (let i = 0; i < TOTAL_SLOTS; i++) {
          const isPastSlot = isPastDay || (isToday && i < nowSlot);
          const isFree = !busy[i] && !isPastSlot;
          const cell = el(
            'div',
            'slot-cell' + (i % 2 === 0 ? ' hour-line' : '') + (isFree ? ' free-slot' : '')
          );
          cell.style.height = rowHeight + 'px';
          cell.dataset.member = member.id;
          cell.dataset.date = iso;
          cell.dataset.slot = String(i);
          col.appendChild(cell);
        }

        const memberDaySchedules = memberDaySchedulesRaw
          .map((s) => ({ ...s, _start: clampSlot(timeToSlot(s.start)), _end: clampSlot(timeToSlot(s.end)) }));
        const laidOut = layoutItems(memberDaySchedules);

        laidOut.forEach((s) => {
          const top = s._start * rowHeight;
          const height = Math.max((s._end - s._start) * rowHeight - 2, rowHeight - 4);
          const widthPct = 100 / s._colCount;
          const leftPct = s._col * widthPct;
          const block = el('div', 'schedule-block' + (height >= TALL_BLOCK_MIN_HEIGHT ? ' tall' : ''));
          block.style.top = top + 'px';
          block.style.height = height + 'px';
          block.style.left = `calc(${leftPct}% + 2px)`;
          block.style.width = `calc(${widthPct}% - 4px)`;
          block.style.background = member.color;
          block.title = `${s.title} (${s.start}~${s.end})` + (s.memo ? ` - ${s.memo}` : '');
          block.dataset.scheduleId = s.id;
          block.appendChild(el('div', 'sb-title', s.title));
          block.appendChild(el('div', 'sb-time', `${s.start}~${s.end}`));
          block.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.mode !== 'admin') return;
            if (e.ctrlKey || e.metaKey) return; // Ctrl/Cmd+드래그 복사는 mousedown에서 처리
            openBlockActionMenu(s, block, e);
          });
          col.appendChild(block);
        });

        group.appendChild(col);
      });

      boardBody.appendChild(group);
      if (isToday) todayGroupEl = group;
    });

    // 현재 시각 가이드선: 오늘이 포함된 주를 볼 때만, 실제 현재 시각 기준으로 그린다.
    // (매 렌더링마다 실제 시각으로 다시 계산되므로 폴링에 의해 주기적으로 최신 상태로 갱신된다)
    const isCurrentWeek = days.some((d) => toISODate(d) === todayIso);
    if (isCurrentWeek && nowSlotFloat >= 0 && nowSlotFloat <= TOTAL_SLOTS) {
      const lineTop = nowSlotFloat * rowHeight;
      const nowLine = el('div', 'now-line');
      nowLine.style.top = lineTop + 'px';
      boardBody.appendChild(nowLine);

      const nowArrow = el('div', 'now-arrow', '▶');
      nowArrow.style.top = lineTop + 'px';
      timeCol.appendChild(nowArrow);

      if (todayGroupEl) {
        const todaySeg = el('div', 'now-line-today');
        todaySeg.style.top = lineTop + 'px';
        todaySeg.style.left = todayGroupEl.offsetLeft + 'px';
        todaySeg.style.width = todayGroupEl.offsetWidth + 'px';
        boardBody.appendChild(todaySeg);

        const nowDot = el('div', 'now-dot');
        nowDot.style.top = lineTop + 'px';
        nowDot.style.left = todayGroupEl.offsetLeft + 'px';
        boardBody.appendChild(nowDot);
      }
    }
  }

  function renderAll() {
    renderModeUI();
    renderWeekNav();
    renderMiniCal();
    renderMemberFilter();
    applyResponsiveLayout();
  }

  // ---------- 이벤트 핸들러 ----------

  // ----- 그리드 클릭/드래그로 시작~종료 시간 선택 -----
  // slotSelection.stage:
  //   'dragging'    : 마우스 버튼을 누른 채(아직 뗌 전) 진행 중. 실제로 다른 칸으로 이동하면 뗄 때 바로 확정.
  //   'awaiting-end': 첫 클릭(이동 없이 누르고 뗌)만 한 상태. 같은 칸에서 두 번째 클릭을 기다린다.
  let slotSelection = null;

  function clearSlotSelection() {
    if (slotSelection && slotSelection.cells) {
      slotSelection.cells.forEach((c) => c.classList.remove('sel-preview'));
    }
    slotSelection = null;
  }

  function applySlotSelectionHighlight() {
    if (!slotSelection) return;
    const { cells, anchorSlot, endSlot } = slotSelection;
    const lo = Math.min(anchorSlot, endSlot);
    const hi = Math.max(anchorSlot, endSlot);
    cells.forEach((c, i) => c.classList.toggle('sel-preview', i >= lo && i <= hi));
  }

  function beginSlotSelection(cell) {
    const memberId = cell.dataset.member;
    const dateIso = cell.dataset.date;
    const slot = Number(cell.dataset.slot);

    if (
      slotSelection &&
      slotSelection.stage === 'awaiting-end' &&
      slotSelection.memberId === memberId &&
      slotSelection.dateIso === dateIso
    ) {
      const from = slotSelection.anchorSlot;
      clearSlotSelection();
      finalizeSlotSelection(memberId, dateIso, from, slot);
      return;
    }

    clearSlotSelection();
    const col = cell.closest('.member-col');
    const cells = Array.from(col.querySelectorAll('.slot-cell'));
    slotSelection = { memberId, dateIso, anchorSlot: slot, endSlot: slot, cells, stage: 'dragging', moved: false };
    applySlotSelectionHighlight();
  }

  function updateSlotSelectionHover(cell) {
    if (!slotSelection) return;
    if (cell.dataset.member !== slotSelection.memberId || cell.dataset.date !== slotSelection.dateIso) return;
    const slot = Number(cell.dataset.slot);
    if (slot !== slotSelection.endSlot) slotSelection.moved = true;
    slotSelection.endSlot = slot;
    applySlotSelectionHighlight();
  }

  function finishSlotPointerUp() {
    if (!slotSelection || slotSelection.stage !== 'dragging') return;
    if (slotSelection.moved) {
      const { memberId, dateIso, anchorSlot, endSlot } = slotSelection;
      clearSlotSelection();
      finalizeSlotSelection(memberId, dateIso, anchorSlot, endSlot);
    } else {
      slotSelection.stage = 'awaiting-end';
    }
  }

  function finalizeSlotSelection(memberId, dateIso, slotA, slotB) {
    const lo = Math.min(slotA, slotB);
    const hi = Math.max(slotA, slotB);
    const start = slotToTime(lo);
    const end = slotToTime(hi + 1); // +1: 마지막으로 클릭한 칸도 범위에 포함(마지막 칸이면 24:00까지)
    openScheduleModalForNew(memberId, dateIso, start, end);
  }

  // ----- 일정 복사: 클릭(복사→붙여넣기) -----
  let pasteSource = null;
  let pasteHintEl = null;

  function showPasteHint() {
    hidePasteHint();
    pasteHintEl = el('div', 'paste-hint-banner', '붙여넣을 칸을 클릭하세요 (Esc: 취소)');
    document.body.appendChild(pasteHintEl);
  }
  function hidePasteHint() {
    if (pasteHintEl) { pasteHintEl.remove(); pasteHintEl = null; }
  }
  function startPasteMode(schedule) {
    clearSlotSelection();
    pasteSource = schedule;
    document.body.classList.add('paste-mode');
    showPasteHint();
  }
  function exitPasteMode() {
    pasteSource = null;
    document.body.classList.remove('paste-mode');
    hidePasteHint();
  }
  async function pasteScheduleAt(cell) {
    const schedule = pasteSource;
    exitPasteMode();
    const durationSlots = clampSlot(timeToSlot(schedule.end)) - clampSlot(timeToSlot(schedule.start));
    let startSlot = Number(cell.dataset.slot);
    let endSlot = startSlot + durationSlots;
    if (endSlot > TOTAL_SLOTS) { endSlot = TOTAL_SLOTS; startSlot = Math.max(0, endSlot - durationSlots); }
    const payload = {
      memberId: cell.dataset.member,
      date: cell.dataset.date,
      start: slotToTime(startSlot),
      end: slotToTime(endSlot),
      title: schedule.title,
      memo: schedule.memo || ''
    };
    try {
      await apiSend('POST', '/api/schedules', payload);
      await refreshSchedules();
    } catch (err) {
      alert(err.error || '복사에 실패했습니다.');
    }
  }

  // ----- 일정 복사: Ctrl+드래그 -----
  let dragCopy = null; // { schedule, durationSlots, grabOffset, cells, target }

  function beginDragCopy(blockEl, evt) {
    const schedule = state.schedules.find((s) => s.id === blockEl.dataset.scheduleId);
    if (!schedule) return;
    exitPasteMode();
    clearSlotSelection();
    const durationSlots = clampSlot(timeToSlot(schedule.end)) - clampSlot(timeToSlot(schedule.start));
    const col = blockEl.closest('.member-col');
    const rect = col.getBoundingClientRect();
    const rowHeight = getRowHeight();
    const grabSlot = Math.floor((evt.clientY - rect.top) / rowHeight);
    const startSlot = clampSlot(timeToSlot(schedule.start));
    dragCopy = { schedule, durationSlots, grabOffset: grabSlot - startSlot, cells: null, target: null };
    document.body.classList.add('drag-copy-active');
  }

  function updateDragCopyHover(cell) {
    if (!dragCopy) return;
    const col = cell.closest('.member-col');
    const cells = Array.from(col.querySelectorAll('.slot-cell'));
    const hoveredSlot = Number(cell.dataset.slot);
    let startSlot = hoveredSlot - dragCopy.grabOffset;
    startSlot = Math.max(0, Math.min(startSlot, TOTAL_SLOTS - dragCopy.durationSlots));
    const endSlot = startSlot + dragCopy.durationSlots;

    if (dragCopy.cells && dragCopy.cells !== cells) {
      dragCopy.cells.forEach((c) => c.classList.remove('sel-preview'));
    }
    cells.forEach((c, i) => c.classList.toggle('sel-preview', i >= startSlot && i < endSlot));
    dragCopy.cells = cells;
    dragCopy.target = { memberId: cell.dataset.member, dateIso: cell.dataset.date, startSlot, endSlot };
  }

  function cancelDragCopy() {
    if (dragCopy && dragCopy.cells) dragCopy.cells.forEach((c) => c.classList.remove('sel-preview'));
    dragCopy = null;
    document.body.classList.remove('drag-copy-active');
  }

  async function finishDragCopy() {
    if (!dragCopy) return;
    const { schedule, target, cells } = dragCopy;
    if (cells) cells.forEach((c) => c.classList.remove('sel-preview'));
    document.body.classList.remove('drag-copy-active');
    dragCopy = null;
    if (!target) return;
    const payload = {
      memberId: target.memberId,
      date: target.dateIso,
      start: slotToTime(target.startSlot),
      end: slotToTime(target.endSlot),
      title: schedule.title,
      memo: schedule.memo || ''
    };
    try {
      await apiSend('POST', '/api/schedules', payload);
      await refreshSchedules();
    } catch (err) {
      alert(err.error || '복사에 실패했습니다.');
    }
  }

  // ----- 일정 블록 클릭 시 수정/복사 메뉴 -----
  let blockMenuEl = null;
  function closeBlockMenu() {
    if (blockMenuEl) { blockMenuEl.remove(); blockMenuEl = null; }
  }
  function openBlockActionMenu(schedule, blockEl, evt) {
    closeBlockMenu();
    const menu = el('div', 'block-action-menu');
    const editBtn = el('button', 'block-action-btn', '수정');
    editBtn.type = 'button';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeBlockMenu();
      openScheduleModalForEdit(schedule);
    });
    const copyBtn = el('button', 'block-action-btn', '복사');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeBlockMenu();
      startPasteMode(schedule);
    });
    menu.appendChild(editBtn);
    menu.appendChild(copyBtn);
    document.body.appendChild(menu);
    const rect = blockEl.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - 140);
    menu.style.left = left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
    blockMenuEl = menu;
  }

  function openScheduleModalForNew(memberId, dateIso, start, end) {
    if (state.members.length === 0) {
      alert('먼저 구성원을 등록해주세요. (좌측 사이드바 > 구성원 관리)');
      return;
    }
    state.editingScheduleId = null;
    scheduleModalTitle.textContent = '일정 등록';
    deleteScheduleBtn.classList.add('hidden');
    renderScheduleFormMemberOptions();
    fMember.value = memberId;
    fDate.value = dateIso;
    fStart.value = start;
    fEnd.value = end;
    fTitle.value = '';
    fMemo.value = '';
    scheduleFormError.textContent = '';
    scheduleModal.classList.remove('hidden');
    fTitle.focus();
  }

  function openScheduleModalForEdit(schedule) {
    state.editingScheduleId = schedule.id;
    scheduleModalTitle.textContent = '일정 수정';
    deleteScheduleBtn.classList.remove('hidden');
    renderScheduleFormMemberOptions();
    fMember.value = schedule.memberId;
    fDate.value = schedule.date;
    fStart.value = schedule.start;
    fEnd.value = schedule.end;
    fTitle.value = schedule.title;
    fMemo.value = schedule.memo || '';
    scheduleFormError.textContent = '';
    scheduleModal.classList.remove('hidden');
  }

  function closeScheduleModal() {
    scheduleModal.classList.add('hidden');
    scheduleForm.reset();
    state.editingScheduleId = null;
  }

  function changeMiniMonth(delta) {
    let { year, month } = state.miniCalMonth;
    month += delta;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    if (year < YEAR_MIN) { year = YEAR_MIN; month = 0; }
    if (year > YEAR_MAX) { year = YEAR_MAX; month = 11; }
    state.miniCalMonth = { year, month };
    renderMiniCal();
  }

  async function refreshMembers() {
    state.members = await apiGet('/api/members');
    const existingIds = new Set(state.members.map((m) => m.id));
    state.selectedMemberIds = new Set([...state.selectedMemberIds].filter((id) => existingIds.has(id)));
    state.members.forEach((m) => {
      if (!knownMemberIds.has(m.id)) {
        knownMemberIds.add(m.id);
        state.selectedMemberIds.add(m.id);
      }
    });
    renderMemberFilter();
    renderMemberManageList();
    renderScheduleFormMemberOptions();
    applyResponsiveLayout();
  }

  async function refreshSchedules() {
    state.schedules = await apiGet('/api/schedules');
    renderBoard();
  }

  function bindEvents() {
    buildTimeOptions(fStart, 0, TOTAL_SLOTS - 1); // 06:00~23:30 (시작 시간)
    buildTimeOptions(fEnd, 1, TOTAL_SLOTS); // 06:30~24:00 (종료 시간, 24:00 포함)
    buildTimeOptions(rStart, 0, TOTAL_SLOTS - 1);
    buildTimeOptions(rEnd, 1, TOTAL_SLOTS);
    buildDaysOfWeekPicker();

    prevWeekBtn.addEventListener('click', () => {
      const newStart = addDays(state.weekStart, -7);
      if (newStart >= MIN_WEEK_START) {
        state.weekStart = newStart;
        state.miniCalMonth = { year: newStart.getFullYear(), month: newStart.getMonth() };
        renderAll();
      }
    });
    nextWeekBtn.addEventListener('click', () => {
      const newStart = addDays(state.weekStart, 7);
      if (newStart <= MAX_WEEK_START) {
        state.weekStart = newStart;
        state.miniCalMonth = { year: newStart.getFullYear(), month: newStart.getMonth() };
        renderAll();
      }
    });
    todayBtn.addEventListener('click', () => {
      state.weekStart = mondayOf(TODAY_REAL);
      state.miniCalMonth = { year: TODAY_REAL.getFullYear(), month: TODAY_REAL.getMonth() };
      renderAll();
    });

    miniPrevMonth.addEventListener('click', () => changeMiniMonth(-1));
    miniNextMonth.addEventListener('click', () => changeMiniMonth(1));
    miniCalGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.mini-day');
      if (!btn) return;
      const d = parseISODate(btn.dataset.date);
      let newStart = mondayOf(d);
      if (newStart < MIN_WEEK_START) newStart = MIN_WEEK_START;
      if (newStart > MAX_WEEK_START) newStart = MAX_WEEK_START;
      state.weekStart = newStart;
      state.miniCalMonth = { year: d.getFullYear(), month: d.getMonth() };
      renderAll();
    });

    modeToggleBtn.addEventListener('click', () => {
      state.mode = state.mode === 'admin' ? 'viewer' : 'admin';
      if (state.mode !== 'admin') {
        clearSlotSelection();
        exitPasteMode();
        cancelDragCopy();
        closeBlockMenu();
      }
      renderModeUI();
    });

    memberFilterList.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"]')) {
        const id = e.target.dataset.id;
        if (e.target.checked) state.selectedMemberIds.add(id);
        else state.selectedMemberIds.delete(id);
        applyResponsiveLayout();
      }
    });

    manageMembersBtn.addEventListener('click', () => {
      memberFormError.textContent = '';
      renderMemberManageList();
      memberModal.classList.remove('hidden');
    });
    closeMemberModalBtn.addEventListener('click', () => memberModal.classList.add('hidden'));
    memberModal.addEventListener('click', (e) => { if (e.target === memberModal) memberModal.classList.add('hidden'); });

    manageRecurringBtn.addEventListener('click', openRecurringModal);
    closeRecurringModalBtn.addEventListener('click', closeRecurringModal);
    recurringModal.addEventListener('click', (e) => { if (e.target === recurringModal) closeRecurringModal(); });
    cancelRecurringEditBtn.addEventListener('click', resetRecurringForm);

    rNoEnd.addEventListener('change', () => {
      rEndDate.disabled = rNoEnd.checked;
      rEndDate.required = !rNoEnd.checked;
      if (rNoEnd.checked) rEndDate.value = '';
    });

    recurringForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const daysOfWeek = getSelectedDaysOfWeek();
      if (daysOfWeek.length === 0) {
        recurringFormError.textContent = '반복 요일을 하나 이상 선택해주세요.';
        return;
      }
      if (!rNoEnd.checked && (!rEndDate.value || rEndDate.value < rStartDate.value)) {
        recurringFormError.textContent = '종료 날짜는 시작 날짜보다 빠를 수 없습니다.';
        return;
      }
      if (!rStart.value || !rEnd.value || rStart.value >= rEnd.value) {
        recurringFormError.textContent = '종료 시간은 시작 시간보다 늦어야 합니다.';
        return;
      }
      const payload = {
        memberId: rMember.value,
        title: rTitle.value.trim(),
        daysOfWeek,
        startDate: rStartDate.value,
        endDate: rNoEnd.checked ? null : rEndDate.value,
        start: rStart.value,
        end: rEnd.value
      };
      try {
        if (state.editingRecurringId) {
          await apiSend('PUT', `/api/recurring/${state.editingRecurringId}`, payload);
        } else {
          await apiSend('POST', '/api/recurring', payload);
        }
        resetRecurringForm();
        await refreshRecurring();
        await refreshSchedules();
      } catch (err) {
        recurringFormError.textContent = err.error || '저장에 실패했습니다.';
      }
    });

    memoMemberBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      memoMemberDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!memoMemberDropdown.classList.contains('hidden') && !e.target.closest('.memo-member-select-wrap')) {
        closeMemoMemberDropdown();
      }
    });

    memoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = memoText.value.trim();
      if (!text || !state.selectedMemoMemberId) return;
      try {
        await apiSend('POST', '/api/memos', { memberId: state.selectedMemoMemberId, text });
        memoText.value = '';
        await refreshMemos();
      } catch (err) {
        alert(err.error || '메모 등록에 실패했습니다.');
      }
    });

    addMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = newMemberName.value.trim();
      if (!name) return;
      try {
        await apiSend('POST', '/api/members', { name });
        newMemberName.value = '';
        memberFormError.textContent = '';
        await refreshMembers();
      } catch (err) {
        memberFormError.textContent = err.error || '구성원 추가에 실패했습니다.';
      }
    });

    cancelScheduleBtn.addEventListener('click', closeScheduleModal);
    scheduleModal.addEventListener('click', (e) => { if (e.target === scheduleModal) closeScheduleModal(); });

    scheduleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        memberId: fMember.value,
        date: fDate.value,
        start: fStart.value,
        end: fEnd.value,
        title: fTitle.value.trim(),
        memo: fMemo.value.trim()
      };
      if (!payload.start || !payload.end || payload.start >= payload.end) {
        scheduleFormError.textContent = '종료 시간은 시작 시간보다 늦어야 합니다.';
        return;
      }
      try {
        if (state.editingScheduleId) {
          await apiSend('PUT', `/api/schedules/${state.editingScheduleId}`, payload);
        } else {
          await apiSend('POST', '/api/schedules', payload);
        }
        await refreshSchedules();
        closeScheduleModal();
      } catch (err) {
        scheduleFormError.textContent = err.error || '저장에 실패했습니다.';
      }
    });

    deleteScheduleBtn.addEventListener('click', async () => {
      if (!state.editingScheduleId) return;
      if (!confirm('이 일정을 삭제할까요?')) return;
      try {
        await apiSend('DELETE', `/api/schedules/${state.editingScheduleId}`);
        await refreshSchedules();
        closeScheduleModal();
      } catch (err) {
        scheduleFormError.textContent = err.error || '삭제에 실패했습니다.';
      }
    });

    sidebarToggleBtn.addEventListener('click', () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
      sidebarToggleBtn.textContent = state.sidebarCollapsed ? '》' : '《';
      sidebarToggleBtn.title = state.sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기';
      applyResponsiveLayout();
    });

    // ----- 그리드 클릭/드래그(시간 선택 + 붙여넣기) / Ctrl+드래그(블록 복사) -----
    boardBody.addEventListener('mousedown', (e) => {
      if (state.mode !== 'admin') return;
      if (e.button !== 0) return;

      const block = e.target.closest('.schedule-block');
      if (block && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        beginDragCopy(block, e);
        return;
      }

      const cell = e.target.closest('.slot-cell');
      if (pasteSource) {
        if (cell) { e.preventDefault(); pasteScheduleAt(cell); }
        return;
      }

      if (block) return; // 일반 클릭은 click 이벤트에서 수정/복사 메뉴를 연다
      if (!cell) return;

      e.preventDefault();
      beginSlotSelection(cell);
    });

    boardBody.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.slot-cell');
      if (!cell) return;
      if (dragCopy) { updateDragCopyHover(cell); return; }
      if (slotSelection) { updateSlotSelectionHover(cell); return; }
    });

    document.addEventListener('mouseup', () => {
      if (dragCopy) { finishDragCopy(); return; }
      finishSlotPointerUp();
    });

    document.addEventListener('click', (e) => {
      if (blockMenuEl && !blockMenuEl.contains(e.target) && !e.target.closest('.schedule-block')) {
        closeBlockMenu();
      }
      if (
        pasteSource &&
        !e.target.closest('.slot-cell') &&
        !e.target.closest('.schedule-block') &&
        !e.target.closest('.block-action-menu')
      ) {
        exitPasteMode();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      clearSlotSelection();
      exitPasteMode();
      cancelDragCopy();
      closeBlockMenu();
      closeMemoMemberDropdown();
    });

    window.addEventListener('resize', debounce(() => applyResponsiveLayout(), 200));
  }

  function startPolling() {
    setInterval(async () => {
      try {
        const [members, schedules, recurringRules, memos] = await Promise.all([
          apiGet('/api/members'),
          apiGet('/api/schedules'),
          apiGet('/api/recurring'),
          apiGet('/api/memos')
        ]);
        state.members = members;
        state.schedules = schedules;
        state.recurringRules = recurringRules;
        state.memos = memos;
        const existingIds = new Set(state.members.map((m) => m.id));
        state.selectedMemberIds = new Set([...state.selectedMemberIds].filter((id) => existingIds.has(id)));
        state.members.forEach((m) => {
          if (!knownMemberIds.has(m.id)) {
            knownMemberIds.add(m.id);
            state.selectedMemberIds.add(m.id);
          }
        });
        renderMemberFilter();
        applyResponsiveLayout();
        renderMemoBoard();
        if (!recurringModal.classList.contains('hidden')) renderRecurringList();
      } catch (err) {
        console.error('폴링 중 오류:', err);
      }
    }, POLL_INTERVAL_MS);
  }

  async function init() {
    try {
      const [members, schedules, recurringRules, memos] = await Promise.all([
        apiGet('/api/members'),
        apiGet('/api/schedules'),
        apiGet('/api/recurring'),
        apiGet('/api/memos')
      ]);
      state.members = members;
      state.schedules = schedules;
      state.recurringRules = recurringRules;
      state.memos = memos;
      members.forEach((m) => knownMemberIds.add(m.id));
      state.selectedMemberIds = new Set(members.map((m) => m.id));
    } catch (err) {
      alert('서버에서 데이터를 불러오지 못했습니다. 서버가 실행 중인지 확인해주세요.');
    }
    bindEvents();
    renderAll();
    renderMemoBoard();
    startPolling();
  }

  init();
})();
