const API_URL = ''; // No backend needed for static version (v1.0.1)
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
    questionStates: [], // { scored: boolean, feedback: string, isCorrect: boolean, score: number, explanation: string, chat: [] }
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
    if (id === 'admin-panel') {
        if (!loggedInUser || !loggedInUser.isAdmin) {
            alert('관리자 권한이 필요합니다.');
            // Guard against infinite loop if dashboard also fails (which shouldn't happen)
            if (id !== 'dashboard') {
                switchView('dashboard');
            }
            return;
        }
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-links li').forEach(li =>
        li.classList.toggle('active', li.dataset.view === id));
    const sidebar = document.getElementById('sidebar');
    if (id === 'quiz-view') sidebar.classList.add('hidden');
    else sidebar.classList.remove('hidden');
    state.view = id;

    if (id === 'dashboard') {
        renderDashboard();
    } else if (id === 'stats') {
        renderStats();
    } else if (id === 'admin-panel') {
        renderAdminPanel();
    }
}

// Navigation event listeners moved to the end of the file to avoid duplicates and errors

// ─── Sync ─────────────────────────────────────────────────
// Sync button listener moved to the end of the file

// ─── Dashboard ────────────────────────────────────────────
async function renderDashboard() {
    // Fetch parsed sessions

    // Fetch parsed sessions
    const parsedDiv = document.getElementById('parsed-sessions');
    if (!parsedDiv) return;

    // Feature and Shortcut Data for Exam Trainer
    const examFeatures = [
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`, title: '실전 모드', desc: '실제 시험처럼 모든 문제를 푼 뒤 한꺼번에 AI 채점을 받습니다.', color: '#0ea5e9' },
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`, title: '즉시 채점', desc: '문제를 풀 때마다 실시간으로 AI의 정밀 채점과 피드백을 확인합니다.', color: '#10b981' },
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`, title: '학습 모드', desc: '정답을 미리 보며 해설과 함께 개념을 익히는 학습 중심 모드입니다.', color: '#f59e0b' },
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`, title: 'AI 튜터', desc: '모르는 부분은 언제든 AI에게 질문하고 상세한 해설을 스트리밍으로 받으세요.', color: '#8b5cf6' }
    ];

    const shortcuts = [
        { key: 'Ctrl + Enter', desc: '답안 제출 / 다음 문제' },
        { key: 'Ctrl + [', desc: '이전 문제' },
        { key: 'Ctrl + ]', desc: '다음 문제' },
        { key: 'Ctrl + Alt + T', desc: 'AI 상세 해설 열기' }
    ];

    try {
        const res = await fetch('./data/sessions.json');
        const sessions = await res.json();

        let sessionContent = '';
        if (sessions.length === 0) {
            sessionContent = `
                <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:2rem; text-align:center;">
                    <span style="font-size:2rem;">📂</span>
                    <p style="color:var(--muted); margin-top:0.8rem;">파싱된 기출 자료가 없습니다. <strong style="color:var(--primary); cursor:pointer;" onclick="document.getElementById('sync-btn').click()">데이터 동기화</strong>를 먼저 해주세요.</p>
                </div>
            `;
        } else {
            const totalQuestions = sessions.reduce((s, sess) => s + sess.count, 0);
            const sessionCards = sessions.map(s => `
                <div class="dashboard-session-card" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
                    <div style="display:flex; align-items:center; gap:1.2rem;">
                        <span style="font-size:1.5rem;">📄</span>
                        <div style="display:flex; flex-direction:column; gap:0.2rem;">
                            <span style="font-weight:700; font-size:1.05rem;">${s.name}</span>
                            <span style="font-size:0.85rem; color:var(--muted);">ID: ${s.id}</span>
                        </div>
                    </div>
                    <span class="session-badge-count" style="background:rgba(56,189,248,0.1); color:var(--primary); padding:0.4rem 0.8rem; border-radius:20px; font-weight:800; font-size:0.9rem;">${s.count}문항</span>
                </div>
            `).join('');

            sessionContent = `
                <div class="dashboard-session-container">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2rem;">
                        <div style="display:flex; align-items:center; gap:0.8rem;">
                            <span style="font-size:1.5rem;">📚</span>
                            <h3 style="font-weight:800; font-size:1.3rem; margin:0;">파싱된 기출 자료</h3>
                        </div>
                        <div style="display:flex; gap:1rem; align-items:center;">
                            <span style="color:var(--muted); font-size:0.9rem;">${sessions.length}개 회차</span>
                            <span style="background:linear-gradient(135deg, #0ea5e9, #38bdf8); color:#fff; padding:0.4rem 1rem; border-radius:8px; font-weight:800; font-size:0.9rem; box-shadow: 0 4px 12px rgba(56, 189, 248, 0.2);">총 ${totalQuestions}문항</span>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        ${sessionCards}
                    </div>
                </div>
            `;
        }

        const featureCards = examFeatures.map(f => `
            <div class="dashboard-feature-card" style="background: linear-gradient(145deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)); border: 1px solid rgba(255,255,255,0.06); border-radius: 18px; padding: 1.8rem; display: flex; flex-direction: column; gap: 1rem; transition: transform 0.2s, border-color 0.2s;" onmouseover="this.style.transform='translateY(-4px)'; this.style.borderColor='${f.color}44'" onmouseout="this.style.transform='none'; this.style.borderColor='rgba(255,255,255,0.06)'">
                <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">${f.icon}</div>
                <div style="font-weight: 900; font-size: 1.2rem; color: #fff; letter-spacing: -0.02em;">${f.title}</div>
                <div style="font-size: 0.92rem; color: #94a3b8; line-height: 1.6; word-break: keep-all;">${f.desc}</div>
                <div style="margin-top: auto; height: 3px; width: 30px; background: ${f.color}; border-radius: 10px; opacity: 0.6;"></div>
            </div>
        `).join('');

        const shortcutRows = shortcuts.map(s => `
            <div style="display: flex; align-items: center; gap: 1rem; padding: 1rem; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid rgba(255,255,255,0.03);">
                <kbd style="background: #1e293b; color: var(--primary); padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.85rem; font-family: 'Inter', monospace; border: 1px solid rgba(56, 189, 248, 0.2); font-weight: 700; white-space: nowrap; box-shadow: 0 2px 0 rgba(0,0,0,0.3);">${s.key}</kbd>
                <span style="color: #cbd5e1; font-size: 0.95rem; font-weight: 500;">${s.desc}</span>
            </div>
        `).join('');

        const hasApiKey = !!localStorage.getItem('gemini_api_key');
        let warningBanner = '';
        if (!hasApiKey) {
            warningBanner = `
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 16px; padding: 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; animation: fadeIn 0.5s ease-out; margin-bottom: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 1rem; text-align: left;">
                        <span style="font-size: 2rem;">🔑</span>
                        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                            <strong style="color: #f59e0b; font-size: 1.1rem;">AI API Key가 설정되지 않았습니다.</strong>
                            <span style="color: #cbd5e1; font-size: 0.9rem;">학습 채점 및 AI 해설/AI 튜터 기능을 사용하려면 본인의 Gemini API 키를 등록해야 합니다.</span>
                        </div>
                    </div>
                    <button onclick="switchView('settings')" style="background: #f59e0b; color: #0f172a; font-weight: 800; font-size: 0.95rem; border: none; border-radius: 8px; padding: 0.7rem 1.2rem; cursor: pointer; transition: 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                        설정으로 이동
                    </button>
                </div>
            `;
        }

        parsedDiv.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2.5rem; animation: fadeIn 0.5s ease-out;">
                ${warningBanner}
                <!-- Top Row: Features (Left) + Shortcuts (Right) -->
                <div class="dashboard-top-row">
                    
                    <!-- Left: Features -->
                    <div>
                        <h3 style="font-weight: 900; font-size: 1.3rem; margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.6rem; color: #fff;">
                            <span style="color: var(--primary);">✨</span> 핵심 기능
                        </h3>
                        <div class="dashboard-features-grid">
                            ${featureCards}
                        </div>
                    </div>

                    <!-- Right: Shortcuts -->
                    <div>
                        <h3 style="font-weight: 900; font-size: 1.3rem; margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.6rem; color: #fff;">
                            <span style="font-size: 1.4rem;">⌨️</span> 단축키 가이드
                        </h3>
                        <div class="dashboard-shortcuts-container">
                            ${shortcutRows}
                        </div>
                    </div>
                </div>

                <!-- Bottom: Session Data -->
                <div id="parsed-data-section">
                    ${sessionContent}
                </div>

                <style>
                    @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(10px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    /* 반응형 대응 */
                    @media (max-width: 1100px) {
                        div[style*="grid-template-columns: 1.2fr 0.8fr"] {
                            grid-template-columns: 1fr !important;
                        }
                    }
                </style>
            </div>
        `;

    } catch (e) {


        console.error('RenderDashboard Error:', e);
        parsedDiv.innerHTML = `
            <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:2rem; text-align:center; color:var(--muted);">
                데이터를 불러오지 못했습니다. (Error: ${e.message})<br>
                경로: ./data/sessions.json
            </div>
        `;
    }
}

function renderStats() {
    const container = document.getElementById('stats-detail');
    if (!container) return;

    try {
        const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');

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
            <div class="stats-summary-grid">
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
                <div class="scrollable-chart-container">
                    <div class="chart-scroll-wrapper">
                        ${chartBars}
                    </div>
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
            <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.05); border-radius:16px; overflow:hidden; overflow-x:auto; margin-bottom:2rem;">
                <h3 style="padding:1.5rem 2rem 1rem; font-weight:800; font-size:1.2rem;">📋 풀이 기록 (최근 20건)</h3>
                <table style="width:100%; min-width:550px; border-collapse:collapse;">
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
                <button onclick="clearLearningHistory()" style="background:rgba(248,113,113,0.1); color:#f87171; border:1px solid rgba(248,113,113,0.3); padding:0.8rem 2rem; border-radius:8px; cursor:pointer; font-weight:700; transition:0.2s;" onmouseover="this.style.background='rgba(248,113,113,0.2)'" onmouseout="this.style.background='rgba(248,113,113,0.1)'">
                    🗑️ 학습 기록 초기화
                </button>
            </div>
        `;
    } catch (e) {
        console.error('RenderStats Error:', e);
        container.innerHTML = `
            <div style="background:rgba(248,113,113,0.1); border:1px solid rgba(248,113,113,0.3); border-radius:16px; padding:2rem; text-align:center; color:#f87171;">
                <strong>⚠️ 학습 통계를 불러오는 중 오류가 발생했습니다.</strong><br>
                <span style="font-size:0.9rem; color:var(--muted);">${e.message}</span>
                <button onclick="resetStatsAndRetry()" style="display:block; margin: 1rem auto 0; background: rgba(248,113,113,0.2); color:#f87171; border: 1px solid rgba(248,113,113,0.4); padding:0.5rem 1rem; border-radius:6px; cursor:pointer; font-size:0.85rem;">
                    기록 초기화 후 재시도
                </button>
            </div>
        `;
    }
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
            <div class="type-action-card">
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

function toggleRandomSelection() {
    const sub = document.getElementById('sub-list');
    if (state.subMode === 'random') {
        sub.classList.add('hidden');
        state.subMode = null;
        return;
    }
    state.subMode = 'random';
    sub.style.display = 'block'; // Block display for custom layouts
    sub.classList.remove('hidden');
    sub.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">
            <div class="item-row" style="cursor: pointer; padding: 1.8rem;" onclick="startTotalRandomQuiz()">
                <span class="icon" style="font-size: 2.2rem; margin-right: 1rem;">🎲</span>
                <div class="text">
                    <strong>전체 랜덤 풀기</strong>
                    <span>전체 문항 중 무작위 30문항 풀기</span>
                </div>
            </div>
            <div class="item-row" style="cursor: pointer; padding: 1.8rem;" onclick="startMockExamQuiz()">
                <span class="icon" style="font-size: 2.2rem; margin-right: 1rem;">📋</span>
                <div class="text">
                    <strong>실전 모의고사 풀기</strong>
                    <span>단답 12, 서술 4, 실무 2 (총 100점 만점)</span>
                </div>
            </div>
        </div>
    `;
}
window.toggleRandomSelection = toggleRandomSelection;

async function startTotalRandomQuiz() {
    try {
        const res = await fetch('./data/questions_all.json');
        const data = await res.json();
        const shuffled = [...data.questions].sort(() => Math.random() - 0.5);
        
        // Select 30 questions for a reasonable random test session
        const count = Math.min(shuffled.length, 30);
        const selected = shuffled.slice(0, count);
        
        state.isMockExam = false;
        launchQuiz(selected, `🎲 전체 랜덤 풀기 (${count}문항)`);
    } catch (e) {
        console.error('Failed to create random quiz:', e);
        alert('랜덤 문제를 불러오는 중 오류가 발생했습니다.');
    }
}
window.startTotalRandomQuiz = startTotalRandomQuiz;

async function startMockExamQuiz() {
    try {
        const res = await fetch('./data/questions_all.json');
        const data = await res.json();
        const allQuestions = data.questions;
        
        // Group by type
        const shortList = allQuestions.filter(q => q.type === 'short');
        const essayList = allQuestions.filter(q => q.type === 'essay');
        const practicalList = allQuestions.filter(q => q.type === 'practical');
        
        if (shortList.length < 12 || essayList.length < 4 || practicalList.length < 2) {
            alert('모의고사를 생성하기 위한 충분한 문제가 없습니다. 문항 데이터를 확인해 주세요.');
            return;
        }
        
        // Randomly select items
        const selectedShort = [...shortList].sort(() => Math.random() - 0.5).slice(0, 12);
        const selectedEssay = [...essayList].sort(() => Math.random() - 0.5).slice(0, 4);
        const selectedPractical = [...practicalList].sort(() => Math.random() - 0.5).slice(0, 2);
        
        // Override points according to mock exam specification
        selectedShort.forEach(q => q.points = 3);
        selectedEssay.forEach(q => q.points = 12);
        selectedPractical.forEach(q => q.points = 16);
        
        // Merge into final array
        const mockQuestions = [...selectedShort, ...selectedEssay, ...selectedPractical];
        
        state.isMockExam = true;
        launchQuiz(mockQuestions, '📋 실전 모의고사 (100점 만점)');
    } catch (e) {
        console.error('Failed to create mock exam:', e);
        alert('모의고사를 생성하는 중 오류가 발생했습니다.');
    }
}
window.startMockExamQuiz = startMockExamQuiz;

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
        const res = await fetch('./data/sessions.json');
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
    const res = await fetch('./data/questions_all.json');
    const data = await res.json();
    const shuffled = [...data.questions].sort(() => Math.random() - 0.5);
    launchQuiz(shuffled, '🎲 랜덤 풀기');
}

async function startTypeQuiz(type) {
    const res = await fetch(`./data/questions_type_${type}.json`);
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
    const res = await fetch(`./data/questions_${encodeURIComponent(sessionId)}.json`);
    const data = await res.json();
    launchQuiz(data.questions, `📅 ${data.session || sessionId}`);
}

function launchQuiz(questions, title) {
    if (!questions || questions.length === 0) {
        alert('문제가 없습니다. 동기화를 먼저 해주세요.');
        return;
    }
    state.userAnswers = new Array(questions.length).fill('');
    state.questionStates = questions.map(() => ({
        scored: false,
        feedback: '',
        isCorrect: false,
        score: 0,
        explanation: '',
        chat: []
    }));
    
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
    let questionText = q.question;
    if (state.isMockExam && q.type === 'practical') {
        questionText = `[실무형 선택 문제 - 2문항 중 택 1]\n* 안내: Q17과 Q18 중 풀이할 1문항만 선택해서 작성해 주세요. (두 문항 모두 작성하는 경우 더 높은 점수를 획득한 문항만 최종 성적에 합산됩니다.)\n\n` + q.question;
    }
    document.getElementById('q-text').textContent = questionText;

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

    // Restore previous answer if exists
    const qState = state.questionStates[state.index];
    const savedAns = state.userAnswers[state.index];

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
        let matchText1 = q.question.match(/\(\s*([A-Za-z가-힣ㄱ-ㅎ]|[0-9]+)\s*\)/g) || [];
        let matchText2 = q.question.match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g) || [];
        let blanks = [...new Set([...matchText1, ...matchText2].map(m => m.replace(/[\(\)\s]/g, '')))];

        let isCustomLabels = false;
        // If no explicit blank labels are found, check if it asks to list N items (N > 1)
        if (blanks.length === 0) {
            const numMatches = q.question.match(/(\d+)\s*(가지|개)[^.\n]*(기술|서술|쓰시오|작성|답하시오)/);
            if (numMatches) {
                const num = parseInt(numMatches[1], 10);
                if (num > 1 && num <= 10) {
                    // Try to find a parenthesized list of items that matches the count
                    let foundItems = null;
                    const parenMatches = q.question.match(/\(([^)]+)\)/g);
                    if (parenMatches) {
                        for (const pm of parenMatches) {
                            const inner = pm.slice(1, -1); // strip ( and )
                            const splitItems = inner.split(/[\/,·|;]/).map(i => i.trim()).filter(Boolean);
                            if (splitItems.length === num) {
                                foundItems = splitItems;
                                break;
                            }
                        }
                    }
                    if (foundItems) {
                        blanks = foundItems;
                        isCustomLabels = true;
                    } else {
                        blanks = Array.from({ length: num }, (_, i) => String(i + 1));
                    }
                }
            }
        }

        if (blanks.length > 0) {
            // Sort blanks in dictionary order only if they are not custom list labels (e.g. 1, 2, 3 or 가, 나, 다 or ①, ②, ③)
            if (!isCustomLabels) {
                blanks.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
            }

            blanks.forEach(label => {
                const row = document.createElement('div');
                const isDescriptive = q.type === 'essay' || q.type === 'practical';

                const currentVal = (savedAns && savedAns.includes(`(${label})`)) 
                    ? savedAns.split(`(${label})`)[1].split(' / ')[0].trim() 
                    : '';

                if (isDescriptive) {
                    row.className = 'textarea-row';
                    row.style.display = 'flex';
                    row.style.flexDirection = 'column';
                    row.style.gap = '0.5rem';
                    row.style.marginBottom = '1.5rem';
                    row.innerHTML = `
                        <span class="input-label" style="margin-bottom: 0.2rem; font-weight: 800; color: var(--primary);">(${label})</span>
                        <textarea class="ans-input textarea-ans-sub" data-label="${label}" placeholder="답안을 서술하세요..." style="width: 100%; min-height: 100px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1rem; color: #fff; font-size: 1.1rem; line-height: 1.6; outline: none; resize: vertical; font-family: inherit;" ${qState.scored ? 'disabled' : ''} 
                            oninput="saveAnswerRealtime()">${currentVal}</textarea>
                    `;
                } else {
                    row.className = 'input-row';
                    row.innerHTML = `
                        <span class="input-label">(${label})</span>
                        <input class="ans-input" type="text" data-label="${label}" placeholder="답안 입력..." value="${currentVal}" ${qState.scored ? 'disabled' : ''} 
                            oninput="saveAnswerRealtime()">
                    `;
                }
                container.appendChild(row);
            });
        } else {
            container.innerHTML = `<textarea class="textarea-ans" placeholder="답안을 입력하세요..." ${qState.scored ? 'disabled' : ''} oninput="saveAnswerRealtime()">${savedAns || ''}</textarea>`;
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
            if (qState.scored) {
                nextBtn.textContent = '다음 문제 → (Ctrl+Enter)';
                nextBtn.style.background = 'linear-gradient(135deg, #374151, #1f2937)';
            } else {
                nextBtn.textContent = '제출 (Ctrl+Enter)';
                nextBtn.style.background = '';
            }
        }

        // Restore Feedback if scored
        const fb = document.getElementById('feedback-area');
        if (qState.scored) {
            fb.innerHTML = `
                <div style="border-left: 4px solid ${qState.isCorrect ? 'var(--primary)' : '#f87171'}; padding-left: 1rem; animation: fadeIn 0.3s ease;">
                    <strong>${qState.isCorrect ? '✅ 정답' : '⚠️ 오답/부분점수'} (${qState.score}점)</strong>
                    <div style="margin-top:0.8rem; background: rgba(0,0,0,0.2); padding: 0.8rem; border-radius: 6px;">
                        <strong style="color:var(--primary);">모범 답안:</strong> 
                        <span style="color:#fff;">${q.answer}</span>
                    </div>
                    <p style="margin-top:0.8rem; color:var(--muted); white-space:pre-wrap">${qState.feedback}</p>
                    <button class="btn-next" onclick="nextQuestion()" style="margin-top:1.5rem; width:100%">다음 문제 → (Ctrl+Enter)</button>
                </div>
            `;
            fb.classList.remove('hidden');
        } else {
            fb.classList.add('hidden');
        }

        // Restore Explanation Panel if exists
        const expContainer = document.getElementById('explanation-container');
        if (qState.explanation && expContainer) {
            const headerHTML = `
                <div id="exp-header" onclick="toggleExplanation()" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 0.2rem 0; margin-bottom: 0.8rem; user-select: none;">
                    <strong style="color: #60a5fa; font-size: 1.05rem;">📖 상세 해설</strong>
                    <span id="exp-toggle-icon" style="color: #60a5fa; font-size: 0.85rem; opacity: 0.7;">&#9650; 접기</span>
                </div>
                <div id="exp-body">
            `;
            expContainer.innerHTML = headerHTML +
                `<span style="color: #f8fafc; line-height: 1.6; white-space: pre-wrap;">${qState.explanation}</span>` +
                `</div>`;
        } else if (expContainer) {
            // Reset to default button
            expContainer.innerHTML = `
                <div style="padding: 1.5rem;">
                    <button onclick="requestExplanation(${state.index})" id="explain-btn"
                        style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.4); padding: 0.75rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.95rem; width: 100%; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-weight: 700;">
                        📖 상세 해설 열기 <span style="font-size:0.78rem; opacity:0.6; font-weight:400;">(Ctrl+Alt+T)</span>
                    </button>
                </div>
            `;
        }

        if (!qState.scored) {
            setTimeout(() => {
                const f = container.querySelector('input, textarea');
                if (f) f.focus();
            }, 80);
        }
    }
}

function saveAnswerRealtime() {
    const inputs = document.querySelectorAll('.ans-input');
    const textarea = document.querySelector('.textarea-ans');
    let userAnswer = '';
    if (inputs.length > 0) {
        userAnswer = Array.from(inputs).map(i => `(${i.dataset.label}) ${i.value}`).join(' / ');
    } else if (textarea) {
        userAnswer = textarea.value;
    }
    state.userAnswers[state.index] = userAnswer;
}
window.saveAnswerRealtime = saveAnswerRealtime;

function recalculateSessionScores(session) {
    if (state.isMockExam) {
        let coreScore = 0;
        let p1Score = 0;
        let p2Score = 0;
        
        session.details.forEach(d => {
            if (d.qIndex < 16) {
                coreScore += d.score;
            } else if (d.qIndex === 16) {
                p1Score = d.score;
            } else if (d.qIndex === 17) {
                p2Score = d.score;
            }
        });
        
        session.totalScore = coreScore + Math.max(p1Score, p2Score);
        
        const uniqueIndices = new Set(session.details.map(d => d.qIndex));
        let maxScore = 0;
        for (let idx = 0; idx < 16; idx++) {
            if (uniqueIndices.has(idx)) {
                maxScore += (idx < 12 ? 3 : 12);
            }
        }
        if (uniqueIndices.has(16) || uniqueIndices.has(17)) {
            maxScore += 16;
        }
        session.maxScore = maxScore;
    } else {
        session.totalScore = session.details.reduce((sum, d) => sum + d.score, 0);
        session.maxScore = session.details.reduce((sum, d) => sum + d.points, 0);
    }
    session.pct = session.maxScore > 0 ? Math.round((session.totalScore / session.maxScore) * 100) : 0;
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

    state.submitting = false;
    state.userAnswers[state.index] = userAnswer;
    const fb = document.getElementById('feedback-area');
    fb.classList.remove('hidden');

    const pts = q.points ?? TYPE_POINTS[q.type] ?? 0;

    // 즉시 결과 노출 (모범 답안과 다음 문제 버튼 노출 - 체감 대기시간 0초)
    fb.innerHTML = `
        <div style="border-left: 4px solid var(--muted); padding-left: 1rem; transition: border-color 0.3s;" id="local-feedback-container">
            <div id="ai-status-area" style="margin-bottom: 0.8rem; font-weight: 800; color: var(--primary);">
                AI 채점 중... ⏳ <span style="font-size: 0.8rem; font-weight: normal; color: var(--muted);">(기다리지 않고 다음 문제로 바로 넘어가셔도 됩니다)</span>
            </div>
            <div style="margin-top:0.8rem; background: rgba(0,0,0,0.2); padding: 0.8rem; border-radius: 6px;">
                <strong style="color:var(--primary);">모범 답안:</strong> 
                <span style="color:#fff;">${q.answer}</span>
            </div>
            <button class="btn-next" onclick="nextQuestion()" style="margin-top:1.5rem; width:100%">다음 문제 → (Ctrl+Enter)</button>
        </div>
    `;

    // 백그라운드 비동기 AI 채점 시작
    const savedIndex = state.index;
    const savedSessionId = state.currentSessionId;
    const savedTitle = document.getElementById('quiz-title').textContent;

    geminiScore(q.question, q.answer, userAnswer, pts).then(result => {
        // 1. 문제 상태 영구 저장
        const qState = state.questionStates[savedIndex];
        if (qState) {
            qState.scored = true;
            qState.score = result.score;
            qState.isCorrect = result.is_correct;
            qState.feedback = result.feedback;
        }

        // 2. 세션 히스토리 저장
        const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
        let session = history.find(h => h.id === savedSessionId);
        if (!session) {
            session = {
                id: savedSessionId,
                title: savedTitle,
                date: new Date().toISOString(),
                totalScore: 0,
                maxScore: 0,
                details: []
            };
            history.push(session);
        }
        
        const existingDetail = session.details.find(d => d.qIndex === savedIndex);
        if (!existingDetail) {
            session.details.push({
                qIndex: savedIndex,
                question: q.question,
                correct_answer: q.answer,
                user_answer: userAnswer,
                score: result.score,
                points: pts,
                is_correct: result.is_correct,
                feedback: result.feedback
            });
        } else {
            existingDetail.score = result.score;
            existingDetail.is_correct = result.is_correct;
            existingDetail.feedback = result.feedback;
        }

        recalculateSessionScores(session);
        saveQuizSessionToStorage(session);

        // 3. 현재 보고 있는 문제가 완료된 문제라면 실시간 UI 업데이트
        if (state.index === savedIndex) {
            const container = document.getElementById('local-feedback-container');
            const aiArea = document.getElementById('ai-status-area');
            if (container && aiArea) {
                container.style.borderColor = result.is_correct ? 'var(--primary)' : '#f87171';
                aiArea.innerHTML = `
                    <strong style="color: ${result.is_correct ? 'var(--primary)' : '#f87171'}">${result.is_correct ? '✅ 정답' : '⚠️ 오답/부분점수'} (${result.score}점)</strong>
                    <p style="margin-top:0.6rem; color:var(--muted); font-weight: normal; font-size: 0.95rem; white-space:pre-wrap; line-height: 1.5;">${result.feedback}</p>
                `;
            }
        }
    }).catch(err => {
        console.error("[Background Grading] Failed for index", savedIndex, err);
        if (state.index === savedIndex) {
            const aiArea = document.getElementById('ai-status-area');
            if (aiArea) {
                aiArea.innerHTML = `<span style="color:#f87171">AI 채점 실패 (오답 보류)</span>`;
            }
        }
    });
}

async function submitBulkAnswers() {
    clearInterval(state.timerInt);
    switchView('bulk-result-view');
    const container = document.getElementById('bulk-result-container');
    container.innerHTML = '<div style="text-align:center; padding: 4rem; font-size: 1.5rem; color: var(--primary);">채점 중입니다... 잠시만 기다려주세요 🚀</div>';
    
    try {
        const results = [];
        const total = state.questions.length;
        const questionsToGrade = [];
        const resultsMap = new Map();

        for (let i = 0; i < total; i++) {
            const q = state.questions[i];
            const uAns = state.userAnswers[i];
            const pts = q.points ?? TYPE_POINTS[q.type] ?? 0;

            // Check for empty answer (Fast fail)
            if (!uAns || uAns === '미입력' || String(uAns).trim() === '') {
                resultsMap.set(i, {
                    score: 0,
                    is_correct: false,
                    feedback: "답안을 작성하지 않았습니다."
                });
            } else {
                // Check for perfect string match (Fast pass)
                const cleanU = String(uAns).replace(/\s+/g, '').toLowerCase();
                const cleanC = String(q.answer).replace(/\s+/g, '').toLowerCase();
                if (cleanU === cleanC || (cleanC.length > 2 && cleanU.includes(cleanC))) {
                    resultsMap.set(i, {
                        score: pts,
                        is_correct: true,
                        feedback: "정답과 완벽하게 일치합니다. (초고속 자동 채점)"
                    });
                } else {
                    // Need AI grading
                    questionsToGrade.push({
                        index: i,
                        question: q.question,
                        correct_answer: q.answer,
                        user_answer: uAns,
                        points: pts
                    });
                }
            }
        }

        if (questionsToGrade.length > 0) {
            container.innerHTML = `
                <div style="text-align:center; padding: 4rem;">
                    <div style="font-size: 1.5rem; color: var(--primary); margin-bottom: 1.0rem; font-weight: 800;">
                        AI 초고속 일괄 채점 중... 🤖
                    </div>
                    <div style="font-size: 0.95rem; color: var(--muted); margin-bottom: 2rem; line-height: 1.6;">
                        ${questionsToGrade.length}개 문항을 한 번에 채점하여 대기 시간을 대폭 줄이고 있습니다.
                    </div>
                    <div class="loader" style="margin: 0 auto; border: 4px solid rgba(56,189,248,0.1); border-left-color: var(--primary); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
                </div>
                <style>
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            `;

            try {
                console.log("[Bulk Grading] Sending questions to bulk API:", questionsToGrade);
                const bulkResults = await geminiScoreBulk(questionsToGrade);
                console.log("[Bulk Grading] Bulk results received:", bulkResults);
                bulkResults.forEach(r => {
                    resultsMap.set(r.index, {
                        score: r.score,
                        is_correct: r.is_correct,
                        feedback: r.feedback
                    });
                });
            } catch (bulkError) {
                console.error("[Bulk Grading] Error during bulk API grading, starting sequential fallback:", bulkError);
                const errMsg = bulkError.message || "알 수 없는 오류";
                for (let k = 0; k < questionsToGrade.length; k++) {
                    const item = questionsToGrade[k];
                    container.innerHTML = `
                        <div style="text-align:center; padding: 4rem;">
                            <div style="font-size: 1.4rem; color: #f87171; margin-bottom: 1rem; font-weight: 800;">
                                일괄 채점 실패로 인해 순차 채점 중... ⚠️
                            </div>
                            <div style="font-size: 0.95rem; color: var(--muted); margin-bottom: 1.5rem; line-height: 1.6; max-width: 500px; margin-left: auto; margin-right: auto; background: rgba(248,113,113,0.1); padding: 1rem; border-radius: 8px; border: 1px solid rgba(248,113,113,0.2);">
                                <strong>오류 원인:</strong> <span style="font-family: monospace; color: #fda4af;">${errMsg}</span>
                                <br><small style="color: var(--muted); margin-top: 0.5rem; display: block;">* 개인 API 키 권한, 네트워크 연결 혹은 429 한도 초과 오류인지 확인해 보세요.</small>
                            </div>
                            <div style="font-size: 1.1rem; color: var(--primary); margin-bottom: 1.5rem;">
                                채점 중... (${k + 1} / ${questionsToGrade.length})
                            </div>
                            <div style="height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; max-width: 300px; margin: 0 auto;">
                                <div style="height: 100%; width: ${Math.round((k/questionsToGrade.length)*100)}%; background: linear-gradient(90deg, #f87171, var(--primary)); border-radius: 3px; transition: width 0.3s;"></div>
                            </div>
                        </div>
                    `;
                    const res = await geminiScore(item.question, item.correct_answer, item.user_answer, item.points);
                    resultsMap.set(item.index, res);
                    if (k < questionsToGrade.length - 1) await new Promise(r => setTimeout(r, 4200));
                }
            }
        }

        for (let i = 0; i < total; i++) {
            results.push(resultsMap.get(i));
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
            
            session.details.push({
                qIndex: i,
                question: q.question,
                correct_answer: q.answer,
                user_answer: state.userAnswers[i],
                score: res.score,
                points: pts,
                is_correct: res.is_correct,
                feedback: res.feedback
            });
        });
            
        recalculateSessionScores(session);
        
        // Save to sessions
        saveQuizSessionToStorage(session);
        
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
        switchView('quiz-selection');
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
                state.questionStates[index].explanation = accumulated; // Persist
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
        switchView('quiz-selection');
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

    // Sync API key and preferred model to Firestore per-user
    if (db && loggedInUser && loggedInUser.username) {
        db.collection('users').doc(loggedInUser.username).update({
            geminiApiKey: key || '',
            geminiModel: model || ''
        }).then(() => {
            console.log(`[Sync] API settings successfully saved to Firestore for ${loggedInUser.username}`);
        }).catch(e => {
            console.error('[Sync] Error saving API settings to Firestore:', e);
        });
    }

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

// ─── Firebase Initialization ──────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAQkS9cAd8_ouVlfjjkiz5bQmGlhasd22g",
  authDomain: "archive-song.firebaseapp.com",
  projectId: "archive-song",
  storageBucket: "archive-song.firebasestorage.app",
  messagingSenderId: "579627045180",
  appId: "1:579627045180:web:54506f4a011d21f6398e39",
  measurementId: "G-5PECXSHNNE"
};

let db = null;
try {
    if (window.firebase) {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
    }
} catch (e) {
    console.error('Firebase initialization failed:', e);
}

let loggedInUser = null;

// Hashing Helper
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Auto-initialize Admin account in Firestore if not exists
async function initAdminAccount() {
    if (!db) return;
    try {
        const adminDocRef = db.collection('users').doc('admin');
        const docSnap = await adminDocRef.get();
        if (!docSnap.exists) {
            const adminHash = await sha256('2wsxXSW@');
            await adminDocRef.set({
                username: 'admin',
                passwordHash: adminHash,
                isAdmin: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Auth] Admin account pre-configured in Firestore.');
        }
    } catch (e) {
        console.error('[Auth] Failed to initialize admin account:', e);
    }
}

// User Registration
async function handleSignup(username, password) {
    if (!db) {
        throw new Error('데이터베이스 연결에 실패했습니다.');
    }
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) {
        throw new Error('아이디를 입력해 주세요.');
    }
    if (cleanUsername.length < 3) {
        throw new Error('아이디는 3자 이상이어야 합니다.');
    }
    if (!password || String(password).trim() === '') {
        throw new Error('비밀번호를 입력해 주세요.');
    }
    if (cleanUsername === 'admin') {
        throw new Error('admin 계정은 신규 등록할 수 없습니다.');
    }

    const userDocRef = db.collection('users').doc(cleanUsername);
    const docSnap = await userDocRef.get();
    if (docSnap.exists) {
        throw new Error('이미 존재하는 아이디입니다.');
    }

    const hash = await sha256(password);
    await userDocRef.set({
        username: cleanUsername,
        passwordHash: hash,
        isAdmin: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// User Login
async function handleLogin(username, password) {
    if (!db) {
        throw new Error('데이터베이스 연결에 실패했습니다.');
    }
    const cleanUsername = username.trim().toLowerCase();
    const hash = await sha256(password);

    const userDocRef = db.collection('users').doc(cleanUsername);
    const docSnap = await userDocRef.get();
    if (!docSnap.exists) {
        throw new Error('존재하지 않는 아이디입니다.');
    }

    const userData = docSnap.data();
    if (userData.passwordHash !== hash) {
        throw new Error('비밀번호가 일치하지 않습니다.');
    }

    // Save session in memory & localStorage
    const userSession = {
        username: userData.username,
        isAdmin: !!userData.isAdmin
    };
    localStorage.setItem('is_logged_in_user', JSON.stringify(userSession));
    loggedInUser = userSession;

    // Load API configuration specific to the logged-in user
    if (userData.geminiApiKey) {
        localStorage.setItem('gemini_api_key', userData.geminiApiKey);
    } else {
        localStorage.removeItem('gemini_api_key');
    }
    if (userData.geminiModel) {
        localStorage.setItem('gemini_model', userData.geminiModel);
    } else {
        localStorage.removeItem('gemini_model');
    }

    // Sync statistics history
    await syncStatsFromFirestore(userData.username);

    // Apply login UI state
    applyLoginState();
}

// Logout
function handleLogout() {
    localStorage.removeItem('is_logged_in_user');
    localStorage.removeItem('quiz_sessions');
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('gemini_model');
    loggedInUser = null;
    applyLoginState();
}

// Fetch stats history from Firestore
async function syncStatsFromFirestore(username) {
    if (!db) return;
    try {
        const querySnapshot = await db.collection('users').doc(username).collection('sessions').orderBy('date', 'asc').get();
        const firestoreSessions = [];
        querySnapshot.forEach(doc => {
            firestoreSessions.push({ id: doc.id, ...doc.data() });
        });
        localStorage.setItem('quiz_sessions', JSON.stringify(firestoreSessions));
        console.log(`[Sync] Synced ${firestoreSessions.length} session entries from Firestore.`);
    } catch (e) {
        console.error('[Sync] Error fetching sessions from Firestore:', e);
    }
}

// Save quiz session to both LocalStorage and Firestore
function saveQuizSessionToStorage(session) {
    // 1. Save to LocalStorage
    const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
    const idx = history.findIndex(h => h.id === session.id);
    if (idx !== -1) {
        history[idx] = session;
    } else {
        history.push(session);
    }
    localStorage.setItem('quiz_sessions', JSON.stringify(history));

    // 2. Save to Firestore
    if (db && loggedInUser && loggedInUser.username) {
        db.collection('users')
          .doc(loggedInUser.username)
          .collection('sessions')
          .doc(session.id)
          .set(session)
          .then(() => {
              console.log(`[Sync] Session ${session.id} synced to Firestore.`);
          })
          .catch(e => {
              console.error('[Sync] Error saving session to Firestore:', e);
          });
    }
}

// Clear history from LocalStorage and Firestore
async function clearLearningHistory() {
    if (!confirm('학습 기록을 모두 삭제하시겠습니까?')) return;
    
    localStorage.removeItem('quiz_sessions');
    
    if (db && loggedInUser && loggedInUser.username) {
        try {
            const sessionsSnapshot = await db.collection('users').doc(loggedInUser.username).collection('sessions').get();
            const batch = db.batch();
            sessionsSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            console.log('[Sync] All session records deleted in Firestore.');
        } catch (e) {
            console.error('[Sync] Error clearing Firestore history:', e);
        }
    }
    renderStats();
    renderDashboard();
}

async function resetStatsAndRetry() {
    localStorage.removeItem('quiz_sessions');
    if (db && loggedInUser && loggedInUser.username) {
        try {
            const sessionsSnapshot = await db.collection('users').doc(loggedInUser.username).collection('sessions').get();
            const batch = db.batch();
            sessionsSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        } catch (e) {
            console.error(e);
        }
    }
    renderStats();
}

// Toggle Login / Signup UI Mode
let isSignupMode = false;
function toggleLoginSignup() {
    isSignupMode = !isSignupMode;
    const title = document.getElementById('login-title');
    const submitBtn = document.getElementById('login-submit-btn');
    const switchText = document.getElementById('switch-text');
    const switchBtn = document.getElementById('switch-btn');
    const msgEl = document.getElementById('login-message');
    
    if (msgEl) msgEl.classList.add('hidden');

    if (isSignupMode) {
        title.textContent = '회원가입';
        submitBtn.textContent = '가입하기';
        switchText.textContent = '이미 계정이 있으신가요?';
        switchBtn.textContent = '로그인';
    } else {
        title.textContent = '로그인';
        submitBtn.textContent = '로그인';
        switchText.textContent = '계정이 없으신가요?';
        switchBtn.textContent = '회원가입';
    }
}

// Form Submission Handler
async function handleLoginSubmit(e) {
    e.preventDefault();
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-password');
    const msgEl = document.getElementById('login-message');
    const submitBtn = document.getElementById('login-submit-btn');

    if (!usernameEl || !passwordEl || !msgEl) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    msgEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';

    try {
        if (isSignupMode) {
            await handleSignup(username, password);
            msgEl.className = 'login-message success';
            msgEl.textContent = '회원가입이 완료되었습니다! 로그인 창에서 로그인해 주세요.';
            msgEl.classList.remove('hidden');
            toggleLoginSignup();
        } else {
            await handleLogin(username, password);
        }
    } catch (err) {
        msgEl.className = 'login-message error';
        msgEl.textContent = err.message || '요청을 처리하는 데 실패했습니다.';
        msgEl.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
    }
}

// Apply logged in/logged out screen state
function applyLoginState() {
    const loginScreen = document.getElementById('login-screen');
    const appEl = document.getElementById('app');
    const userDisplayName = document.getElementById('user-display-name');
    const navAdmin = document.getElementById('nav-admin');

    const isLoggedIn = loggedInUser && typeof loggedInUser === 'object' && loggedInUser.username;

    if (isLoggedIn) {
        if (loginScreen) loginScreen.classList.add('hidden');
        if (appEl) appEl.classList.remove('hidden');
        if (userDisplayName) userDisplayName.textContent = loggedInUser.username;
        
        if (loggedInUser.isAdmin) {
            if (navAdmin) navAdmin.classList.remove('hidden');
        } else {
            if (navAdmin) navAdmin.classList.add('hidden');
        }
        switchView('dashboard');
    } else {
        if (loginScreen) loginScreen.classList.remove('hidden');
        if (appEl) appEl.classList.add('hidden');
        if (navAdmin) navAdmin.classList.add('hidden');
        
        const usernameInput = document.getElementById('login-username');
        const passwordInput = document.getElementById('login-password');
        if (usernameInput) usernameInput.value = '';
        if (passwordInput) passwordInput.value = '';
        const msgEl = document.getElementById('login-message');
        if (msgEl) msgEl.classList.add('hidden');
    }
}

// Admin Panel Renders
async function renderAdminPanel() {
    if (!db || !loggedInUser || !loggedInUser.isAdmin) return;
    const userListTbody = document.getElementById('admin-users-list');
    const userCountDiv = document.getElementById('admin-user-count');
    if (!userListTbody) return;

    userListTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--muted);">불러오는 중...</td></tr>';

    try {
        const querySnapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
        let content = '';
        let count = 0;
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const username = data.username;
            const isAdmin = !!data.isAdmin;
            const dateStr = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString('ko-KR') : '-';
            
            const usageBtn = isAdmin 
                ? `<span style="color: var(--muted); font-size: 0.85rem;">기록 없음</span>` 
                : `<button class="usage-btn" id="usage-btn-${username}" onclick="toggleUserUsageDetails('${username}')">이용 현황 보기</button>`;

            const deleteBtn = isAdmin 
                ? `<span class="admin-badge">기본 계정</span>` 
                : `<button class="delete-user-btn" onclick="handleDeleteUser('${username}')">계정 삭제</button>`;

            content += `
                <tr>
                    <td><strong>${username}</strong></td>
                    <td>${isAdmin ? '<span style="color: var(--primary); font-weight: bold;">관리자</span>' : '일반 회원'}</td>
                    <td>${dateStr}</td>
                    <td>${usageBtn}</td>
                    <td>${deleteBtn}</td>
                </tr>
                <tr id="user-details-${username}" style="display:none;">
                    <td colspan="5" id="user-details-td-${username}" style="padding: 0.5rem 1.5rem 1.5rem 1.5rem; background: rgba(10, 14, 23, 0.35);"></td>
                </tr>
            `;
            count++;
        });
        userListTbody.innerHTML = content || '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--muted);">가입된 회원이 없습니다.</td></tr>';
        if (userCountDiv) userCountDiv.textContent = `총 회원 수: ${count}명`;
    } catch (e) {
        console.error('[Admin] Error rendering admin panel:', e);
        userListTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #f87171;">데이터를 불러오는 중 오류가 발생했습니다: ${e.message}</td></tr>`;
    }
}

// Toggle User Usage Details in Admin Panel
async function toggleUserUsageDetails(username) {
    const detailRow = document.getElementById(`user-details-${username}`);
    const detailTd = document.getElementById(`user-details-td-${username}`);
    const btn = document.getElementById(`usage-btn-${username}`);
    if (!detailRow || !detailTd) return;

    if (detailRow.style.display !== 'none') {
        detailRow.style.display = 'none';
        if (btn) btn.textContent = '이용 현황 보기';
        return;
    }

    detailRow.style.display = '';
    if (btn) btn.textContent = '이용 현황 닫기';
    detailTd.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--muted);">이용 현황 불러오는 중... ⏳</div>';

    try {
        const querySnapshot = await db.collection('users').doc(username).collection('sessions').orderBy('date', 'desc').get();
        if (querySnapshot.empty) {
            detailTd.innerHTML = '<div style="text-align: center; padding: 1.5rem; color: var(--muted); background: rgba(0,0,0,0.15); border-radius: 8px;">최근 기출 훈련 이용 내역이 없습니다.</div>';
            return;
        }

        let totalSessionsCount = 0;
        let totalScoreSum = 0;
        let maxScoreSum = 0;
        let rowHtml = '';

        querySnapshot.forEach(doc => {
            const session = doc.data();
            const dateStr = session.date ? new Date(session.date).toLocaleString('ko-KR') : '-';
            const title = session.title || '알 수 없는 회차';
            const solvedCount = session.details ? session.details.length : 0;
            
            let correctCount = 0;
            if (session.details) {
                correctCount = session.details.filter(d => d.is_correct).length;
            }

            const pct = session.pct !== undefined ? session.pct : 0;
            const scoreStr = session.totalScore !== undefined ? `${session.totalScore} / ${session.maxScore}점` : '';
            
            totalSessionsCount++;
            if (session.totalScore !== undefined) totalScoreSum += session.totalScore;
            if (session.maxScore !== undefined) maxScoreSum += session.maxScore;

            rowHtml += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding: 0.8rem 1rem; color: #fff; text-align: left;"><strong>${title}</strong></td>
                    <td style="padding: 0.8rem 1rem; color: var(--muted); font-size: 0.85rem; text-align: left;">${dateStr}</td>
                    <td style="padding: 0.8rem 1rem; text-align: center; color: #fff;">
                        ${correctCount} / ${solvedCount} ${scoreStr ? `(${scoreStr})` : ''}
                    </td>
                    <td style="padding: 0.8rem 1rem; text-align: right; font-weight: bold; color: ${pct >= 60 ? '#10b981' : '#f87171'}">${pct}%</td>
                </tr>
            `;
        });

        const overallPct = maxScoreSum > 0 ? Math.round((totalScoreSum / maxScoreSum) * 100) : 0;

        detailTd.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); padding: 1.5rem; border-radius: 12px; margin: 0.5rem 0;">
                <h4 style="margin-top: 0; margin-bottom: 1rem; color: var(--primary); font-size: 1.05rem; font-weight: 800;">📊 '${username}' 회원 학습 통계 로그</h4>
                <div style="max-height: 250px; overflow-y: auto; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; background: rgba(10, 14, 23, 0.5);">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3);">
                                <th style="padding: 0.8rem 1rem; text-align: left; color: var(--muted); font-weight: 700;">기출 회차</th>
                                <th style="padding: 0.8rem 1rem; text-align: left; color: var(--muted); font-weight: 700;">풀이 완료 시간</th>
                                <th style="padding: 0.8rem 1rem; text-align: center; color: var(--muted); font-weight: 700;">정답률 (획득 점수)</th>
                                <th style="padding: 0.8rem 1rem; text-align: right; color: var(--muted); font-weight: 700;">성취율</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowHtml}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top: 1.2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--muted); flex-wrap: wrap; gap: 0.8rem;">
                    <span>총 풀이 세션: <strong style="color: #fff;">${totalSessionsCount}회</strong></span>
                    <span>누적 점수: <strong style="color: #fff;">${totalScoreSum} / ${maxScoreSum}점</strong> (평균 성취도: <strong style="color: ${overallPct >= 60 ? '#10b981' : '#f87171'}; font-size: 1rem; font-weight: 800;">${overallPct}%</strong>)</span>
                </div>
            </div>
        `;
    } catch (e) {
        console.error('[Admin] Error fetching usage details:', e);
        detailTd.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: #f87171; background: rgba(248,113,113,0.05); border-radius: 8px; border: 1px solid rgba(248,113,113,0.15);">이용 현황을 불러오는데 실패했습니다: ${e.message}</div>`;
    }
}

// Admin Account Deletion
async function handleDeleteUser(username) {
    if (!confirm(`정말로 '${username}' 사용자의 계정 및 모든 학습 통계 데이터를 완전히 삭제하시겠습니까?`)) {
        return;
    }
    try {
        // 1. Delete user stats sessions subcollection
        const sessionsSnapshot = await db.collection('users').doc(username).collection('sessions').get();
        const batch = db.batch();
        sessionsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
        // 2. Delete user account document
        await db.collection('users').doc(username).delete();
        alert(`'${username}' 계정이 완전히 삭제되었습니다.`);
        renderAdminPanel();
    } catch (e) {
        console.error('[Admin] Error deleting user:', e);
        alert(`사용자 삭제 실패: ${e.message}`);
    }
}

// ─── Init App ─────────────────────────────────────────────
async function initApp() {
    await initAdminAccount();
    
    // Auto load session
    const savedUser = localStorage.getItem('is_logged_in_user');
    if (savedUser) {
        try {
            loggedInUser = JSON.parse(savedUser);
            if (loggedInUser && loggedInUser.username) {
                await syncStatsFromFirestore(loggedInUser.username);
            }
        } catch (e) {
            console.error('Failed to parse saved login user session:', e);
            loggedInUser = null;
        }
    }
    applyLoginState();
    loadSettings();
}

// Expose globals for inline event handlers
window.handleLoginSubmit = handleLoginSubmit;
window.toggleLoginSignup = toggleLoginSignup;
window.handleLogout = handleLogout;
window.clearLearningHistory = clearLearningHistory;
window.resetStatsAndRetry = resetStatsAndRetry;
window.handleDeleteUser = handleDeleteUser;
window.saveQuizSessionToStorage = saveQuizSessionToStorage;
window.renderAdminPanel = renderAdminPanel;
window.toggleUserUsageDetails = toggleUserUsageDetails;

// Setup Event Listeners
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

initApp();