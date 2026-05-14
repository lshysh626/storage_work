const API_URL = ''; // No backend needed for static version
// ─── State ───────────────────────────────────────────────
let state = {
    view: 'dashboard',
    questions: [],
    index: 0,
    timer: 0,
    timerInt: null,
    submitting: false,
    subMode: null,   // null | 'type' | 'session'
    bulkScoring: false,
    quizMode: 'immediate',
    userAnswers: [],
    currentSessionId: null
};

// ─── Type labels (ACTUAL values from JSON) ─────────────────
const TYPE_LABEL = { short: '단답형', essay: '서술형', practical: '실무형' };
const TYPE_POINTS = { short: 3, essay: 12, practical: 16 };

// ─── API Key Error UI ─────────────────────────────────────
function buildApiKeyErrorHTML(message, retryCall) {
    const isQuota = message.includes('한도') || message.includes('quota') || message.includes('Quota');
    return `
        <div style="padding: 1.2rem; border-radius: 10px; background: rgba(30,41,59,0.8); border: 1px solid rgba(248,113,113,0.3);">
            <div style="color: #f87171; font-weight: 700; margin-bottom: 0.8rem;">
                ${isQuota ? '🔑 API 키 요청 한도 초과' : '⚠️ AI 연결 오류'}
            </div>
            <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem; line-height: 1.6;">
                ${isQuota
                    ? '지금 사용중인 API 키의 무료 한도가 초과되었습니다.<br>아래에 <strong style="color:#38bdf8;">Google AI Studio</strong>에서 발급한 본인 API 키를 입력하세요.'
                    : message
                }
            </p>
            ${isQuota ? `
            <div style="display:flex; gap:0.5rem; margin-bottom:0.8rem;">
                <input id="quick-api-key" type="password" placeholder="AIzaSy... (키 입력 후 Enter)"
                    style="flex:1; background:rgba(15,23,42,0.8); border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:0.6rem 0.8rem; color:#fff; font-size:0.9rem; outline:none;"
                    onkeydown="if(event.key==='Enter') saveQuickApiKey('${retryCall}')"
                >
                <button onclick="saveQuickApiKey('${retryCall}')" 
                    style="background:#0ea5e9; color:#fff; border:none; border-radius:6px; padding:0.6rem 1rem; cursor:pointer; font-weight:700; font-size:0.85rem; white-space:nowrap;">
                    저장 & 재시도
                </button>
            </div>
            <a href="https://aistudio.google.com/apikey" target="_blank"
                style="color:#38bdf8; font-size:0.8rem; text-decoration:none;">
                🔗 Google AI Studio에서 API 키 발급 (무료)
            </a>` : ''}
            <button onclick="${retryCall}" 
                style="display:block; width:100%; margin-top:0.8rem; background:rgba(248,113,113,0.15); color:#f87171; border:1px solid rgba(248,113,113,0.4); padding:0.5rem; border-radius:6px; cursor:pointer; font-size:0.85rem;">
                다시 시도
            </button>
        </div>
    `;
}

function saveQuickApiKey(retryCall) {
    const input = document.getElementById('quick-api-key');
    const key = input?.value?.trim();
    if (!key) { alert('키를 입력해주세요.'); return; }
    localStorage.setItem('gemini_api_key', key);
    // 설정 페이지 동기화
    const settingInput = document.getElementById('setting-api-key');
    if (settingInput) settingInput.value = key;
    // 재시도
    eval(retryCall);
}

// ─── View Switching ───────────────────────────────────────
function switchView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-links li').forEach(li =>
        li.classList.toggle('active', li.dataset.view === id));
    const sidebar = document.getElementById('sidebar');
    if (id === 'quiz-view') sidebar.classList.add('hidden');
    else sidebar.classList.remove('hidden');
    state.view = id;
}

// Navigation event listeners moved to the end of the file to avoid duplicates and errors

// ─── Sync ─────────────────────────────────────────────────
// Sync button listener moved to the end of the file

// ─── Dashboard ────────────────────────────────────────────
async function renderDashboard() {
    const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
    const total = history.length;
    const avg = total > 0
        ? Math.round(history.reduce((s, r) => s + (r.pct || 0), 0) / total)
        : 0;
    const last = total > 0 ? (history[history.length - 1].pct || 0) + '%' : '-';

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card"><div class="label">총 풀이 횟수</div><div class="value">${total}</div></div>
        <div class="stat-card"><div class="label">평균 점수</div><div class="value">${avg}%</div></div>
        <div class="stat-card"><div class="label">최근 점수</div><div class="value">${last}</div></div>
    `;

    // Fetch parsed sessions
    const parsedDiv = document.getElementById('parsed-sessions');
    if (!parsedDiv) return;

    try {
        const res = await fetch('http://localhost:8000/api/sessions');
        const sessions = await res.json();

        if (sessions.length === 0) {
            parsedDiv.innerHTML = `
                <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:2rem; text-align:center;">
                    <span style="font-size:2rem;">📂</span>
                    <p style="color:var(--muted); margin-top:0.8rem;">파싱된 기출 자료가 없습니다. <strong style="color:var(--primary); cursor:pointer;" onclick="document.getElementById('sync-btn').click()">데이터 동기화</strong>를 먼저 해주세요.</p>
                </div>
            `;
            return;
        }

        const totalQuestions = sessions.reduce((s, sess) => s + sess.count, 0);

        const sessionCards = sessions.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:1rem 1.5rem; background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid rgba(255,255,255,0.04);">
                <div style="display:flex; align-items:center; gap:1rem;">
                    <span style="font-size:1.5rem;">📄</span>
                    <span style="font-weight:700;">${s.name}</span>
                </div>
                <span style="color:var(--primary); font-weight:800; font-size:1.1rem;">${s.count}문항</span>
            </div>
        `).join('');

        parsedDiv.innerHTML = `
            <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:2rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                    <h3 style="font-weight:800; font-size:1.2rem;">📚 파싱된 기출 자료</h3>
                    <div style="display:flex; gap:1rem; align-items:center;">
                        <span style="color:var(--muted); font-size:0.9rem;">${sessions.length}개 회차</span>
                        <span style="background:rgba(56,189,248,0.1); color:var(--primary); padding:0.3rem 0.8rem; border-radius:6px; font-weight:800; font-size:0.9rem; border:1px solid rgba(56,189,248,0.2);">총 ${totalQuestions}문항</span>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.8rem;">
                    ${sessionCards}
                </div>
            </div>
        `;
    } catch {
        parsedDiv.innerHTML = `
            <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:2rem; text-align:center; color:var(--muted);">
                서버 연결 오류 — 백엔드 서버가 실행 중인지 확인해주세요.
            </div>
        `;
    }
}

function renderStats() {
    const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
    const container = document.getElementById('stats-detail');

    if (history.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 4rem 2rem;">
                <div style="font-size: 4rem; margin-bottom: 1.5rem;">📊</div>
                <h2 style="color: var(--muted); font-weight: 700; margin-bottom: 1rem;">아직 학습 기록이 없습니다</h2>
                <p style="color: var(--muted); font-size: 1.1rem;">기출 풀기에서 문제를 풀어보세요!</p>
            </div>
        `;
        return;
    }

    const total = history.length;
    const avgPct = Math.round(history.reduce((s, r) => s + (r.pct||0), 0) / total);
    const best = Math.max(...history.map(h => h.pct||0));
    const worst = Math.min(...history.map(h => h.pct||0));
    const totalScore = history.reduce((s, r) => s + (r.totalScore||0), 0);
    const totalMax = history.reduce((s, r) => s + (r.maxScore||0), 0);

    // Recent 10 for chart
    const recent = history.slice(-10);
    const chartBars = recent.map((r, i) => {
        const h = Math.max(r.pct||0, 5);
        const color = (r.pct||0) >= 60 ? '#10b981' : (r.pct||0) >= 40 ? '#f59e0b' : '#f87171';
        const date = r.date ? new Date(r.date) : null;
        const label = date ? `${date.getMonth()+1}/${date.getDate()}` : `#${i+1}`;
        return `
            <div style="display:flex; flex-direction:column; align-items:center; flex:1; gap:0.4rem;">
                <span style="font-size:0.8rem; font-weight:700; color:${color};">${r.pct||0}%</span>
                <div style="width:100%; max-width:40px; height:${h * 1.5}px; background:${color}; border-radius:6px 6px 2px 2px; transition: height 0.5s ease;"></div>
                <span style="font-size:0.7rem; color:var(--muted);">${label}</span>
            </div>
        `;
    }).join('');

    // History table (most recent first)
    const rows = [...history].reverse().slice(0, 20).map((r, i) => {
        const date = r.date ? new Date(r.date).toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '-';
        const pctColor = (r.pct||0) >= 60 ? '#10b981' : (r.pct||0) >= 40 ? '#f59e0b' : '#f87171';
        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'" onclick="document.getElementById('details-${r.id}').style.display = document.getElementById('details-${r.id}').style.display === 'none' ? 'table-row' : 'none'">
                <td style="padding:1rem; color:var(--muted);">${history.length - i}</td>
                <td style="padding:1rem;"><strong>${r.title}</strong><br><span style="font-size:0.85rem; color:var(--muted);">${date}</span></td>
                <td style="padding:1rem; text-align:center;">${r.totalScore ?? 0} / ${r.maxScore ?? 0}점</td>
                <td style="padding:1rem; text-align:center; font-weight:800; color:${pctColor};">${r.pct||0}%</td>
            </tr>
            <tr id="details-${r.id}" style="display:none; background: rgba(0,0,0,0.2);">
                <td colspan="4" style="padding: 1.5rem;">
                    <div style="display:flex; flex-direction:column; gap:0.8rem; max-height:400px; overflow-y:auto; padding-right:0.5rem;">
                        ${(r.details || []).map((d, idx) => `
                            <div style="background:rgba(255,255,255,0.03); padding:1rem; border-radius:8px; border-left:4px solid ${d.is_correct ? '#10b981' : '#f87171'}">
                                <div style="font-weight:bold; margin-bottom:0.6rem; line-height:1.4;">Q${idx+1}. ${d.question}</div>
                                <div style="font-size:0.95rem; margin-bottom:0.4rem; color:#e2e8f0;"><span style="color:var(--muted); margin-right:0.4rem;">내 답변:</span> ${d.user_answer}</div>
                                <div style="font-size:0.95rem; margin-bottom:0.6rem; color:#e2e8f0;"><span style="color:#38bdf8; margin-right:0.4rem;">모범 답안:</span> ${d.correct_answer}</div>
                                <div style="font-size:0.9rem; color:${d.is_correct ? '#10b981' : '#f87171'}; font-weight:bold;">[${d.score}/${d.points}점] ${d.feedback}</div>
                            </div>
                        `).join('')}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <!-- Summary Cards -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1.2rem; margin-bottom:2.5rem;">
            <div class="stat-card">
                <div class="label">총 풀이 횟수</div>
                <div class="value">${total}</div>
            </div>
            <div class="stat-card">
                <div class="label">평균 점수</div>
                <div class="value" style="color:${avgPct >= 60 ? '#10b981' : '#f59e0b'};">${avgPct}%</div>
            </div>
            <div class="stat-card">
                <div class="label">최고 점수</div>
                <div class="value" style="color:#10b981;">${best}%</div>
            </div>
            <div class="stat-card">
                <div class="label">최저 점수</div>
                <div class="value" style="color:#f87171;">${worst}%</div>
            </div>
        </div>

        <!-- Score Chart -->
        <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:2rem; margin-bottom:2.5rem;">
            <h3 style="margin-bottom:1.5rem; font-weight:800; font-size:1.2rem;">📈 최근 점수 추이 (최대 10회)</h3>
            <div style="display:flex; align-items:flex-end; gap:0.5rem; height:200px; padding:0 0.5rem;">
                ${chartBars}
            </div>
            <div style="text-align:center; margin-top:1rem; color:var(--muted); font-size:0.85rem;">60% 이상 <span style="color:#10b981;">●</span> · 40~59% <span style="color:#f59e0b;">●</span> · 40% 미만 <span style="color:#f87171;">●</span></div>
        </div>

        <!-- Cumulative -->
        <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:2rem; margin-bottom:2.5rem;">
            <h3 style="margin-bottom:1.2rem; font-weight:800; font-size:1.2rem;">🏆 누적 성적</h3>
            <div style="display:flex; align-items:center; gap:2rem;">
                <div style="flex:1;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
                        <span style="color:var(--muted);">누적 획득</span>
                        <span style="font-weight:800;">${totalScore} / ${totalMax}점</span>
                    </div>
                    <div style="height:12px; background:rgba(0,0,0,0.3); border-radius:6px; overflow:hidden;">
                        <div style="height:100%; width:${totalMax > 0 ? Math.round(totalScore/totalMax*100) : 0}%; background:linear-gradient(90deg, #0ea5e9, #10b981); border-radius:6px; transition:width 0.6s;"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- History Table -->
        <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; overflow:hidden; margin-bottom:2rem;">
            <h3 style="padding:1.5rem 2rem 1rem; font-weight:800; font-size:1.2rem;">📋 풀이 기록 (최근 20건)</h3>
            <table style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                        <th style="padding:0.8rem 1rem; text-align:left; color:var(--muted); font-size:0.85rem;">#</th>
                        <th style="padding:0.8rem 1rem; text-align:left; color:var(--muted); font-size:0.85rem;">날짜</th>
                        <th style="padding:0.8rem 1rem; text-align:center; color:var(--muted); font-size:0.85rem;">점수</th>
                        <th style="padding:0.8rem 1rem; text-align:center; color:var(--muted); font-size:0.85rem;">정답률</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>

        <!-- Clear Button -->
        <div style="text-align:center; padding:1rem;">
            <button onclick="if(confirm('학습 기록을 모두 삭제하시겠습니까?')){localStorage.removeItem('quiz_sessions');renderStats();renderDashboard();}" style="background:rgba(248,113,113,0.1); color:#f87171; border:1px solid rgba(248,113,113,0.3); padding:0.8rem 2rem; border-radius:8px; cursor:pointer; font-weight:700; transition:0.2s;" onmouseover="this.style.background='rgba(248,113,113,0.2)'" onmouseout="this.style.background='rgba(248,113,113,0.1)'">
                🗑️ 학습 기록 초기화
            </button>
        </div>
    `;
}

// ─── Quiz Selection ───────────────────────────────────────
function toggleTypeSelection() {
    const sub = document.getElementById('sub-list');
    if (state.subMode === 'type') {
        sub.classList.add('hidden');
        state.subMode = null;
        return;
    }
    state.subMode = 'type';
    sub.style.display = 'block'; // CSS의 grid 설정을 무시하여 찌그러짐 방지
    sub.classList.remove('hidden');
    sub.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
            <div class="item-row" id="type-row-short" style="cursor: pointer;" onclick="selectType('short', 12, '단답형')">
                <div class="text"><strong>단답형</strong><span>3점 문제</span></div>
            </div>
            <div class="item-row" id="type-row-essay" style="cursor: pointer;" onclick="selectType('essay', 4, '서술형')">
                <div class="text"><strong>서술형</strong><span>12점 문제</span></div>
            </div>
            <div class="item-row" id="type-row-practical" style="cursor: pointer;" onclick="selectType('practical', 2, '실무형')">
                <div class="text"><strong>실무형</strong><span>16점 문제</span></div>
            </div>
        </div>
        
        <!-- 하단 통합 입력 영역 (예쁘게 중앙 정렬 및 크기 제한) -->
        <div id="type-action-area" style="display: none; margin-top: 1.5rem; animation: fadeIn 0.3s ease;">
            <div style="max-width: 420px; margin: 0 auto; background: rgba(30, 41, 59, 0.9); border: 1px solid var(--primary); padding: 1.5rem 2rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 189, 248, 0.15); text-align: center;">
                <div style="margin-bottom: 1.5rem; color: #fff; font-size: 1.15rem;">
                    <strong id="selected-type-name" style="color: var(--primary); font-size: 1.3rem;">유형</strong>
                    <span style="color: #cbd5e1; font-weight: 500;"> 몇 문제를 푸시겠습니까?</span>
                </div>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <input type="number" id="global-type-count" value="" min="1" style="width: 120px; padding: 0.8rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: rgba(15,23,42,0.8); color: #fff; outline: none; font-size: 1.3rem; text-align: center; font-weight: 800; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                    <button id="global-type-start-btn" style="flex: 1; background: linear-gradient(135deg, #0ea5e9, #38bdf8); color: #fff; border: none; border-radius: 10px; font-weight: 800; font-size: 1.2rem; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 12px rgba(56, 189, 248, 0.3);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">시작하기</button>
                </div>
            </div>
        </div>
    `;
}

function selectType(type, defaultCount, typeName) {
    document.querySelectorAll('#sub-list .item-row').forEach(el => {
        el.style.borderColor = 'rgba(255,255,255,0.05)';
        el.style.background = 'rgba(255,255,255,0.03)';
    });
    
    const row = document.getElementById(`type-row-${type}`);
    if (row) {
        row.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        row.style.background = 'rgba(30, 41, 59, 0.7)';
    }

    const actionArea = document.getElementById('type-action-area');
    if (actionArea) {
        actionArea.style.display = 'block';
        document.getElementById('selected-type-name').textContent = typeName;
        document.getElementById('global-type-count').value = defaultCount;
        document.getElementById('global-type-start-btn').onclick = () => startTypeQuiz(type);
    }
}
window.selectType = selectType;

async function toggleSessionSelection() {
    const sub = document.getElementById('sub-list');
    sub.style.display = ''; // CSS grid 복구
    if (state.subMode === 'session') {
        sub.classList.add('hidden');
        state.subMode = null;
        return;
    }
    state.subMode = 'session';
    sub.classList.remove('hidden');
    sub.innerHTML = '<div style="color:var(--muted);padding:1rem">불러오는 중...</div>';
    try {
        const res = await fetch('http://localhost:8000/api/sessions');
        const sessions = await res.json();
        if (sessions.length === 0) {
            sub.innerHTML = '<div style="color:var(--muted);padding:1rem">동기화 후 회차가 나타납니다.</div>';
            return;
        }
        sub.innerHTML = sessions.map(s =>
            `<div class="item-row" onclick="startSessionQuiz('${s.id}')">
                <div class="text"><strong>${s.name}</strong><span>${s.count}문항</span></div>
            </div>`
        ).join('');
    } catch {
        sub.innerHTML = '<div style="color:#f87171;padding:1rem">서버 연결 오류</div>';
    }
}

async function startRandomQuiz() {
    const res = await fetch('http://localhost:8000/api/questions/all');
    const data = await res.json();
    const shuffled = [...data.questions].sort(() => Math.random() - 0.5);
    launchQuiz(shuffled, '🎲 랜덤 풀기');
}

async function startTypeQuiz(type) {
    const res = await fetch(`http://localhost:8000/api/questions/type/${type}`);
    const data = await res.json();
    let questions = data.questions;
    
    if (!questions || questions.length === 0) {
        alert('해당 유형의 문제가 없습니다.');
        return;
    }

    // 1. 순서 랜덤 셔플
    questions.sort(() => Math.random() - 0.5);

    // 2. 풀 문항 수 읽어오기 (하단 통합 input에서)
    const inputEl = document.getElementById('global-type-count');
    if (inputEl && inputEl.value) {
        const count = parseInt(inputEl.value.trim(), 10);
        if (!isNaN(count) && count > 0 && count < questions.length) {
            questions = questions.slice(0, count);
        }
    }

    launchQuiz(questions, `📂 ${TYPE_LABEL[type] || type} 랜덤 모의고사 (${questions.length}제)`);
}

async function startSessionQuiz(sessionId) {
    const res = await fetch(`http://localhost:8000/api/questions/${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    launchQuiz(data.questions, `📅 ${data.session || sessionId}`);
}

function launchQuiz(questions, title) {
    if (!questions || questions.length === 0) {
        alert('문제가 없습니다. 동기화를 먼저 해주세요.');
        return;
    }
    state.userAnswers = new Array(questions.length).fill('');
    
    state.questions = questions;
    state.index = 0;
    state.submitting = false;
    state.currentSessionId = Date.now().toString();
    document.getElementById('quiz-title').textContent = title;
    
    // 패널 기본 상태를 닫힘으로 설정
    const sidePanel = document.getElementById('quiz-side-panel');
    const memoPanel = document.getElementById('quiz-memo-panel');
    const btnAi = document.getElementById('btn-toggle-ai');
    const btnMemo = document.getElementById('btn-toggle-memo');
    
    if (sidePanel) sidePanel.classList.add('hidden');
    if (memoPanel) memoPanel.classList.add('hidden');
    if (btnAi) btnAi.classList.remove('active');
    if (btnMemo) btnMemo.classList.remove('active');
    
    const memo = document.getElementById('memo-pad');
    if (memo) memo.value = '';

    switchView('quiz-view');
    renderQuestion();
    startTimer();
}

// ─── Render Question ──────────────────────────────────────
function renderQuestion() {
    const q = state.questions[state.index];
    if (!q) return;

    // Meta badges
    document.getElementById('q-number').textContent = `Q${state.index + 1}`;
    document.getElementById('q-type').textContent = TYPE_LABEL[q.type] || q.type;
    document.getElementById('q-points').textContent = `${q.points ?? TYPE_POINTS[q.type] ?? 0}점`;
    document.getElementById('q-text').textContent = q.question;

    // Progress
    const pct = ((state.index + 1) / state.questions.length) * 100;
    document.getElementById('quiz-progress').style.width = pct + '%';

    // Inputs
    const container = document.getElementById('inputs-container');
    container.innerHTML = '';

    // Buttons & Feedback
    document.getElementById('prev-btn').classList.toggle('hidden', state.index === 0);
    document.getElementById('feedback-area').classList.add('hidden');
    
    const sidePanel = document.getElementById('quiz-side-panel');
    const layoutContainer = document.getElementById('quiz-layout-container');
    const expContainer = document.getElementById('explanation-container');
    const chatContainer = document.getElementById('chat-container');
    
    // Reset explanation panel for new question - show button at top
    if (expContainer) expContainer.innerHTML = `
        <div style="padding: 1.5rem;">
            <button onclick="requestExplanation(${state.index})" id="explain-btn"
                style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.4); padding: 0.75rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.95rem; width: 100%; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-weight: 700;"
                onmouseover="this.style.background='rgba(59,130,246,0.28)'" onmouseout="this.style.background='rgba(59,130,246,0.15)'">
                📖 상세 해설 열기 <span style="font-size:0.78rem; opacity:0.6; font-weight:400;">(Ctrl+Alt+T)</span>
            </button>
        </div>
    `;
    
    state.submitting = false;
    const nextBtn = document.getElementById('submit-btn');

    if (state.quizMode === 'study') {
        container.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 1.5rem; margin-top: 1rem;">
                <strong style="color: var(--primary); display: block; margin-bottom: 0.8rem; font-size: 1.1rem;">💡 정답 (학습 모드)</strong>
                <span style="color: #fff; line-height: 1.6; white-space: pre-wrap;">${q.answer}</span>
            </div>
        `;
        nextBtn.textContent = '다음 문제 → (Ctrl+Enter)';
        nextBtn.style.background = '';
    } else {
        const matchText1 = q.question.match(/\(\s*[A-Za-z가-힣ㄱ-ㅎ]\s*\)/g) || [];
        const matchText2 = q.question.match(/[①②③④⑤⑥⑦⑧⑨⑩]/g) || [];
        const blanks = [...new Set([...matchText1, ...matchText2].map(m => m.replace(/[\(\)\s]/g, '')))];

        if (blanks.length > 0) {
            blanks.forEach(label => {
                const row = document.createElement('div');
                row.className = 'input-row';
                row.innerHTML = `
                    <span class="input-label">(${label})</span>
                    <input class="ans-input" type="text" data-label="${label}" placeholder="답안 입력...">
                `;
                container.appendChild(row);
            });
        } else {
            container.innerHTML = `<textarea class="textarea-ans" placeholder="답안을 입력하세요..."></textarea>`;
        }
        
        if (state.bulkScoring) {
            if (state.index === state.questions.length - 1) {
                nextBtn.textContent = '제출 및 채점 🚀 (Ctrl+Enter)';
                nextBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            } else {
                nextBtn.textContent = '다음 문제 → (Ctrl+Enter)';
                nextBtn.style.background = '';
            }
        } else {
            nextBtn.textContent = '제출 (Ctrl+Enter)';
            nextBtn.style.background = '';
        }

        setTimeout(() => {
            const f = container.querySelector('input, textarea');
            if (f) f.focus();
        }, 80);
    }
}

// ─── Submit ───────────────────────────────────────────────
async function submitAnswer() {
    if (state.submitting) return;

    if (state.quizMode === 'study') {
        nextQuestion();
        return;
    }

    const q = state.questions[state.index];
    const inputs = document.querySelectorAll('.ans-input');
    const textarea = document.querySelector('.textarea-ans');

    let userAnswer;
    if (inputs.length > 0) {
        const values = Array.from(inputs).map(i => i.value.trim());
        if (values.every(v => v === '')) {
            userAnswer = '미입력';
        } else {
            userAnswer = Array.from(inputs).map(i => `(${i.dataset.label}) ${i.value}`).join(' / ');
        }
    } else if (textarea) {
        userAnswer = textarea.value;
    }

    if (!userAnswer?.trim() || userAnswer === '미입력') {
        userAnswer = '미입력';
    }

    if (state.bulkScoring) {
        state.userAnswers[state.index] = userAnswer;
        if (state.index === state.questions.length - 1) {
            submitBulkAnswers();
        } else {
            nextQuestion();
        }
        return;
    }

    state.submitting = true;
    const fb = document.getElementById('feedback-area');
    fb.innerHTML = '<span style="color:var(--primary)">채점 중... ⏳</span>';
    fb.classList.remove('hidden');

    try {
        const result = await geminiScore(
            q.question, q.answer, userAnswer,
            q.points ?? TYPE_POINTS[q.type] ?? 0
        );

        // Save to sessions
        const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
        let session = history.find(h => h.id === state.currentSessionId);
        if (!session) {
            session = {
                id: state.currentSessionId,
                title: document.getElementById('quiz-title').textContent,
                date: new Date().toISOString(),
                totalScore: 0,
                maxScore: 0,
                details: []
            };
            history.push(session);
        }
        
        const pts = q.points ?? TYPE_POINTS[q.type] ?? 0;
        session.details.push({
            question: q.question,
            correct_answer: q.answer,
            user_answer: userAnswer,
            score: result.score,
            points: pts,
            is_correct: result.is_correct,
            feedback: result.feedback
        });
        
        session.totalScore += result.score;
        session.maxScore += pts;
        session.pct = session.maxScore > 0 ? Math.round((session.totalScore / session.maxScore) * 100) : 0;
        
        localStorage.setItem('quiz_sessions', JSON.stringify(history));

        fb.innerHTML = `
            <div style="border-left: 4px solid ${result.is_correct ? 'var(--primary)' : '#f87171'}; padding-left: 1rem;">
                <strong>${result.is_correct ? '✅ 정답' : '⚠️ 오답/부분점수'} (${result.score}점)</strong>
                <div style="margin-top:0.8rem; background: rgba(0,0,0,0.2); padding: 0.8rem; border-radius: 6px;">
                    <strong style="color:var(--primary);">모범 답안:</strong> 
                    <span style="color:#fff;">${q.answer}</span>
                </div>
                <p style="margin-top:0.8rem; color:var(--muted); white-space:pre-wrap">${result.feedback}</p>
                <button class="btn-next" onclick="nextQuestion()" style="margin-top:1.5rem; width:100%">다음 문제 → (Ctrl+Enter)</button>
            </div>
        `;
    } catch (err) {
        fb.innerHTML = `<span style="color:#f87171">오류: ${err.message}</span>`;
        state.submitting = false;
    }
}

async function submitBulkAnswers() {
    clearInterval(state.timerInt);
    switchView('bulk-result-view');
    const container = document.getElementById('bulk-result-container');
    container.innerHTML = '<div style="text-align:center; padding: 4rem; font-size: 1.5rem; color: var(--primary);">채점 중입니다... 잠시만 기다려주세요 🚀</div>';
    
    try {
        const results = [];
        const total = state.questions.length;
        
        for (let i = 0; i < total; i++) {
            const q = state.questions[i];
            container.innerHTML = `
                <div style="text-align:center; padding: 4rem;">
                    <div style="font-size: 1.5rem; color: var(--primary); margin-bottom: 1rem;">
                        채점 중... (${i + 1} / ${total})
                    </div>
                    <div style="height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; max-width: 300px; margin: 0 auto;">
                        <div style="height: 100%; width: ${Math.round((i/total)*100)}%; background: linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius: 3px; transition: width 0.3s;"></div>
                    </div>
                </div>
            `;
            const res = await geminiScore(
                q.question, q.answer, state.userAnswers[i],
                q.points ?? TYPE_POINTS[q.type] ?? 0
            );
            results.push(res);
            // 연속 요청 방지 딥 (무료티어 15 RPM 기준 1요청당 4초 필요)
            if (i < total - 1) await new Promise(r => setTimeout(r, 4200));
        }
        let session = {
            id: state.currentSessionId,
            title: document.getElementById('quiz-title').textContent,
            date: new Date().toISOString(),
            totalScore: 0,
            maxScore: 0,
            details: []
        };

        let html = '';
        results.forEach((res, i) => {
            const q = state.questions[i];
            const pts = q.points ?? TYPE_POINTS[q.type] ?? 0;
            
            session.totalScore += res.score;
            session.maxScore += pts;
            session.details.push({
                question: q.question,
                correct_answer: q.answer,
                user_answer: state.userAnswers[i],
                score: res.score,
                points: pts,
                is_correct: res.is_correct,
                feedback: res.feedback
            });
        });
            
        session.pct = session.maxScore > 0 ? Math.round((session.totalScore / session.maxScore) * 100) : 0;
        
        // Save to sessions
        const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
        history.push(session);
        localStorage.setItem('quiz_sessions', JSON.stringify(history));
        
        showSessionResult();
        
    } catch (e) {
        container.innerHTML = `<div style="color:#f87171; padding: 2rem;">오류: ${e.message}</div>`;
    }
}

function showSessionResult() {
    clearInterval(state.timerInt);
    
    const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
    const session = history.find(h => h.id === state.currentSessionId);
    
    if (!session || !session.details || session.details.length === 0) {
        alert('저장된 결과가 없습니다.');
        switchView('dashboard');
        return;
    }
    
    switchView('bulk-result-view');
    const container = document.getElementById('bulk-result-container');
    
    let html = '';
    session.details.forEach((d, i) => {
        html += `
            <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid ${d.is_correct ? 'var(--primary)' : '#f87171'}">
                <div style="display:flex; justify-content:space-between; margin-bottom: 1rem;">
                    <strong style="font-size: 1.2rem;">Q${i+1}.</strong>
                    <span style="font-size: 1.1rem; font-weight: 800; color: ${d.is_correct ? 'var(--primary)' : '#f87171'}">${d.score} / ${d.points}점</span>
                </div>
                <p style="color: #cbd5e1; margin-bottom: 1rem; line-height: 1.5;">${d.question}</p>
                <div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                    <strong style="color: var(--muted); display: block; margin-bottom: 0.5rem;">내 답안:</strong>
                    <span style="color: #fff;">${d.user_answer}</span>
                    <div style="margin-top: 0.8rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.8rem;">
                        <strong style="color: var(--primary); display: block; margin-bottom: 0.5rem;">모범 답안:</strong>
                        <span style="color: #fff;">${d.correct_answer}</span>
                    </div>
                </div>
                <div>
                    <strong style="color: var(--muted); display: block; margin-bottom: 0.5rem;">AI 피드백:</strong>
                    <span style="color: #f8fafc; line-height: 1.5; white-space: pre-wrap;">${d.feedback}</span>
                </div>
            </div>
        `;
    });
    
    document.getElementById('final-score').textContent = `총점: ${session.totalScore} / ${session.maxScore}점`;
    container.innerHTML = html;
}

function nextQuestion() {
    state.index++;
    if (state.index < state.questions.length) {
        renderQuestion();
    } else {
        alert('🎉 모든 문제를 완료했습니다!\n결과 화면으로 이동합니다.');
        showSessionResult();
    }
}

// ─── Explanation & Chat ───────────────────────────────────
async function requestExplanation(index) {
    const q = state.questions[index];
    const sidePanel = document.getElementById('quiz-side-panel');
    const layoutContainer = document.getElementById('quiz-layout-container');
    const expContainer = document.getElementById('explanation-container');
    const chatMessages = document.getElementById('chat-messages');
    
    if (!sidePanel || !expContainer) return;
    
    // Reset Chat
    chatMessages.innerHTML = '<div class="chat-message ai-message">이 문제에 대해 궁금한 점을 질문하세요.</div>';
    
    // (자동으로 패널을 열지 않고 백그라운드에서 내용만 업데이트합니다)
    
    // 커스터마이즈 평 헤더 HTML
    const headerHTML = `
        <div id="exp-header" onclick="toggleExplanation()" style="
            display: flex; justify-content: space-between; align-items: center;
            cursor: pointer; padding: 0.2rem 0; margin-bottom: 0.8rem;
            user-select: none;
        ">
            <strong style="color: #60a5fa; font-size: 1.05rem;">📖 상세 해설</strong>
            <span id="exp-toggle-icon" style="color: #60a5fa; font-size: 0.85rem; opacity: 0.7;">&#9650; 접기</span>
        </div>
        <div id="exp-body">
    `;

    if (q.explanation) {
        expContainer.innerHTML = headerHTML +
            `<span style="color: #f8fafc; line-height: 1.6; white-space: pre-wrap;">${q.explanation}</span>` +
            `</div>`;
        return;
    }
    
    expContainer.innerHTML = headerHTML +
        `<span id="exp-stream" style="color: #f8fafc; line-height: 1.6; white-space: pre-wrap; display:block;"></span>` +
        `</div>`;
    const expStream = document.getElementById('exp-stream');
    
    try {
        let accumulated = '';
        await geminiExplainStream(
            q.question, q.answer,
            (chunk) => {
                accumulated += chunk;
                expStream.textContent = accumulated;
            },
            (status) => {
                expStream.textContent = status;
            }
        );
        q.explanation = accumulated;
    } catch (e) {
        expContainer.innerHTML = buildApiKeyErrorHTML(e.message, `requestExplanation(${index})`);
    }
}

function toggleExplanation() {
    const body = document.getElementById('exp-body');
    const icon = document.getElementById('exp-toggle-icon');
    if (!body || !icon) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    icon.innerHTML = isOpen ? '&#9660; 펼치기' : '&#9650; 접기';
}

function togglePanel(type) {
    const sidePanel = document.getElementById('quiz-side-panel');
    const memoPanel = document.getElementById('quiz-memo-panel');
    const btnAi = document.getElementById('btn-toggle-ai');
    const btnMemo = document.getElementById('btn-toggle-memo');

    if (type === 'ai' && sidePanel && btnAi) {
        const isHidden = sidePanel.classList.contains('hidden');
        if (isHidden) {
            sidePanel.classList.remove('hidden');
            btnAi.classList.add('active');
        } else {
            sidePanel.classList.add('hidden');
            btnAi.classList.remove('active');
        }
    } else if (type === 'memo' && memoPanel && btnMemo) {
        const isHidden = memoPanel.classList.contains('hidden');
        if (isHidden) {
            memoPanel.classList.remove('hidden');
            btnMemo.classList.add('active');
        } else {
            memoPanel.classList.add('hidden');
            btnMemo.classList.remove('active');
        }
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    
    const q = state.questions[state.index];
    const messagesContainer = document.getElementById('chat-messages');
    
    // 사용자 메시지 추가
    messagesContainer.innerHTML += `<div class="chat-message user-message">${msg}</div>`;
    input.value = '';
    
    // AI 스트리밍 버블 생성
    const aiLoadingId = 'msg-' + Date.now();
    messagesContainer.innerHTML += `<div id="${aiLoadingId}" class="chat-message ai-message"></div>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    const aiMsgDiv = document.getElementById(aiLoadingId);
    
    try {
        let accumulated = '';
        await geminiChatStream(
            q.question, q.answer, q.explanation || '', msg,
            (chunk) => {
                accumulated += chunk;
                aiMsgDiv.textContent = accumulated;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            },
            (status) => {
                aiMsgDiv.textContent = status; // 카운트다운 표시
                aiMsgDiv.style.color = '#f59e0b';
            }
        );
        aiMsgDiv.style.color = ''; // 정상 색상 복원
    } catch (e) {
        aiMsgDiv.textContent = '';
        aiMsgDiv.innerHTML = buildApiKeyErrorHTML(e.message, 'sendChatMessage()');
        aiMsgDiv.style.color = '';
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ─── Timer ────────────────────────────────────────────────
function startTimer() {
    state.timer = 0;
    clearInterval(state.timerInt);
    document.getElementById('timer').textContent = '00:00';
    state.timerInt = setInterval(() => {
        state.timer++;
        const m = String(Math.floor(state.timer / 60)).padStart(2, '0');
        const s = String(state.timer % 60).padStart(2, '0');
        document.getElementById('timer').textContent = `${m}:${s}`;
    }, 1000);
}

// ─── Events ───────────────────────────────────────────────
// Event binding for Chat
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    if(chatInput) {
        chatInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }
    if(chatSendBtn) {
        chatSendBtn.addEventListener('click', sendChatMessage);
    }
});

document.getElementById('submit-btn').addEventListener('click', submitAnswer);
document.getElementById('prev-btn').addEventListener('click', () => {
    if (state.index > 0) { state.index--; renderQuestion(); }
});
document.getElementById('exit-quiz').addEventListener('click', () => {
    if (confirm('퀴즈를 종료하시겠습니까?')) {
        clearInterval(state.timerInt);
        switchView('dashboard');
        renderDashboard();
    }
});
window.addEventListener('keydown', e => {
    if (state.view === 'quiz-view' && e.ctrlKey) {
        // Ctrl + Alt + T : 상세 해설 불러오기
        if (e.altKey && (e.key === 't' || e.key === 'T')) {
            e.preventDefault();
            requestExplanation(state.index);
            return;
        }

        if (e.key === 'Enter') {
            // 제출 / 다음 문제 단축키 (Ctrl + Enter)
            e.preventDefault();
            const fb = document.getElementById('feedback-area');
            if (!fb.classList.contains('hidden') && !fb.textContent.includes('채점 중')) {
                nextQuestion();
            } else {
                submitAnswer();
            }
        } else if (e.key === '[') {
            // 이전 문제 단축키 (Ctrl + [)
            e.preventDefault();
            if (state.index > 0) {
                state.index--;
                renderQuestion();
            }
        } else if (e.key === ']') {
            // 다음 문제 단축키 (Ctrl + ])
            e.preventDefault();
            if (!state.submitting) {
                nextQuestion();
            }
        }
    }
});

window.setMode = function(mode) {
    state.quizMode = mode;
    state.bulkScoring = (mode === 'bulk');
    document.getElementById('btn-immediate').classList.toggle('active', mode === 'immediate');
    document.getElementById('btn-bulk').classList.toggle('active', mode === 'bulk');
    const btnStudy = document.getElementById('btn-study');
    if (btnStudy) btnStudy.classList.toggle('active', mode === 'study');
};

// Expose to inline onclick
window.startRandomQuiz = startRandomQuiz;
window.toggleTypeSelection = toggleTypeSelection;
window.toggleSessionSelection = toggleSessionSelection;
window.startTypeQuiz = startTypeQuiz;
window.startSessionQuiz = startSessionQuiz;
window.nextQuestion = nextQuestion;
window.requestExplanation = requestExplanation;
window.toggleExplanation = toggleExplanation;
window.togglePanel = togglePanel;
window.saveQuickApiKey = saveQuickApiKey;
window.renderStats = renderStats;
window.renderDashboard = renderDashboard;

async function syncData() {
    const btn = document.getElementById('sync-btn');
    if (!btn) return;

    const origText = btn.innerHTML;
    btn.innerHTML = '🔄 데이터 확인 중...';
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.7';

    setTimeout(() => {
        alert('모든 기출 데이터가 최신 상태입니다.\n(정적 데이터 모드)');
        btn.innerHTML = origText;
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
        renderDashboard();
    }, 800);
}

window.syncData = syncData;


// ─── Init ─────────────────────────────────────────────────
// ─── Settings ─────────────────────────────────────────────
function saveSettings() {
    const keyInput = document.getElementById('setting-api-key');
    const modelInput = document.getElementById('setting-model');
    const key = keyInput?.value?.trim();
    const model = modelInput?.value;
    if (key) localStorage.setItem('gemini_api_key', key);
    else localStorage.removeItem('gemini_api_key');
    if (model) localStorage.setItem('gemini_model', model);

    const btn = document.querySelector('button[onclick="saveSettings()"]');
    if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✅ 저장되었습니다';
        setTimeout(() => btn.textContent = orig, 2000);
    }
}

function loadSettings() {
    const key = localStorage.getItem('gemini_api_key');
    const model = localStorage.getItem('gemini_model');
    const keyInput = document.getElementById('setting-api-key');
    const modelInput = document.getElementById('setting-model');
    if (key && keyInput) keyInput.value = key;
    if (model && modelInput) modelInput.value = model;
}

window.saveSettings = saveSettings;

// ─── Init ─────────────────────────────────────────────────
renderDashboard();
loadSettings();

// Event Listeners
document.getElementById('sync-btn')?.addEventListener('click', syncData);
document.querySelectorAll('.nav-links li').forEach(li => {
    li.addEventListener('click', () => {
        const view = li.getAttribute('data-view');
        if (view) {
            document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            switchView(view);
        }
    });
});