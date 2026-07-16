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

// ─── Format Answers Helper ────────────────────────────────
function extractLabelsFromAnswer(answer) {
    if (!answer) return [];
    
    // Pre-process: split inline markers into newlines using our improved markerRegex
    let formatted = String(answer).trim();
    const markerRegex = /([,;\/\s]+)?(\([A-Za-z가-힣0-9]\)|\[[A-Za-z가-힣0-9]\]|[①-⑳]|\b\d{1,2}\)(?=\s+[A-Za-z가-힣\/]))/g;
    if (markerRegex.test(formatted)) {
        formatted = formatted.replace(markerRegex, (match, sep, marker, index) => {
            return index === 0 ? marker : '\n' + marker;
        });
    }

    const lines = formatted.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return [];
    
    const labels = [];
    // Match line starting with optional numbered marker, followed by OS/subject name, followed by colon
    // e.g. "1) Solaris: ...", "Solaris: ...", "① Solaris: ..."
    const lineRegex = /^(?:\d{1,2}\)|[A-Za-z가-힣]\)|[①-⑳]|\([A-Za-z0-9]\))?\s*([A-Za-z가-힣0-9_#-]+)\s*:/;
    
    for (const line of lines) {
        const match = line.match(lineRegex);
        if (match) {
            labels.push(match[1].trim());
        } else {
            return [];
        }
    }
    return labels;
}

function formatModelAnswer(answer, question = '') {
    if (!answer) return '';
    let formatted = String(answer).trim();

    // Try to extract blanks from question
    let blanks = [];
    if (question) {
        let matchText1 = question.match(/\(\s*([A-Za-z가-힣ㄱ-ㅎ]|[0-9]{1,2})\s*\)/g) || [];
        let matchText2 = question.match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g) || [];
        let matchText3 = question.match(/(?:^|[\s\n])(\d{1,2}|[A-Za-z가-힣ㄱ-ㅎ])\)/g) || [];
        
        if (matchText1.length > 0) {
            blanks = [...new Set(matchText1.map(m => m.replace(/[\(\)\s]/g, '')))];
        } else if (matchText2.length > 0) {
            blanks = [...new Set(matchText2)];
        } else if (matchText3.length > 0) {
            blanks = [...new Set(matchText3.map(m => m.replace(/[\)\s\n]/g, '')))];
        }
    }

    // 괄호나 번호 인덱스가 문제에는 없지만 모범 답안에 여러 개 기재되어 있는 경우
    if (blanks.length === 0 && answer) {
        const customLabels = extractLabelsFromAnswer(answer);
        if (customLabels.length > 0) {
            blanks = customLabels;
        } else {
            let matchAns1 = String(answer).match(/\(\s*([A-Za-z가-힣ㄱ-ㅎ]|[0-9]{1,2})\s*\)/g) || [];
            let matchAns2 = String(answer).match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g) || [];
            let matchAns3 = String(answer).match(/^[ \t]*(\d{1,2}|[A-Za-z가-힣ㄱ-ㅎ])\)/gm) || [];
            
            if (matchAns1.length > 1) {
                blanks = [...new Set(matchAns1.map(m => m.replace(/[\(\)\s]/g, '')))];
            } else if (matchAns2.length > 1) {
                blanks = [...new Set(matchAns2)];
            } else if (matchAns3.length > 1) {
                blanks = [...new Set(matchAns3.map(m => m.replace(/[\)\s\n\r]/g, '')))];
            }
        }
    }

    // 1. If it already contains markers like (A), (B), [A], ①, etc., split them into new lines
    const markerRegex = /([,;\/\s]+)?(\([A-Za-z가-힣0-9]\)|\[[A-Za-z가-힣0-9]\]|[①-⑳]|\b\d{1,2}\)(?=\s+[A-Za-z가-힣\/]))/g;
    if (markerRegex.test(formatted)) {
        formatted = formatted.replace(markerRegex, (match, sep, marker, index) => {
            return index === 0 ? marker : '\n' + marker;
        });
        return formatted;
    }

    // 2. If the question has multiple blanks, and the answer has separators
    if (blanks && blanks.length > 1) {
        // Try splitting by comma or semicolon first (which is the most common)
        let parts = formatted.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
        
        // If that doesn't match, check if we can split by " / " (slash with spaces) or newlines
        if (parts.length !== blanks.length) {
            if (formatted.includes('\n')) {
                parts = formatted.split('\n').map(p => p.trim()).filter(Boolean);
            }
        }
        if (parts.length !== blanks.length) {
            // Split by slash with spaces (e.g. "lastlog / sulog / acct") to avoid splitting "acct/pacct"
            parts = formatted.split(/\s+\/\s+/).map(p => p.trim()).filter(Boolean);
        }
        
        if (parts.length === blanks.length) {
            return blanks.map((label, idx) => {
                const part = parts[idx];
                const cleanLabel = label.trim();
                const startsWithLabel = new RegExp(`^\\(?[\\s#]*${cleanLabel}[\\s\\)#]*`, 'i');
                if (startsWithLabel.test(part)) {
                    return part;
                }
                return `(${cleanLabel}) ${part}`;
            }).join('\n');
        }
    }

    return formatted;
}

function formatUserAnswer(userAnswer) {
    if (!userAnswer) return '';
    let formatted = String(userAnswer).trim();
    if (formatted.includes(' / ')) {
        formatted = formatted.split(' / ').join('\n');
    }
    return formatted;
}

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
    } else if (id === 'settings') {
        loadSettings();
    } else if (id === 'admin-panel') {
        renderAdminPanel();
    }
}

// Navigation event listeners moved to the end of the file to avoid duplicates and errors

// ─── Sync ─────────────────────────────────────────────────
// Sync button listener moved to the end of the file

// Helper to get combined static and custom Firestore sessions
async function getCombinedSessions() {
    try {
        const res = await fetch('./data/sessions.json?t=' + Date.now());
        const sessions = await res.json();
        if (db) {
            try {
                const customSnap = await db.collection('custom_sessions').orderBy('createdAt', 'desc').get();
                customSnap.forEach(doc => {
                    const data = doc.data();
                    if (!sessions.some(s => s.id === data.id)) {
                        sessions.push({
                            id: data.id,
                            name: data.name,
                            count: data.count,
                            isCustom: true
                        });
                    }
                });
            } catch (e) {
                console.error('[Sync] Error loading custom sessions from Firestore:', e);
            }
        }
        return sessions;
    } catch (e) {
        console.error('Failed to get combined sessions:', e);
        return [];
    }
}

// ─── Dashboard ────────────────────────────────────────────
async function renderDashboard() {
    // Fetch parsed sessions

    // Fetch parsed sessions
    const parsedDiv = document.getElementById('parsed-sessions');
    if (!parsedDiv) return;

    // Feature and Shortcut Data for Exam Trainer
    const examFeatures = [
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`, title: '실전 모드', desc: '실제 시험처럼 모든 문제를 푼 뒤 한꺼번에 AI 채점을 받습니다.', color: '#0ea5e9' },
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`, title: '즉시 채점', desc: '문제를 풀 때마다 실시간으로 AI의 정밀 채점과 피드백을 확인합니다.', color: '#10b981' },
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`, title: '학습 모드', desc: '정답을 미리 보며 해설과 함께 개념을 익히는 학습 중심 모드입니다.', color: '#f59e0b' },
        { icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`, title: 'AI 튜터', desc: '모르는 부분은 언제든 AI에게 질문하고 상세한 해설을 스트리밍으로 받으세요.', color: '#8b5cf6' }
    ];

    const shortcuts = [
        { key: 'Ctrl + Enter', desc: '답안 제출 / 다음 문제' },
        { key: 'Ctrl + [', desc: '이전 문제' },
        { key: 'Ctrl + ]', desc: '다음 문제' },
        { key: 'Ctrl + Alt + T', desc: 'AI 상세 해설 열기' }
    ];

    try {
        const sessions = await getCombinedSessions();

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
            <div class="dashboard-feature-card" style="background: linear-gradient(145deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; display: flex; align-items: flex-start; gap: 1rem; transition: transform 0.2s, border-color 0.2s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.borderColor='${f.color}44'" onmouseout="this.style.transform='none'; this.style.borderColor='rgba(255,255,255,0.06)'">
                <div style="display: flex; align-items: center; justify-content: center; background: ${f.color}15; padding: 0.6rem; border-radius: 10px; color: ${f.color}; flex-shrink: 0;">
                    ${f.icon}
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                    <div style="font-weight: 800; font-size: 1.05rem; color: #fff; letter-spacing: -0.02em;">${f.title}</div>
                    <div style="font-size: 0.85rem; color: #94a3b8; line-height: 1.4; word-break: keep-all;">${f.desc}</div>
                </div>
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
                    <div style="display: flex; flex-direction: column; height: 100%;">
                        <h3 style="font-weight: 900; font-size: 1.3rem; margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.6rem; color: #fff; flex-shrink: 0;">
                            <span style="color: var(--primary);">✨</span> 핵심 기능
                        </h3>
                        <div class="dashboard-features-grid" style="flex: 1; display: grid;">
                            ${featureCards}
                        </div>
                    </div>

                    <!-- Right: How to Use -->
                    <div style="display: flex; flex-direction: column; height: 100%;">
                        <h3 style="font-weight: 900; font-size: 1.3rem; margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.6rem; color: #fff; flex-shrink: 0;">
                            <span style="font-size: 1.4rem;">📘</span> 사이트 이용방법
                        </h3>
                        <div style="flex: 1; background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; min-height: 180px;">
                            <p style="color: #cbd5e1; margin-bottom: 1.5rem; line-height: 1.6; font-size: 0.95rem;">처음 오셨나요?<br>기출 풀이 사이트의 핵심 기능과 효율적인 학습 방법을 확인해 보세요!</p>
                            <button onclick="openGuideModal()" style="background: linear-gradient(135deg, var(--primary), #0284c7); color: #fff; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; font-weight: 700; font-size: 1rem; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);">
                                📖 이용방법 가이드 보기
                            </button>
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
        let history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
        history = history.filter(h => h.mode !== 'study');

        if (history.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 4rem 2rem;">
                    <div style="font-size: 4rem; margin-bottom: 1.5rem;">📊</div>
                    <h2 style="color: var(--muted); font-weight: 700; margin-bottom: 1rem;">아직 학습 기록이 없습니다</h2>
                    <p style="color: var(--muted); font-size: 1.1rem;">기출 풀기에서 문제를 풀어보세요!</p>
                </div>
                <div style="text-align:center; padding:1rem; margin-top: 2rem;">
                    <button onclick="clearLearningHistory()" style="background:rgba(248,113,113,0.1); color:#f87171; border:1px solid rgba(248,113,113,0.3); padding:0.8rem 2rem; border-radius:8px; cursor:pointer; font-weight:700; transition:0.2s;" onmouseover="this.style.background='rgba(248,113,113,0.2)'" onmouseout="this.style.background='rgba(248,113,113,0.1)'">
                        🗑️ 학습 기록 초기화
                    </button>
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
                <div class="text"><strong>단답형</strong><span id="count-short">3점 문제 (불러오는 중...)</span></div>
            </div>
            <div class="item-row" id="type-row-essay" style="cursor: pointer;" onclick="selectType('essay', 4, '서술형')">
                <div class="text"><strong>서술형</strong><span id="count-essay">12점 문제 (불러오는 중...)</span></div>
            </div>
            <div class="item-row" id="type-row-practical" style="cursor: pointer;" onclick="selectType('practical', 2, '실무형')">
                <div class="text"><strong>실무형</strong><span id="count-practical">16점 문제 (불러오는 중...)</span></div>
            </div>
        </div>
        
        <!-- 하단 통합 입력 영역 (예쁘게 중앙 정렬 및 크기 제한) -->
        <div id="type-action-area" style="display: none; margin-top: 1.5rem; animation: fadeIn 0.3s ease;">
            <div class="type-action-card">
                <div style="margin-bottom: 1.5rem; color: #fff; font-size: 1.15rem;">
                    <strong id="selected-type-name" style="color: var(--primary); font-size: 1.3rem;">유형</strong>
                    <span style="color: #cbd5e1; font-weight: 500;"> 몇 문제를 푸시겠습니까?</span>
                    <div id="max-count-hint" style="font-size: 0.85rem; color: #94a3b8; margin-top: 0.5rem;">최대 선택 가능 문제 수: 불러오는 중...</div>
                </div>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <input type="number" id="global-type-count" value="" min="1" max="100" style="width: 120px; padding: 0.8rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: rgba(15,23,42,0.8); color: #fff; outline: none; font-size: 1.3rem; text-align: center; font-weight: 800; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                    <button id="global-type-start-btn" style="flex: 1; background: linear-gradient(135deg, #0ea5e9, #38bdf8); color: #fff; border: none; border-radius: 10px; font-weight: 800; font-size: 1.2rem; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 12px rgba(56, 189, 248, 0.3);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">시작하기</button>
                </div>
            </div>
        </div>
    `;

    const types = ['short', 'essay', 'practical'];
    const scores = { short: 3, essay: 12, practical: 16 };
    window.typeMaxCounts = window.typeMaxCounts || {};

    const updateUI = () => {
        types.forEach(t => {
            const countEl = document.getElementById(`count-${t}`);
            if (countEl) {
                if (window.typeMaxCounts[t] !== undefined) {
                    countEl.textContent = `${scores[t]}점 문제 (보유: 총 ${window.typeMaxCounts[t]}문제)`;
                } else {
                    countEl.textContent = `${scores[t]}점 문제 (불러오는 중...)`;
                }
            }
        });
    };

    if (Object.keys(window.typeMaxCounts).length === 0 && db) {
        window.typeMaxCounts = { short: 0, essay: 0, practical: 0 };
        db.collection('custom_questions').get().then(snap => {
            snap.forEach(doc => {
                const data = doc.data();
                if (data.questions) {
                    data.questions.forEach(q => {
                        if (q.type === 'short' || q.type === '단답형') window.typeMaxCounts.short++;
                        else if (q.type === 'essay' || q.type === '서술형') window.typeMaxCounts.essay++;
                        else if (q.type === 'practical' || q.type === '실무형') window.typeMaxCounts.practical++;
                    });
                }
            });
            updateUI();
        }).catch(e => {
            console.error('Failed to load counts from firestore', e);
            updateUI();
        });
    } else {
        updateUI();
    }
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
        
        const max = window.typeMaxCounts[type] || 100;
        const countInput = document.getElementById('global-type-count');
        countInput.max = max;
        countInput.value = Math.min(defaultCount, max);
        
        const hintEl = document.getElementById('max-count-hint');
        if (hintEl) {
            hintEl.textContent = `현재 DB에 파싱 완료된 문제: 총 ${max}문제 (최대 선택 가능)`;
        }
        
        document.getElementById('global-type-start-btn').onclick = () => {
            let val = parseInt(countInput.value, 10);
            if (val > max) {
                alert(`해당 유형은 현재 최대 ${max}문제까지만 준비되어 있습니다!`);
                countInput.value = max;
                return;
            }
            if (val < 1) val = 1;
            startTypeQuiz(type);
        };
    }
}
window.selectType = selectType;


async function startMockExamQuiz() {
    try {
        const res = await fetch('./data/questions_all.json?t=' + Date.now());
        const data = await res.json();
        const allQuestions = data.questions;
        
        // Group by type
        const shortList = allQuestions.filter(q => q.type === 'short');
        const essayList = allQuestions.filter(q => q.type === 'essay');
        const practicalList = allQuestions.filter(q => q.type === 'practical');
        
        if (shortList.length < 12 || essayList.length < 4 || practicalList.length < 1) {
            alert('모의고사를 생성하기 위한 충분한 문제가 없습니다. 문항 데이터를 확인해 주세요.');
            return;
        }
        
        // Randomly select items
        const selectedShort = [...shortList].sort(() => Math.random() - 0.5).slice(0, 12);
        const selectedEssay = [...essayList].sort(() => Math.random() - 0.5).slice(0, 4);
        const selectedPractical = [...practicalList].sort(() => Math.random() - 0.5).slice(0, 1);
        
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
        const sessions = await getCombinedSessions();
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

async function startTypeQuiz(type) {
    let questions = [];
    try {
        const res = await fetch(`./data/questions_type_${type}.json?t=` + Date.now());
        const data = await res.json();
        questions = [...(data.questions || [])];
    } catch (e) {
        console.error('Failed to load static type questions:', e);
    }
    
    if (db) {
        try {
            const customSnap = await db.collection('custom_questions').get();
            customSnap.forEach(doc => {
                const data = doc.data();
                if (data.questions) {
                    const filtered = data.questions.filter(q => q.type === type);
                    questions.push(...filtered);
                }
            });
        } catch (e) {
            console.error('[Sync] Failed to load custom questions for type quiz:', e);
        }
    }
    
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
    let questions = [];
    let title = sessionId;
    
    // Check if it's a custom session (timestamp length > 10)
    if (sessionId.startsWith('session_') && sessionId.length > 10) {
        if (!db) {
            alert('데이터베이스 연결이 비활성화되어 커스텀 기출을 불러올 수 없습니다.');
            return;
        }
        try {
            const doc = await db.collection('custom_questions').doc(sessionId).get();
            if (doc.exists) {
                const data = doc.data();
                questions = data.questions || [];
                
                // Fetch the session name from custom_sessions metadata
                const metaDoc = await db.collection('custom_sessions').doc(sessionId).get();
                if (metaDoc.exists) {
                    title = metaDoc.data().name || sessionId;
                }
            } else {
                throw new Error("문서를 찾을 수 없습니다.");
            }
        } catch (e) {
            console.error('[Sync] Failed to load custom questions:', e);
            alert('커스텀 기출문제를 불러오지 못했습니다: ' + e.message);
            return;
        }
    } else {
        // Static local JSON
        try {
            const res = await fetch(`./data/questions_${encodeURIComponent(sessionId)}.json`);
            const data = await res.json();
            questions = data.questions;
            title = data.session || sessionId;
        } catch (e) {
            console.error('Failed to load static session:', e);
            alert('기출문제를 불러오지 못했습니다.');
            return;
        }
    }
    
    launchQuiz(questions, `📅 ${title}`);
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

    // Initialize session in localStorage/Firestore if not study mode
    if (state.quizMode !== 'study') {
        const session = {
            id: state.currentSessionId,
            title: title,
            date: new Date().toISOString(),
            totalScore: 0,
            maxScore: 0,
            mode: state.quizMode,
            details: questions.map((q, idx) => {
                const pts = q.points ?? TYPE_POINTS[q.type] ?? 0;
                return {
                    qIndex: idx,
                    id: q.id,
                    original_id: q.original_id,
                    type: q.type,
                    session: q.session,
                    question: q.question,
                    correct_answer: q.answer,
                    user_answer: '미입력',
                    score: 0,
                    points: pts,
                    is_correct: false,
                    feedback: '제출하지 않음 (건너뜀)'
                };
            })
        };
        recalculateSessionScores(session);
        saveQuizSessionToStorage(session);
    }
    
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
    if (memo) memo.innerHTML = '';

    switchView('quiz-view');
    renderQuestion();
    startTimer();
    saveQuizStateForRecovery();
}

// ─── Render Question ──────────────────────────────────────
function renderQuestion() {
    const q = state.questions[state.index];
    if (!q) return;

    // Load memo for current question
    const memoPad = document.getElementById('memo-pad');
    if (memoPad) {
        const qKey = (q.original_id || q.id) + "_" + q.type;
        const memos = JSON.parse(localStorage.getItem('question_memos') || '{}');
        memoPad.innerHTML = memos[qKey] || '';
    }

    if (typeof updateBookmarkButtonState === 'function') {
        updateBookmarkButtonState();
    }

    // Meta badges
    document.getElementById('q-number').textContent = `Q${state.index + 1}`;
    document.getElementById('q-type').textContent = TYPE_LABEL[q.type] || q.type;
    document.getElementById('q-points').textContent = `${q.points ?? TYPE_POINTS[q.type] ?? 0}점`;
    let questionText = q.question;
    
    // 이스케이프 및 보기 박스 처리
    let escaped = questionText.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
    
    // 특정 키워드로 시작하는 보기 영역을 감지하여 박스 처리
    const bogiRegex = /(\[보기\]|&lt;보기&gt;|\[\s*아파치 로그\s*\]|\[\s*로그\s*\]|\[\s*표\s*\]|\[\s*지문\s*\]|\[\s*설정\s*\]|\[\s*조건\s*\]|\[\s*코드\s*\])([\s\S]*?)(?=(?:\s1\)|\s\(1\)|①|가\.|\[문\]|\(가\)|$))/g;
    escaped = escaped.replace(bogiRegex, '<div class="bogi-box"><div class="bogi-badge">$1</div>$2</div>');
    
    // 개행 문자를 <br>로 변환
    escaped = escaped.replace(/\n/g, '<br>');
    
    document.getElementById('q-text').innerHTML = escaped;

    // Source Info
    const sourceEl = document.getElementById('q-source');
    const sourceTextEl = document.getElementById('q-source-text');
    if (sourceEl && sourceTextEl) {
        if (q.session && (q.original_id || q.id)) {
            sourceEl.style.display = 'flex';
            sourceTextEl.textContent = `${q.session} - ${q.original_id || q.id}번 문제`;
        } else if (q.session) {
            sourceEl.style.display = 'flex';
            sourceTextEl.textContent = `${q.session}`;
        } else {
            sourceEl.style.display = 'none';
        }
    }

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
        // In study mode, inputs will still render below so user can see structure.
        nextBtn.textContent = '다음 문제 → (Ctrl+Enter)';
        nextBtn.style.background = '';
    }
    // Proceed to render inputs
    let matchText1 = q.question.match(/\(\s*([A-Za-z가-힣ㄱ-ㅎ]|[0-9]{1,2})\s*\)/g) || [];
        let matchText2 = q.question.match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g) || [];
        let matchText3 = q.question.match(/(?:^|[\s\n])(\d{1,2}|[A-Za-z가-힣ㄱ-ㅎ])\)/g) || [];
        
        let blanks = [];
        let isCustomLabels = false;
        if (matchText1.length > 0) {
            blanks = [...new Set(matchText1.map(m => m.replace(/[\(\)\s]/g, '')))];
        } else if (matchText2.length > 0) {
            blanks = [...new Set(matchText2)];
        } else if (matchText3.length > 0) {
            blanks = [...new Set(matchText3.map(m => m.replace(/[\)\s\n]/g, '')))];
        }

        // 괄호나 번호 인덱스가 문제에는 없지만 모범 답안에 여러 개 기재되어 있는 경우
        if (blanks.length === 0 && q.answer) {
            const customLabels = extractLabelsFromAnswer(q.answer);
            if (customLabels.length > 0) {
                blanks = customLabels;
                isCustomLabels = true;
            } else {
                let matchAns1 = q.answer.match(/\(\s*([A-Za-z가-힣ㄱ-ㅎ]|[0-9]{1,2})\s*\)/g) || [];
                let matchAns2 = q.answer.match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g) || [];
                let matchAns3 = q.answer.match(/^[ \t]*(\d{1,2}|[A-Za-z가-힣ㄱ-ㅎ])\)/gm) || [];
                
                if (matchAns1.length > 1) {
                    blanks = [...new Set(matchAns1.map(m => m.replace(/[\(\)\s]/g, '')))];
                } else if (matchAns2.length > 1) {
                    blanks = [...new Set(matchAns2)];
                } else if (matchAns3.length > 1) {
                    blanks = [...new Set(matchAns3.map(m => m.replace(/[\)\s\n\r]/g, '')))];
                }
            }
        }
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

        if (state.quizMode === 'study') {
            container.innerHTML = '';
        } else if (blanks.length > 0) {
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
        } else if (state.quizMode === 'study') {
            if (state.index === state.questions.length - 1) {
                nextBtn.textContent = '완료 🚀 (Ctrl+Enter)';
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

        // Update skip-btn visibility
        const skipBtn = document.getElementById('skip-btn');
        if (skipBtn) {
            if (!state.bulkScoring && !qState.scored && state.quizMode !== 'study') {
                skipBtn.classList.remove('hidden');
                if (state.index === state.questions.length - 1) {
                    skipBtn.textContent = '완료 (Ctrl+])';
                } else {
                    skipBtn.textContent = '다음 문제 (건너뛰기) → (Ctrl+])';
                }
            } else {
                skipBtn.classList.add('hidden');
            }
        }

        // Restore Feedback if scored or study mode
        const fb = document.getElementById('feedback-area');
        const feedbackPanel = document.getElementById('quiz-feedback-panel');
        if (qState.scored) {
            fb.innerHTML = `
                <div style="border-left: 4px solid ${qState.isCorrect ? 'var(--primary)' : '#f87171'}; padding-left: 1rem; animation: fadeIn 0.3s ease;">
                    <strong>${qState.isCorrect ? '✅ 정답' : '⚠️ 오답/부분점수'} (${qState.score}점)</strong>
                    <div style="margin-top:0.8rem; background: rgba(0,0,0,0.2); padding: 0.8rem; border-radius: 6px;">
                        <strong style="color:var(--primary);">모범 답안:</strong> 
                        <span style="color:#fff; white-space: pre-wrap; line-height: 1.6; display: block;">${formatModelAnswer(q.answer, q.question)}</span>
                    </div>
                    <p style="margin-top:0.8rem; color:var(--muted); white-space:pre-wrap">${qState.feedback}</p>
                    <button class="btn-next" onclick="nextQuestion()" style="margin-top:1.5rem; width:100%">다음 문제 → (Ctrl+Enter)</button>
                </div>
            `;
            fb.classList.remove('hidden');
            if (feedbackPanel) feedbackPanel.classList.remove('hidden');
        } else if (state.quizMode === 'study') {
            fb.innerHTML = `
                <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 1.5rem; animation: fadeIn 0.3s ease;">
                    <strong style="color: var(--primary); display: block; margin-bottom: 0.8rem; font-size: 1.1rem;">💡 정답 (학습 모드)</strong>
                    <span style="color: #fff; line-height: 1.6; white-space: pre-wrap; display: block;">${formatModelAnswer(q.answer, q.question)}</span>
                </div>
            `;
            fb.classList.remove('hidden');
            if (feedbackPanel) feedbackPanel.classList.remove('hidden');
        } else {
            fb.classList.add('hidden');
            if (feedbackPanel) feedbackPanel.classList.add('hidden');
        }

        // Restore Explanation Panel if exists
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
        saveQuizStateForRecovery();
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
    saveQuizStateForRecovery();
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
    if (!q) return;

    const qState = state.questionStates[state.index];
    if (qState && (qState.scored || qState.grading)) {
        nextQuestion();
        return;
    }

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

    // Set grading flag to true to prevent duplicate calls
    if (qState) {
        qState.grading = true;
    }

    state.submitting = false;
    state.userAnswers[state.index] = userAnswer;
    saveQuizStateForRecovery();
    const fb = document.getElementById('feedback-area');
    fb.classList.remove('hidden');
    const feedbackPanel = document.getElementById('quiz-feedback-panel');
    if (feedbackPanel) feedbackPanel.classList.remove('hidden');
    const skipBtn = document.getElementById('skip-btn');
    if (skipBtn) skipBtn.classList.add('hidden');

    const pts = q.points ?? TYPE_POINTS[q.type] ?? 0;

    // 즉시 결과 노출 (모범 답안과 다음 문제 버튼 노출 - 체감 대기시간 0초)
    fb.innerHTML = `
        <div style="border-left: 4px solid var(--muted); padding-left: 1rem; transition: border-color 0.3s;" id="local-feedback-container">
            <div id="ai-status-area" style="margin-bottom: 0.8rem; font-weight: 800; color: var(--primary);">
                AI 채점 중... ⏳ <span style="font-size: 0.8rem; font-weight: normal; color: var(--muted);">(기다리지 않고 다음 문제로 바로 넘어가셔도 됩니다)</span>
            </div>
            <div style="margin-top:0.8rem; background: rgba(0,0,0,0.2); padding: 0.8rem; border-radius: 6px;">
                <strong style="color:var(--primary);">모범 답안:</strong> 
                <span style="color:#fff; white-space: pre-wrap; line-height: 1.6; display: block;">${formatModelAnswer(q.answer, q.question)}</span>
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
            qState.grading = false; // Reset grading flag
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
                mode: state.quizMode,
                details: []
            };
            history.push(session);
        }
        
        const existingDetail = session.details.find(d => d.qIndex === savedIndex);
        if (!existingDetail) {
            session.details.push({
                qIndex: savedIndex,
                id: q.id,
                original_id: q.original_id,
                type: q.type,
                session: q.session,
                question: q.question,
                correct_answer: q.answer,
                user_answer: userAnswer,
                score: result.score,
                points: pts,
                is_correct: result.is_correct,
                feedback: result.feedback
            });
        } else {
            existingDetail.user_answer = userAnswer;
            existingDetail.score = result.score;
            existingDetail.is_correct = result.is_correct;
            existingDetail.feedback = result.feedback;
        }

        recalculateSessionScores(session);
        saveQuizSessionToStorage(session);
        saveQuizStateForRecovery();

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
        const qState = state.questionStates[savedIndex];
        if (qState) {
            qState.grading = false; // Reset grading flag
        }
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
                if (window.isFastPassMatch && window.isFastPassMatch(uAns, q.answer)) {
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
            mode: state.quizMode,
            details: []
        };

        let html = '';
        results.forEach((res, i) => {
            const q = state.questions[i];
            const pts = q.points ?? TYPE_POINTS[q.type] ?? 0;
            
            session.details.push({
                qIndex: i,
                id: q.id,
                original_id: q.original_id,
                type: q.type,
                session: q.session,
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
    clearQuizRecoveryState();
    
    const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
    const session = history.find(h => h.id === state.currentSessionId);
    
    if (!session || !session.details || session.details.length === 0) {
        alert('저장된 결과가 없습니다.');
        switchView('quiz-selection');
        return;
    }

    session.details.sort((a, b) => a.qIndex - b.qIndex);
    
    switchView('bulk-result-view');
    const container = document.getElementById('bulk-result-container');
    
    let html = '';
    session.details.forEach((d, i) => {
        const qKey = (d.original_id || d.id) + "_" + d.type;
        let bookmarkedFolders = [];
        if (bookmarkData && bookmarkData.folders) {
            bookmarkData.folders.forEach(f => {
                if (f.keys && f.keys.includes(qKey)) {
                    bookmarkedFolders.push(getFolderPathName(f.id));
                }
            });
        }
        
        const isBookmarked = bookmarkedFolders.length > 0;
        const starBtn = `
            <button onclick="openBookmarkModalFromResultList(${d.qIndex})" style="background: ${isBookmarked ? '#fbbf24' : 'rgba(251,191,36,0.05)'}; color: ${isBookmarked ? '#000' : '#fbbf24'}; border: 1px solid ${isBookmarked ? '#fbbf24' : 'rgba(251,191,36,0.3)'}; padding: 0.35rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 700; transition: 0.2s; display: flex; align-items: center; gap: 0.3rem;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                ⭐ ${isBookmarked ? `북마크됨 (${bookmarkedFolders.join(', ')})` : '다시 볼 문제'}
            </button>
        `;

        html += `
            <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid ${d.is_correct ? 'var(--primary)' : '#f87171'}">
                <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.8rem;">
                        <strong style="font-size: 1.2rem;">Q${i+1}.</strong>
                        ${starBtn}
                    </div>
                    <span style="font-size: 1.1rem; font-weight: 800; color: ${d.is_correct ? 'var(--primary)' : '#f87171'}">${d.score} / ${d.points}점</span>
                </div>
                <p style="color: #cbd5e1; margin-bottom: 1rem; line-height: 1.5;">${d.question}</p>
                <div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                    <strong style="color: var(--muted); display: block; margin-bottom: 0.5rem;">내 답안:</strong>
                    <span style="color: #fff; white-space: pre-wrap; line-height: 1.6; display: block;">${formatUserAnswer(d.user_answer)}</span>
                    <div style="margin-top: 0.8rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.8rem;">
                        <strong style="color: var(--primary); display: block; margin-bottom: 0.5rem;">모범 답안:</strong>
                        <span style="color: #fff; white-space: pre-wrap; line-height: 1.6; display: block;">${formatModelAnswer(d.correct_answer, d.question)}</span>
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
    if (state.quizMode !== 'study') {
        const currentIndex = state.index;
        const qState = state.questionStates[currentIndex];
        if (qState && !qState.scored && !qState.grading) {
            // Save answer typed so far
            saveAnswerRealtime();
            const uAns = state.userAnswers[currentIndex] || '미입력';
            
            // Retrieve session and save skipped details
            const history = JSON.parse(localStorage.getItem('quiz_sessions') || '[]');
            const session = history.find(h => h.id === state.currentSessionId);
            if (session && session.details) {
                const detail = session.details.find(d => d.qIndex === currentIndex);
                if (detail) {
                    detail.user_answer = uAns;
                    detail.score = 0;
                    detail.is_correct = false;
                    detail.feedback = '제출하지 않음 (건너뜀)';
                }
                recalculateSessionScores(session);
                saveQuizSessionToStorage(session);
            }
        }
    }

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
    
    // Restore or Reset Chat
    const qState = state.questionStates[index];
    if (qState && qState.chat && qState.chat.length > 0) {
        chatMessages.innerHTML = qState.chat.map(msg => {
            const cls = msg.role === 'user' ? 'user-message' : 'ai-message';
            return `<div class="chat-message ${cls}">${msg.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
        }).join('');
    } else {
        chatMessages.innerHTML = '<div class="chat-message ai-message">이 문제에 대해 궁금한 점을 질문하세요.</div>';
    }
    
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
        
        // --- GLOBAL AI CACHE CHECK ---
        let cachedExplanation = null;
        let questionHash = null;
        if (window.db) {
            try {
                // Ensure sha256 is available
                questionHash = typeof sha256 === 'function' ? await sha256(q.question.trim()) : null;
                if (questionHash) {
                    const cacheRef = window.db.collection('ai_cache_explanations').doc(questionHash);
                    const cacheSnap = await cacheRef.get();
                    if (cacheSnap.exists) {
                        cachedExplanation = cacheSnap.data().explanation;
                        console.log("[Cache Hit] Explanation loaded from Firestore global cache.");
                    }
                }
            } catch (ce) {
                console.warn("[Cache Read Error]", ce);
            }
        }
        
        if (cachedExplanation) {
            // CACHE HIT: Instantly display the explanation
            expStream.innerHTML = cachedExplanation + "\n\n<span style='color:#10b981; font-weight:bold; font-size:0.9em;'>(⚡ 글로벌 AI 캐시에서 즉시 불러왔습니다 - API 미호출)</span>";
            q.explanation = cachedExplanation;
            state.questionStates[index].explanation = cachedExplanation;
        } else {
            // CACHE MISS: Call Gemini API
            await geminiExplainStream(
                q.question, q.answer,
                (chunk) => {
                    accumulated += chunk;
                    expStream.textContent = accumulated;
                    state.questionStates[index].explanation = accumulated; // Persist locally
                },
                (status) => {
                    expStream.textContent = status;
                }
            );
            q.explanation = accumulated;
            
            // --- SAVE TO GLOBAL CACHE ---
            if (window.db && questionHash && accumulated.length > 50) {
                try {
                    await window.db.collection('ai_cache_explanations').doc(questionHash).set({
                        question: q.question,
                        explanation: accumulated,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    console.log("[Cache Write] Saved new explanation to Firestore global cache.");
                } catch (ce) {
                    console.warn("[Cache Write Error]", ce);
                }
            }
        }
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
    if (!msg || input.disabled) return;
    
    const q = state.questions[state.index];
    const qState = state.questionStates[state.index];
    const messagesContainer = document.getElementById('chat-messages');
    
    // Lock input
    input.disabled = true;
    
    // Add user message to state and UI
    if (!qState.chat) qState.chat = [];
    const history = [...qState.chat]; // slice copy of previous history
    qState.chat.push({ role: 'user', text: msg });
    
    messagesContainer.innerHTML += `<div class="chat-message user-message">${msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
    input.value = '';
    
    // AI 스트리밍 버블 생성
    const aiLoadingId = 'msg-' + Date.now();
    messagesContainer.innerHTML += `<div id="${aiLoadingId}" class="chat-message ai-message"></div>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    const aiMsgDiv = document.getElementById(aiLoadingId);
    
    try {
        let accumulated = '';
        await geminiChatStream(
            q.question, q.answer, q.explanation || '', msg, history,
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
        qState.chat.push({ role: 'ai', text: accumulated });
        
        // Save state recovery
        saveQuizStateForRecovery();
    } catch (e) {
        aiMsgDiv.textContent = '';
        aiMsgDiv.innerHTML = buildApiKeyErrorHTML(e.message, 'sendChatMessage()');
        aiMsgDiv.style.color = '';
        // Remove failed message from state
        qState.chat.pop();
    } finally {
        input.disabled = false;
        input.focus();
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ─── Quiz Recovery System ──────────────────────────────────
function saveQuizStateForRecovery() {
    if (state.view !== 'quiz-view' || !state.questions || state.questions.length === 0) {
        return;
    }
    const recoveryState = {
        questions: state.questions,
        index: state.index,
        timer: state.timer,
        quizMode: state.quizMode,
        userAnswers: state.userAnswers,
        questionStates: state.questionStates,
        currentSessionId: state.currentSessionId,
        quizTitle: document.getElementById('quiz-title')?.textContent || ''
    };
    localStorage.setItem('temp_quiz_recovery_state', JSON.stringify(recoveryState));
}

function clearQuizRecoveryState() {
    localStorage.removeItem('temp_quiz_recovery_state');
}

function restoreQuizStateIfAvailable() {
    const raw = localStorage.getItem('temp_quiz_recovery_state');
    if (!raw) return;
    try {
        const recovery = JSON.parse(raw);
        if (recovery && recovery.questions && recovery.questions.length > 0) {
            if (confirm(`진행 중이던 학습 세션("${recovery.quizTitle || '기출문제'}")이 있습니다. 이어서 풀어나가시겠습니까?`)) {
                state.questions = recovery.questions;
                state.index = recovery.index;
                state.timer = recovery.timer;
                state.quizMode = recovery.quizMode || 'immediate';
                state.userAnswers = recovery.userAnswers;
                state.questionStates = recovery.questionStates;
                state.currentSessionId = recovery.currentSessionId;
                
                clearInterval(state.timerInt);
                const m = String(Math.floor(state.timer / 60)).padStart(2, '0');
                const s = String(state.timer % 60).padStart(2, '0');
                document.getElementById('timer').textContent = `${m}:${s}`;
                
                state.timerInt = setInterval(() => {
                    state.timer++;
                    const min = String(Math.floor(state.timer / 60)).padStart(2, '0');
                    const sec = String(state.timer % 60).padStart(2, '0');
                    document.getElementById('timer').textContent = `${min}:${sec}`;
                    saveQuizStateForRecovery();
                }, 1000);
                
                switchView('quiz-view');
                document.getElementById('quiz-title').textContent = recovery.quizTitle || '기출문제';
                renderQuestion();
                return;
            }
        }
    } catch (e) {
        console.error('Failed to restore quiz state:', e);
    }
    clearQuizRecoveryState();
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
        saveQuizStateForRecovery();
    }, 1000);
}

let memoSyncTimeout = null;
function saveMemoDebounced(qKey, value) {
    let memos = JSON.parse(localStorage.getItem('question_memos') || '{}');
    memos[qKey] = value;
    localStorage.setItem('question_memos', JSON.stringify(memos));
    
    if (memoSyncTimeout) clearTimeout(memoSyncTimeout);
    memoSyncTimeout = setTimeout(async () => {
        await syncMemos(true);
    }, 1000);
}

async function syncMemos(overwriteRemote = false) {
    let local = JSON.parse(localStorage.getItem('question_memos') || '{}');
    
    if (db && loggedInUser && loggedInUser.username) {
        try {
            const docRef = db.collection('users').doc(loggedInUser.username);
            if (overwriteRemote) {
                await docRef.set({
                    memos: local
                }, { merge: true });
            } else {
                const docSnap = await docRef.get();
                if (docSnap.exists) {
                    const data = docSnap.data();
                    if (data.memos) {
                        local = { ...data.memos, ...local };
                    }
                }
                await docRef.set({
                    memos: local
                }, { merge: true });
            }
        } catch (e) {
            console.error('[Sync] Memos sync failed:', e);
        }
    }
    localStorage.setItem('question_memos', JSON.stringify(local));
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
    
    const memoPad = document.getElementById('memo-pad');
    if (memoPad) {
        memoPad.addEventListener('input', () => {
            const q = state.questions && state.questions[state.index];
            if (!q) return;
            const qKey = (q.original_id || q.id) + "_" + q.type;
            saveMemoDebounced(qKey, memoPad.innerHTML);
        });
        
        memoPad.addEventListener('keydown', e => {
            if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
                e.preventDefault();
                document.execCommand('bold', false, null);
                
                const q = state.questions && state.questions[state.index];
                if (q) {
                    const qKey = (q.original_id || q.id) + "_" + q.type;
                    saveMemoDebounced(qKey, memoPad.innerHTML);
                }
            }
        });
    }
});

document.getElementById('submit-btn').addEventListener('click', submitAnswer);
document.getElementById('prev-btn').addEventListener('click', () => {
    if (state.index > 0) { state.index--; renderQuestion(); }
});
document.getElementById('exit-quiz').addEventListener('click', () => {
    if (confirm('퀴즈를 종료하시겠습니까?')) {
        clearInterval(state.timerInt);
        clearQuizRecoveryState();
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
    let model = localStorage.getItem('gemini_model');
    if (model && model.includes('1.5')) {
        model = 'gemini-2.0-flash';
        localStorage.setItem('gemini_model', model);
    }
    const keyInput = document.getElementById('setting-api-key');
    const modelInput = document.getElementById('setting-model');
    if (key && keyInput) keyInput.value = key;
    if (model && modelInput) modelInput.value = model;
}

async function runConnectionTest() {
    const keyInput = document.getElementById('setting-api-key');
    const key = keyInput?.value?.trim() || localStorage.getItem('gemini_api_key') || '';
    const panel = document.getElementById('test-result-panel');
    if (!panel) return;
    
    panel.classList.remove('hidden');
    panel.style.color = '#38bdf8';
    panel.textContent = '⏳ 구글 Gemini API 채점 연결 및 검증 테스트 중...';
    
    if (!key) {
        panel.style.color = '#f87171';
        panel.textContent = '❌ 오류: 설정에 입력된 API 키가 없습니다. API 키를 먼저 입력해 주세요.';
        return;
    }
    const modelInput = document.getElementById('setting-model');
    const preferredModel = modelInput?.value || (typeof getGeminiModel === 'function' ? getGeminiModel() : null) || localStorage.getItem('gemini_model') || 'gemini-2.0-flash';
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${preferredModel}:generateContent?key=${key}`;
    
    const bodyPayload = {
        contents: [{ parts: [{ text: "Hello, this is a test. Answer with 'OK' in JSON format." }] }],
        generationConfig: { 
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 50,
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    status: { type: 'STRING' }
                },
                required: ['status']
            }
        }
    };
    
    try {
        const startTime = Date.now();
        const res = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
        });
        const duration = Date.now() - startTime;
        
        let text = await res.text();
        panel.style.color = res.ok ? '#4ade80' : '#f87171';
        
        let statusMsg = res.ok ? '✅ 연결 및 채점 API 호출 성공!' : `❌ 채점 API 호출 실패 (HTTP 상태 코드: ${res.status})`;
        let detail = `응답 시간: ${duration}ms\n\n`;
        
        if (res.status === 429) {
            detail += `⚠️ 안내: API 호출 제한(Quota Exceeded)이 발생했습니다.\n`;
            detail += `- 이 오류는 등록하신 API 키의 일일 호출 한도(1,500회)를 초과했거나 짧은 시간 동안 너무 많은 요청(분당 15회)을 보내 일시적으로 차단된 상태임을 나타냅니다.\n`;
            detail += `- 조치 방법: Google AI Studio (https://aistudio.google.com/)에 접속하여 새 프로젝트(New Project)를 생성해 키를 재발급받으시거나, 다른 구글 계정으로 새 API 키를 생성하여 등록하시면 즉시 해결됩니다.\n\n`;
        }
        
        try {
            const json = JSON.parse(text);
            detail += `상세 응답 내용:\n` + JSON.stringify(json, null, 2);
        } catch (e) {
            detail += `[주의: JSON이 아닌 응답 본문이 반환되었습니다]\n\n`;
            detail += text.slice(0, 1000) + (text.length > 1000 ? '\n... (이하 생략)' : '');
        }
        
        panel.textContent = `${statusMsg}\n${detail}`;
    } catch (err) {
        panel.style.color = '#f87171';
        panel.textContent = `❌ 네트워크 오류 (연결 실패)\n상세 내용: ${err.message}`;
    }
}

window.saveSettings = saveSettings;
window.runConnectionTest = runConnectionTest;

window.checkAvailableModels = async function() {
    const keyInput = document.getElementById('setting-api-key');
    const key = keyInput?.value?.trim() || localStorage.getItem('gemini_api_key') || '';
    const panel = document.getElementById('test-result-panel');
    if (!panel) return;
    
    panel.classList.remove('hidden');
    panel.style.color = '#10b981';
    panel.textContent = '⏳ 구글 서버 조회 및 실제 사용 가능 여부(한도) 테스트 중... (약 2~3초 소요)';
    
    if (!key) {
        panel.style.color = '#f87171';
        panel.textContent = '❌ 오류: 설정에 입력된 API 키가 없습니다. API 키를 먼저 입력해 주세요.';
        return;
    }
    
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        
        // Filter generateContent models
        const generateModels = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent'));
        const allModelNames = generateModels.map(m => m.name.replace('models/', ''));
        
        // We only test the main models to avoid hitting the 15 RPM rate limit
        const targetModelsToTest = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash-8b'];
        const modelsToTest = targetModelsToTest.filter(m => allModelNames.includes(m));
        
        const workingModels = [];
        
        for (const modelName of modelsToTest) {
            try {
                const testRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: "ping" }] }],
                        generationConfig: { maxOutputTokens: 1 }
                    })
                });
                if (testRes.ok) {
                    workingModels.push(modelName);
                }
            } catch (e) {
                // Ignore network errors for individual models
            }
        }
        
        if (workingModels.length === 0) {
            panel.style.color = '#f87171';
            panel.textContent = '❌ 실제 사용 가능한 모델이 하나도 없습니다. (모두 한도 초과 또는 차단됨)\n새 API 키를 발급받아 주세요.';
            return;
        }

        // Dynamically update the dropdown with ONLY working models
        const modelSelect = document.getElementById('setting-model');
        if (modelSelect) {
            const currentSelected = modelSelect.value;
            modelSelect.innerHTML = '';
            
            workingModels.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                if (name === 'gemini-2.5-flash') option.textContent = name + ' (최신/초고속 추천)';
                else if (name === 'gemini-2.0-flash') option.textContent = name + ' (안정적 최신 권장)';
                else option.textContent = name;
                
                modelSelect.appendChild(option);
            });
            
            if (workingModels.includes(currentSelected)) {
                modelSelect.value = currentSelected;
            } else {
                modelSelect.value = workingModels[0]; // Select the first working model automatically
            }
        }
        
        let output = `✅ 내 API 키로 "실제" 사용 가능한 텍스트 생성 모델 목록:\n\n`;
        workingModels.forEach(name => {
            output += `🔹 ${name}\n`;
        });
        
        output += `\n💡 현재 API 키의 사용 한도(Quota)가 정상적으로 남아있는 모델만 필터링하였습니다.\n위 설정창의 [AI 모델 선택] 메뉴에서 해당 모델을 선택해 주세요.`;
        panel.textContent = output;
        
    } catch (err) {
        panel.style.color = '#f87171';
        panel.textContent = `❌ 조회 실패\n원인: ${err.message}`;
    }
};

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
        window.db = db;
        // Force long polling to bypass strict network environments (solves hanging logins & admin panels)
        db.settings({ experimentalForceLongPolling: true });
        // Enable offline persistence for instant local reads
        db.enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.warn('Firestore persistence error:', err.code);
        });
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
window.sha256 = sha256;

// Auto-initialize Admin account in Firestore if not exists
async function initAdminAccount() {
    if (!db) return;
    try {
        const adminDocRef = db.collection('users').doc('admin');
        const docSnap = await adminDocRef.get();
        const adminHash = await sha256('admin123');
        if (!docSnap.exists) {
            await adminDocRef.set({
                username: 'admin',
                passwordHash: adminHash,
                isAdmin: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Auth] Admin account pre-configured in Firestore.');
        } else {
            // Force update password to admin123 if not already set
            const data = docSnap.data();
            if (data.passwordHash !== adminHash) {
                await adminDocRef.set({
                    passwordHash: adminHash,
                    isAdmin: true
                }, { merge: true });
                console.log('[Auth] Admin account password force updated in Firestore.');
            }
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
    let docSnap;
    try {
        // First try to fetch from local cache for instant login
        docSnap = await userDocRef.get({ source: 'cache' });
    } catch (cacheErr) {
        // Fallback to server if not in cache (first time login on this device)
        docSnap = await userDocRef.get({ source: 'server' });
    }

    if (!docSnap || !docSnap.exists) {
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

    // Sync statistics history and bookmarks in background to speed up login
    Promise.all([
        syncStatsFromFirestore(userData.username),
        syncBookmarks()
    ]).then(() => {
        // Re-render dashboard to show synced stats
        if (typeof renderDashboard === 'function') renderDashboard();
    });

    // Apply login UI state immediately
    applyLoginState();
}

// Logout
function handleLogout() {
    localStorage.removeItem('is_logged_in_user');
    localStorage.removeItem('quiz_sessions');
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('gemini_model');
    localStorage.removeItem('review_bookmarks');
    localStorage.removeItem('question_memos');
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
    if (state.quizMode === 'study' || (session && session.mode === 'study')) {
        return;
    }
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
    const originalText = submitBtn.textContent;
    submitBtn.innerHTML = '인증 처리 중... ⏳';

    try {
        if (isSignupMode) {
            submitBtn.innerHTML = '가입 처리 중... ⏳';
            await handleSignup(username, password);
            msgEl.className = 'login-message success';
            msgEl.textContent = '회원가입이 완료되었습니다! 로그인 창에서 로그인해 주세요.';
            msgEl.classList.remove('hidden');
            toggleLoginSignup();
        } else {
            // First time connection to Firestore might take a few seconds
            await handleLogin(username, password);
        }
    } catch (err) {
        msgEl.className = 'login-message error';
        msgEl.textContent = err.message || '요청을 처리하는 데 실패했습니다.';
        msgEl.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.textContent = originalText;
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

let bookmarkData = { folders: [] };

// ─── Hierarchical Folder Helpers ─────────────────────────────────────
function getBreadcrumbs(folderId) {
    const crumbs = [];
    let current = bookmarkData.folders.find(f => f.id === folderId);
    while (current) {
        crumbs.unshift(current);
        current = current.parentId ? bookmarkData.folders.find(f => f.id === current.parentId) : null;
    }
    return crumbs;
}

function getFolderKeysRecursive(folderId, keysSet = new Set()) {
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (folder && folder.keys) {
        folder.keys.forEach(k => keysSet.add(k));
    }
    const children = bookmarkData.folders.filter(f => f.parentId === folderId);
    children.forEach(child => getFolderKeysRecursive(child.id, keysSet));
    return keysSet;
}

function getIndentedFolderOptions(folders, parentId = null, depth = 0, qKey) {
    const list = folders.filter(f => f.parentId === parentId || (!parentId && !f.parentId));
    let html = '';
    list.forEach(f => {
        const indent = '&nbsp;&nbsp;'.repeat(depth) + (depth > 0 ? '└─ ' : '');
        const isSaved = f.keys && f.keys.includes(qKey);
        const disabledAttr = isSaved ? 'disabled' : '';
        const suffix = isSaved ? ' (저장됨)' : ` (${f.keys ? f.keys.length : 0}개)`;
        html += `<option value="${f.id}" ${disabledAttr}>${indent}📁 ${f.name}${suffix}</option>`;
        html += getIndentedFolderOptions(folders, f.id, depth + 1, qKey);
    });
    return html;
}

function getHierarchicalMoveButtons(folders, parentId = null, depth = 0, sourceFolderId, qKey) {
    const list = folders.filter(f => f.parentId === parentId || (!parentId && !f.parentId));
    let html = '';
    list.forEach(f => {
        const indentPadding = depth * 1.5;
        const isSource = f.id === sourceFolderId;
        
        if (isSource) {
            html += `
                <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); color: var(--muted); padding: 0.8rem; border-radius: 8px; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; justify-content: space-between; margin-left: ${indentPadding}rem; opacity: 0.5;">
                    <span>📁 ${f.name} (현재 폴더)</span>
                </div>
            `;
        } else {
            html += `
                <button onclick="submitMoveQuestionFolder('${sourceFolderId}', '${f.id}', '${qKey}')" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); color: #fff; padding: 0.8rem; border-radius: 8px; cursor: pointer; text-align: left; font-size: 0.95rem; font-weight: 600; transition: 0.2s; display: flex; align-items: center; justify-content: space-between; margin-left: ${indentPadding}rem;" onmouseover="this.style.background='rgba(251,191,36,0.1)'; this.style.borderColor='rgba(251,191,36,0.3)';" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.05)';">
                    <span>📁 ${f.name}</span>
                    <span style="font-size: 0.8rem; color: #94a3b8;">${f.keys ? f.keys.length : 0}개 문제</span>
                </button>
            `;
        }
        
        html += getHierarchicalMoveButtons(folders, f.id, depth + 1, sourceFolderId, qKey);
    });
    return html;
}

function deleteFolderRecursive(folderId) {
    const children = bookmarkData.folders.filter(f => f.parentId === folderId);
    children.forEach(child => deleteFolderRecursive(child.id));
    bookmarkData.folders = bookmarkData.folders.filter(f => f.id !== folderId);
}

window.addNewSubfolder = function(parentId, event) {
    if (event) event.stopPropagation();
    const title = document.getElementById('custom-dialog-title');
    const body = document.getElementById('custom-dialog-body');
    const actions = document.getElementById('custom-dialog-actions');
    
    title.innerHTML = '📁 새 하위 폴더 추가';
    body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
            <label style="font-size: 0.85rem; color: #94a3b8; font-weight: 600; text-align: left;">생성할 하위 폴더명을 입력해 주세요.</label>
            <input type="text" id="dialog-subfolder-name" placeholder="하위 폴더명 입력..." style="background: #0f172a; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 0.7rem; border-radius: 8px; font-size: 0.95rem; outline: none; width: 100%;" />
        </div>
    `;
    
    actions.innerHTML = `
        <button onclick="closeCustomDialog()" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #cbd5e1; padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">취소</button>
        <button onclick="submitNewSubfolderFromDialog('${parentId}')" style="background: #fbbf24; border: none; color: #000; padding: 0.6rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='#f59e0b'" onmouseout="this.style.background='#fbbf24'">폴더 생성</button>
    `;
    
    openCustomDialog();
    setTimeout(() => {
        const input = document.getElementById('dialog-subfolder-name');
        if (input) input.focus();
    }, 100);
};

window.submitNewSubfolderFromDialog = async function(parentId) {
    const input = document.getElementById('dialog-subfolder-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
        alert('폴더 이름을 입력해 주세요.');
        return;
    }
    
    const siblings = bookmarkData.folders.filter(f => f.parentId === parentId);
    if (siblings.some(f => f.name === name)) {
        alert('이미 존재하는 하위 폴더 이름입니다.');
        return;
    }
    
    bookmarkData.folders.push({
        id: 'folder_' + Date.now(),
        name: name,
        parentId: parentId,
        keys: []
    });
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    closeCustomDialog();
    
    if (!state.expandedBookmarkFolderIds) state.expandedBookmarkFolderIds = [];
    if (!state.expandedBookmarkFolderIds.includes(parentId)) {
        state.expandedBookmarkFolderIds.push(parentId);
    }
    renderBookmarkFoldersList();
};

window.getFolderPathName = function(folderId) {
    const path = [];
    let currentId = folderId;
    const visited = new Set();
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const folder = bookmarkData.folders.find(f => f.id === currentId);
        if (!folder) break;
        path.unshift(folder.name);
        currentId = folder.parentId;
    }
    return path.join(' > ');
};

window.updateBookmarkButtonState = function() {
    const btn = document.getElementById('bookmark-btn');
    if (!btn) return;
    const q = state.questions && state.questions[state.index];
    if (!q) return;
    
    const qKey = (q.original_id || q.id) + "_" + q.type;
    
    let bookmarkedFolders = [];
    bookmarkData.folders.forEach(f => {
        if (f.keys && f.keys.includes(qKey)) {
            bookmarkedFolders.push(getFolderPathName(f.id));
        }
    });
    
    if (bookmarkedFolders.length > 0) {
        btn.innerHTML = `⭐ 북마크됨 (${bookmarkedFolders.join(', ')})`;
        btn.style.background = '#fbbf24';
        btn.style.color = '#000';
        btn.style.borderColor = '#fbbf24';
    } else {
        btn.innerHTML = '⭐ 다시 볼 문제';
        btn.style.background = 'rgba(251, 191, 36, 0.15)';
        btn.style.color = '#fbbf24';
        btn.style.borderColor = 'rgba(251, 191, 36, 0.3)';
    }
};

async function syncBookmarks(overwriteRemote = false) {
    let local = JSON.parse(localStorage.getItem('review_bookmarks') || '{"folders":[]}');
    if (!local.folders) local = { folders: [] };
    
    if (db && loggedInUser && loggedInUser.username) {
        try {
            const docRef = db.collection('users').doc(loggedInUser.username);
            if (overwriteRemote) {
                // User modified bookmarks locally: overwrite Firestore copy with local state
                await docRef.set({
                    bookmarks: local
                }, { merge: true });
            } else {
                // Initial load: pull from Firestore and merge with local state
                const docSnap = await docRef.get();
                if (docSnap.exists) {
                    const data = docSnap.data();
                    if (data.bookmarks && data.bookmarks.folders) {
                        const remoteFolders = data.bookmarks.folders;
                        remoteFolders.forEach(rf => {
                            const localFolder = local.folders.find(f => f.id === rf.id || f.name === rf.name);
                            if (localFolder) {
                                localFolder.keys = [...new Set([...(localFolder.keys || []), ...(rf.keys || [])])];
                            } else {
                                local.folders.push(rf);
                            }
                        });
                    }
                }
                // Save the merged state back to Firestore
                await docRef.set({
                    bookmarks: local
                }, { merge: true });
            }
        } catch (e) {
            console.error('[Sync] Bookmarks sync failed:', e);
        }
    }
    
    // Migrate depth 2+ folders to depth 1 (flatten hierarchy)
    if (local.folders) {
        local.folders.forEach(f => {
            if (f.parentId) {
                const parent = local.folders.find(p => p.id === f.parentId);
                if (parent && parent.parentId) {
                    // Parent is a subfolder itself! Move f to grandparent
                    f.parentId = parent.parentId;
                }
            }
        });
    }
    
    bookmarkData = local;
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    updateBookmarkButtonState();
}

window.openBookmarkModal = function(customIndex = null) {
    const targetIndex = customIndex !== null ? customIndex : state.index;
    const q = state.questions && state.questions[targetIndex];
    if (!q) {
        alert('현재 선택된 문제가 없습니다.');
        return;
    }
    
    state.bookmarkModalTargetIndex = targetIndex;
    const qKey = (q.original_id || q.id) + "_" + q.type;
    
    // 1. Render currently saved folders
    const savedFolders = bookmarkData.folders.filter(f => f.keys && f.keys.includes(qKey));
    const listContainer = document.getElementById('modal-current-bookmarks-list');
    
    if (listContainer) {
        if (savedFolders.length === 0) {
            listContainer.innerHTML = '<div style="color:var(--muted); font-size:0.9rem; padding: 0.2rem 0; text-align: left;">현재 이 문제는 저장된 폴더가 없습니다.</div>';
        } else {
            listContainer.innerHTML = savedFolders.map(f => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:0.5rem 0.8rem; border-radius:8px;">
                    <span style="font-size:0.95rem; color:#fff; font-weight:600; text-align:left;">📁 ${getFolderPathName(f.id)}</span>
                    <button onclick="unbookmarkFromFolderInModal('${f.id}')" style="background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.2); padding:0.25rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:700; transition:0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.2)'" onmouseout="this.style.background='rgba(239,68,68,0.1)'">해제</button>
                </div>
            `).join('');
        }
    }
    
    // 2. Render dropdown option folders (excluding already saved folders)
    const select = document.getElementById('bookmark-folder-select');
    if (select) {
        const optionsHtml = getIndentedFolderOptions(bookmarkData.folders, null, 0, qKey);
        if (!optionsHtml) {
            select.innerHTML = '<option value="">(생성된 폴더가 없습니다)</option>';
            select.disabled = true;
        } else {
            select.innerHTML = optionsHtml;
            select.disabled = false;
        }
    }
    
    const modal = document.getElementById('bookmark-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
};

window.openBookmarkModalFromResultList = function(qIndex) {
    openBookmarkModal(qIndex);
};

window.unbookmarkFromFolderInModal = async function(folderId) {
    const targetIndex = state.bookmarkModalTargetIndex !== undefined ? state.bookmarkModalTargetIndex : state.index;
    const q = state.questions && state.questions[targetIndex];
    if (!q) return;
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const qKey = (q.original_id || q.id) + "_" + q.type;
    folder.keys = folder.keys.filter(k => k !== qKey);
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    
    openBookmarkModal(targetIndex);
    
    // Refresh result list if result view is currently open
    if (state.view === 'bulk-result-view') {
        showSessionResult();
    }
};

window.closeBookmarkModal = function() {
    const modal = document.getElementById('bookmark-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    const newFolderInput = document.getElementById('new-folder-name');
    if (newFolderInput) newFolderInput.value = '';
};

window.createNewBookmarkFolder = async function() {
    const input = document.getElementById('new-folder-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
        alert('폴더 이름을 입력해 주세요.');
        return;
    }
    if (bookmarkData.folders.some(f => f.name === name)) {
        alert('이미 존재하는 폴더 이름입니다.');
        return;
    }
    
    const newFolder = {
        id: 'folder_' + Date.now(),
        name: name,
        keys: []
    };
    bookmarkData.folders.push(newFolder);
    
    const select = document.getElementById('bookmark-folder-select');
    if (select) {
        select.innerHTML = bookmarkData.folders.map(f => 
            `<option value="${f.id}">${f.name} (${f.keys ? f.keys.length : 0}개)</option>`
        ).join('');
        select.value = newFolder.id;
    }
    
    input.value = '';
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    
    const targetIndex = state.bookmarkModalTargetIndex !== undefined ? state.bookmarkModalTargetIndex : state.index;
    openBookmarkModal(targetIndex);
    
    alert('새 폴더가 생성되었습니다.');
};

window.saveQuestionToBookmark = async function() {
    const targetIndex = state.bookmarkModalTargetIndex !== undefined ? state.bookmarkModalTargetIndex : state.index;
    const q = state.questions && state.questions[targetIndex];
    if (!q) return;
    
    const select = document.getElementById('bookmark-folder-select');
    const folderId = select ? select.value : '';
    if (!folderId) {
        alert('폴더를 선택하거나 새로 생성해 주세요.');
        return;
    }
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const qKey = (q.original_id || q.id) + "_" + q.type;
    if (!folder.keys) folder.keys = [];
    
    if (folder.keys.includes(qKey)) {
        alert('이미 이 폴더에 저장된 문제입니다.');
        closeBookmarkModal();
        return;
    }
    
    folder.keys.push(qKey);
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    updateBookmarkButtonState();
    
    const btn = document.getElementById('bookmark-btn');
    if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '⭐ 저장 완료!';
        btn.style.background = 'rgba(16, 185, 129, 0.2)';
        btn.style.color = '#10b981';
        btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        setTimeout(() => {
            updateBookmarkButtonState();
        }, 1500);
    }
    
    // Refresh result list if result view is currently open
    if (state.view === 'bulk-result-view') {
        showSessionResult();
    }
    
    closeBookmarkModal();
};

window.toggleBookmarkSelection = async function() {
    const sub = document.getElementById('sub-list');
    if (state.subMode === 'bookmark') {
        sub.classList.add('hidden');
        state.subMode = null;
        return;
    }
    state.subMode = 'bookmark';
    sub.style.display = 'block';
    sub.classList.remove('hidden');
    
    if (!state.allQuestions) {
        sub.innerHTML = '<div style="color:var(--muted);padding:1rem">불러오는 중...</div>';
        try {
            const res = await fetch('./data/questions_all.json?t=' + Date.now());
            const data = await res.json();
            state.allQuestions = data.questions || [];
        } catch (e) {
            console.error('Failed to preload questions:', e);
        }
    }
    
    renderBookmarkFoldersList();
};

function renderBookmarkFoldersList() {
    const sub = document.getElementById('sub-list');
    if (!sub) return;
    
    if (!state.selectedBookmarkFolderIds) {
        state.selectedBookmarkFolderIds = [];
    }
    
    const selectedCount = state.selectedBookmarkFolderIds.length;
    let selectionActionBar = '';
    if (selectedCount > 0) {
        const selectedFoldersObj = bookmarkData.folders.filter(f => state.selectedBookmarkFolderIds.includes(f.id));
        const allKeys = new Set();
        selectedFoldersObj.forEach(f => {
            getFolderKeysRecursive(f.id, allKeys);
        });
        
        selectionActionBar = `
            <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px; padding: 1rem 1.2rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="text-align: left;">
                    <strong style="color: #fbbf24; font-size: 1rem; display: block;">📂 ${selectedCount}개 폴더 선택됨</strong>
                    <span style="color: #cbd5e1; font-size: 0.85rem;">중복 제외 총 ${allKeys.size}개 문항</span>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button onclick="startSelectedFoldersQuiz(false)" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">▶️ 순차 풀기</button>
                    <button onclick="startSelectedFoldersQuiz(true)" style="background: #fbbf24; color: #000; border: none; padding: 0.5rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 800; transition: 0.2s;" onmouseover="this.style.background='#f59e0b'" onmouseout="this.style.background='#fbbf24'">🔀 랜덤 풀기</button>
                </div>
            </div>
        `;
    }
    
    const allFolderIds = bookmarkData.folders.map(f => f.id);
    const isAllFoldersChecked = allFolderIds.length > 0 && allFolderIds.every(id => state.selectedBookmarkFolderIds.includes(id));
    
    const selectAllFoldersBar = bookmarkData.folders.length > 0 ? `
        <div style="display: flex; align-items: center; gap: 0.6rem; background: rgba(255,255,255,0.02); padding: 0.6rem 1.2rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03); width: 100%; margin-bottom: 0.8rem; text-align: left; box-sizing: border-box;">
            <input type="checkbox" ${isAllFoldersChecked ? 'checked' : ''} onclick="toggleSelectAllFolders(event)" style="width: 1.15rem; height: 1.15rem; accent-color: #fbbf24; cursor: pointer; margin: 0;" />
            <span style="font-size: 0.88rem; color: #cbd5e1; font-weight: 600; cursor: pointer; user-select: none;" onclick="toggleSelectAllFolders(event)">📂 모든 폴더 선택 (${bookmarkData.folders.length}개)</span>
        </div>
    ` : '';
    
    sub.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 1.2rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span style="color: #cbd5e1; font-weight: 700; font-size: 1.05rem;">📂 북마크 폴더 관리</span>
            <button onclick="addNewFolderFromDashboard()" style="background: #fbbf24; color: #000; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='#f59e0b'" onmouseout="this.style.background='#fbbf24'">
                ➕ 새 폴더 추가
            </button>
        </div>
        
        ${selectAllFoldersBar}
        ${selectionActionBar}
        
        <div style="display: flex; flex-direction: column; gap: 0.8rem; width: 100%;">
            ${renderFolderTree(null, 0)}
        </div>
    `;
}

function renderFolderTree(parentId = null, depth = 0) {
    const folders = bookmarkData.folders.filter(f => f.parentId === parentId || (!parentId && !f.parentId));
    if (folders.length === 0) return '';
    
    return folders.map(f => {
        const isExpanded = state.expandedBookmarkFolderIds && state.expandedBookmarkFolderIds.includes(f.id);
        const isChecked = state.selectedBookmarkFolderIds && state.selectedBookmarkFolderIds.includes(f.id);
        const indentPadding = depth * 1.5;
        
        const folderQuestions = (state.allQuestions || []).filter(q => {
            const qKey = (q.original_id || q.id) + "_" + q.type;
            return f.keys && f.keys.includes(qKey);
        });
        
        const hasSubfolders = bookmarkData.folders.some(sf => sf.parentId === f.id);
        const totalSubQuestionsCount = getFolderKeysRecursive(f.id).size;
        
        let folderHeader = `
            <div class="item-row" onclick="toggleFolderExpand('${f.id}', event)" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 1rem 1.2rem; background: rgba(30, 41, 59, 0.7); border: 1px solid ${isChecked ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.05)'}; border-radius: 12px; margin-left: ${indentPadding}rem; margin-top: 0.3rem; transition: 0.2s;" onmouseover="this.style.borderColor='rgba(251,191,36,0.3)'" onmouseout="this.style.borderColor='${isChecked ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.05)'}'">
                <div style="display: flex; align-items: center; gap: 0.8rem; flex: 1; min-width: 0;">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onclick="toggleSelectFolder('${f.id}', event)" style="width: 1.25rem; height: 1.25rem; accent-color: #fbbf24; cursor: pointer; flex-shrink: 0;" />
                    <div style="flex: 1; text-align: left; min-width: 0; padding-right: 0.5rem;">
                        <strong style="font-size: 1.05rem; color: #fff; display: flex; align-items: center; gap: 0.4rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <span>${isExpanded ? '📂' : '📁'} ${f.name}</span>
                            <span style="font-size: 0.8rem; color: var(--muted); font-weight: 500;">
                                (${f.keys ? f.keys.length : 0}개 문제${hasSubfolders ? `, 총 ${totalSubQuestionsCount}개` : ''})
                            </span>
                        </strong>
                    </div>
                </div>
                <div style="display: flex; gap: 0.3rem; z-index: 10; flex-shrink: 0; align-items: center;">
                    ${depth === 0 ? `
                        <button onclick="addNewSubfolder('${f.id}', event)" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.2)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.1)'">
                            ➕ 하위 폴더
                        </button>
                    ` : ''}
                    ${folderQuestions.length > 0 ? `
                        <button onclick="startBookmarkFolderQuiz('${f.id}', false, event)" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2); padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(251, 191, 36, 0.2)'" onmouseout="this.style.background='rgba(251, 191, 36, 0.1)'">▶️ 풀기</button>
                    ` : ''}
                    <button onclick="renameBookmarkFolder('${f.id}', event)" style="background: rgba(255, 255, 255, 0.05); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); padding: 0.35rem 0.5rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'">
                        ✏️ 수정
                    </button>
                    <button onclick="deleteBookmarkFolder('${f.id}', event)" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.35rem 0.5rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'">
                        🗑️ 삭제
                    </button>
                </div>
            </div>
        `;
        
        let folderDetails = '';
        if (isExpanded) {
            const folderQKeys = f.keys || [];
            const selectedFolderQKeys = folderQKeys.filter(k => state.selectedBookmarkQuestionKeys && state.selectedBookmarkQuestionKeys.includes(k));
            
            let batchActionBar = '';
            if (selectedFolderQKeys.length > 0) {
                batchActionBar = `
                    <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 0.8rem 1rem; display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 0.5rem;">
                        <span style="color: #60a5fa; font-size: 0.85rem; font-weight: 700;">📝 ${selectedFolderQKeys.length}개 선택됨</span>
                        <div style="display: flex; gap: 0.4rem;">
                            <button onclick="moveMultipleQuestionsFolderFromTree('${f.id}', event)" style="background: #3b82f6; color: #fff; border: none; padding: 0.35rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 800; transition: 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">일괄 이동</button>
                            <button onclick="removeMultipleQuestionsFromFolderFromTree('${f.id}', event)" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; padding: 0.35rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.25)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.15)'">일괄 삭제</button>
                        </div>
                    </div>
                `;
            }
            
            const isAllChecked = folderQuestions.length > 0 && folderQuestions.every(q => {
                const qKey = (q.original_id || q.id) + "_" + q.type;
                return state.selectedBookmarkQuestionKeys && state.selectedBookmarkQuestionKeys.includes(qKey);
            });
            
            const selectAllBar = folderQuestions.length > 0 ? `
                <div style="display: flex; align-items: center; gap: 0.6rem; background: rgba(255,255,255,0.02); padding: 0.5rem 0.8rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.03); width: 100%; margin-bottom: 0.5rem;">
                    <input type="checkbox" ${isAllChecked ? 'checked' : ''} onclick="toggleSelectAllQuestionsFromTree('${f.id}', event)" style="width: 1.1rem; height: 1.1rem; accent-color: #3b82f6; cursor: pointer;" />
                    <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 600;">전체 선택 (${folderQuestions.length}개 문제)</span>
                </div>
            ` : '';
            
            let questionsListHtml = '';
            if (folderQuestions.length === 0) {
                if (!hasSubfolders) {
                    questionsListHtml = `<div style="color: var(--muted); text-align: center; padding: 1.5rem; font-size: 0.9rem; width: 100%;">이 폴더에 저장된 문제가 없습니다.</div>`;
                }
            } else {
                questionsListHtml = folderQuestions.map(q => {
                    const snippet = q.question.substring(0, 100).replace(/\n/g, ' ') + (q.question.length > 100 ? '...' : '');
                    const qKey = (q.original_id || q.id) + "_" + q.type;
                    const isQuestionChecked = state.selectedBookmarkQuestionKeys && state.selectedBookmarkQuestionKeys.includes(qKey);
                    return `
                        <div style="display: flex; align-items: center; background: rgba(30, 41, 59, 0.4); border: 1px solid ${isQuestionChecked ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.03)'}; border-radius: 8px; padding: 0.6rem 0.8rem; gap: 0.8rem; width: 100%;">
                            <input type="checkbox" ${isQuestionChecked ? 'checked' : ''} onclick="toggleSelectQuestionFromTree('${f.id}', '${qKey}', event)" style="width: 1.1rem; height: 1.1rem; accent-color: #3b82f6; cursor: pointer; flex-shrink: 0;" />
                            <div onclick="viewSingleBookmarkQuestion('${f.id}', '${qKey}')" style="flex: 1; text-align: left; cursor: pointer; min-width: 0;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                                <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 700; background: rgba(251, 191, 36, 0.1); padding: 0.15rem 0.4rem; border-radius: 4px; margin-right: 0.4rem;">${TYPE_LABEL[q.type]}</span>
                                <span style="font-size: 0.8rem; color: var(--muted); font-weight: 500;">${q.session} - ${q.original_id || q.id}번</span>
                                <div style="color: #cbd5e1; font-size: 0.9rem; font-weight: 500; margin-top: 0.3rem; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${snippet}</div>
                            </div>
                            <div style="display: flex; gap: 0.2rem; flex-shrink: 0; z-index: 10;">
                                <button onclick="moveQuestionFolderFromTree('${f.id}', '${qKey}', event)" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); padding: 0.35rem 0.5rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.2)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.1)'">📂 이동</button>
                                <button onclick="removeQuestionFromFolderFromTree('${f.id}', '${qKey}', event)" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.35rem 0.5rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'">❌ 삭제</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            
            folderDetails = `
                <div style="margin-left: ${indentPadding}rem; border-left: 2px solid rgba(255,255,255,0.05); padding-left: 1rem; margin-top: 0.5rem; margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
                    ${renderFolderTree(f.id, depth + 1)}
                    ${batchActionBar}
                    ${selectAllBar}
                    <div style="display: flex; flex-direction: column; gap: 0.4rem; width: 100%;">
                        ${questionsListHtml}
                    </div>
                </div>
            `;
        }
        
        return `
            <div style="display: flex; flex-direction: column; width: 100%;">
                ${folderHeader}
                ${folderDetails}
            </div>
        `;
    }).join('');
}

window.toggleSelectFolder = function(folderId, event) {
    if (event) event.stopPropagation();
    if (!state.selectedBookmarkFolderIds) {
        state.selectedBookmarkFolderIds = [];
    }
    const idx = state.selectedBookmarkFolderIds.indexOf(folderId);
    if (idx > -1) {
        state.selectedBookmarkFolderIds.splice(idx, 1);
    } else {
        state.selectedBookmarkFolderIds.push(folderId);
    }
    renderBookmarkFoldersList();
};

window.toggleSelectAllFolders = function(event) {
    if (event) event.stopPropagation();
    if (!state.selectedBookmarkFolderIds) {
        state.selectedBookmarkFolderIds = [];
    }
    
    const allFolderIds = bookmarkData.folders.map(f => f.id);
    const isAllChecked = allFolderIds.length > 0 && allFolderIds.every(id => state.selectedBookmarkFolderIds.includes(id));
    
    if (isAllChecked) {
        state.selectedBookmarkFolderIds = [];
    } else {
        state.selectedBookmarkFolderIds = [...allFolderIds];
    }
    renderBookmarkFoldersList();
};

window.startSelectedFoldersQuiz = async function(shuffle = false) {
    if (!state.selectedBookmarkFolderIds || state.selectedBookmarkFolderIds.length === 0) return;
    
    const selectedFoldersObj = bookmarkData.folders.filter(f => state.selectedBookmarkFolderIds.includes(f.id));
    const allKeys = new Set();
    selectedFoldersObj.forEach(f => {
        getFolderKeysRecursive(f.id, allKeys);
    });
    
    if (allKeys.size === 0) {
        alert('선택한 폴더들에 저장된 문제가 없습니다.');
        return;
    }
    
    try {
        const res = await fetch('./data/questions_all.json?t=' + Date.now());
        const data = await res.json();
        const allQuestions = data.questions || [];
        
        let matchingQuestions = allQuestions.filter(q => {
            const qKey = (q.original_id || q.id) + "_" + q.type;
            return allKeys.has(qKey);
        });
        
        if (matchingQuestions.length === 0) {
            alert('선택한 폴더의 문제들을 데이터베이스에서 찾을 수 없습니다.');
            return;
        }
        
        if (shuffle) {
            matchingQuestions = [...matchingQuestions].sort(() => Math.random() - 0.5);
        }
        
        // Clear selection and close sub-list
        state.selectedBookmarkFolderIds = [];
        document.getElementById('sub-list').classList.add('hidden');
        state.subMode = null;
        
        const folderNames = selectedFoldersObj.map(f => f.name).join(', ');
        launchQuiz(matchingQuestions, `⭐ 북마크: ${folderNames} (${matchingQuestions.length}제)${shuffle ? ' [랜덤]' : ''}`);
    } catch (e) {
        console.error('Failed to start selected folders quiz:', e);
        alert('북마크 퀴즈를 시작하지 못했습니다.');
    }
};

window.openCustomDialog = function() {
    const modal = document.getElementById('custom-dialog-modal');
    const content = document.getElementById('custom-dialog-content');
    if (modal && content) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            content.style.transform = 'scale(1)';
        }, 10);
    }
};

window.closeCustomDialog = function() {
    const modal = document.getElementById('custom-dialog-modal');
    const content = document.getElementById('custom-dialog-content');
    if (modal && content) {
        content.style.transform = 'scale(0.95)';
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 150);
    }
};

window.addNewFolderFromDashboard = function() {
    const title = document.getElementById('custom-dialog-title');
    const body = document.getElementById('custom-dialog-body');
    const actions = document.getElementById('custom-dialog-actions');
    
    title.innerHTML = '📁 새 북마크 폴더 추가';
    body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
            <label style="font-size: 0.85rem; color: #94a3b8; font-weight: 600; text-align: left;">생성할 폴더명을 입력해 주세요.</label>
            <input type="text" id="dialog-folder-name" placeholder="폴더명 입력..." style="background: #0f172a; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 0.7rem; border-radius: 8px; font-size: 0.95rem; outline: none; width: 100%;" />
        </div>
    `;
    
    actions.innerHTML = `
        <button onclick="closeCustomDialog()" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #cbd5e1; padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">취소</button>
        <button onclick="submitNewFolderFromDialog()" style="background: #fbbf24; border: none; color: #000; padding: 0.6rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='#f59e0b'" onmouseout="this.style.background='#fbbf24'">폴더 생성</button>
    `;
    
    openCustomDialog();
    setTimeout(() => {
        const input = document.getElementById('dialog-folder-name');
        if (input) input.focus();
    }, 100);
};

window.submitNewFolderFromDialog = async function() {
    const input = document.getElementById('dialog-folder-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
        alert('폴더 이름을 입력해 주세요.');
        return;
    }
    if (bookmarkData.folders.some(f => f.name === name)) {
        alert('이미 존재하는 폴더 이름입니다.');
        return;
    }
    
    bookmarkData.folders.push({
        id: 'folder_' + Date.now(),
        name: name,
        keys: []
    });
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    closeCustomDialog();
    renderBookmarkFoldersList();
};

window.renameBookmarkFolder = function(folderId, event) {
    if (event) event.stopPropagation();
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const title = document.getElementById('custom-dialog-title');
    const body = document.getElementById('custom-dialog-body');
    const actions = document.getElementById('custom-dialog-actions');
    
    title.innerHTML = '✏️ 폴더 이름 변경';
    body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
            <label style="font-size: 0.85rem; color: #94a3b8; font-weight: 600; text-align: left;">변경할 폴더명을 입력해 주세요.</label>
            <input type="text" id="dialog-rename-folder-name" value="${folder.name}" placeholder="폴더명 입력..." style="background: #0f172a; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 0.7rem; border-radius: 8px; font-size: 0.95rem; outline: none; width: 100%;" />
        </div>
    `;
    
    actions.innerHTML = `
        <button onclick="closeCustomDialog()" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #cbd5e1; padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">취소</button>
        <button onclick="submitRenameFolderFromDialog('${folderId}')" style="background: #fbbf24; border: none; color: #000; padding: 0.6rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='#f59e0b'" onmouseout="this.style.background='#fbbf24'">이름 변경</button>
    `;
    
    openCustomDialog();
    setTimeout(() => {
        const input = document.getElementById('dialog-rename-folder-name');
        if (input) {
            input.focus();
            input.select();
        }
    }, 100);
};

window.submitRenameFolderFromDialog = async function(folderId) {
    const input = document.getElementById('dialog-rename-folder-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
        alert('폴더 이름을 입력해 주세요.');
        return;
    }
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    if (name === folder.name) {
        closeCustomDialog();
        return;
    }
    
    const siblings = bookmarkData.folders.filter(f => f.parentId === folder.parentId && f.id !== folderId);
    if (siblings.some(f => f.name === name)) {
        alert('이미 존재하는 폴더 이름입니다.');
        return;
    }
    
    folder.name = name;
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    closeCustomDialog();
    renderBookmarkFoldersList();
};

window.deleteBookmarkFolder = async function(folderId, event) {
    if (event) event.stopPropagation();
    if (!confirm('이 폴더와 안에 저장된 모든 북마크 및 하위 폴더들을 삭제하시겠습니까?')) return;
    
    deleteFolderRecursive(folderId);
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    renderBookmarkFoldersList();
};

async function selectBookmarkFolder(folderId, isRefresh = false) {
    if (!isRefresh) {
        state.selectedBookmarkQuestionKeys = [];
    }
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const sub = document.getElementById('sub-list');
    if (!sub) return;
    
    sub.innerHTML = '<div style="color:var(--muted);padding:1rem">불러오는 중...</div>';
    
    try {
        const res = await fetch('./data/questions_all.json?t=' + Date.now());
        const data = await res.json();
        const allQuestions = data.questions || [];
        
        const matchingQuestions = allQuestions.filter(q => {
            const qKey = (q.original_id || q.id) + "_" + q.type;
            return folder.keys && folder.keys.includes(qKey);
        });
        
        const crumbs = getBreadcrumbs(folder.id);
        const breadcrumbHtml = crumbs.map((c, idx) => {
            if (idx === crumbs.length - 1) {
                return `<span style="color: #fbbf24; font-weight: 700;">📁 ${c.name}</span>`;
            }
            return `<span onclick="selectBookmarkFolder('${c.id}')" style="cursor: pointer; color: #cbd5e1; text-decoration: underline;" onmouseover="this.style.color='#fbbf24'" onmouseout="this.style.color='#cbd5e1'">📁 ${c.name}</span>`;
        }).join(' <span style="color:var(--muted); margin: 0 0.3rem;">&gt;</span> ');

        const subfolders = bookmarkData.folders.filter(f => f.parentId === folderId);
        let subfoldersHtml = '';
        if (subfolders.length > 0) {
            subfoldersHtml = `
                <div style="background: rgba(30, 41, 59, 0.3); border: 1px solid rgba(255,255,255,0.03); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem; width: 100%;">
                    <span style="color: #94a3b8; font-weight: 600; font-size: 0.85rem; text-align: left; display: block; text-transform: uppercase; letter-spacing: 0.05em;">📂 하위 폴더 목록</span>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.8rem; width: 100%;">
                        ${subfolders.map(sf => `
                            <div class="item-row" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 0.8rem 1rem; background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; transition: 0.2s;" onmouseover="this.style.borderColor='rgba(251,191,36,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.05)'">
                                <div style="text-align: left; min-width: 0; flex: 1;" onclick="selectBookmarkFolder('${sf.id}')">
                                    <strong style="font-size: 0.95rem; color: #fff; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📁 ${sf.name}</strong>
                                    <span style="color: var(--muted); font-size: 0.8rem;">${sf.keys ? sf.keys.length : 0}개 문제</span>
                                </div>
                                <div style="display: flex; gap: 0.2rem; z-index: 10;">
                                    <button onclick="renameBookmarkFolder('${sf.id}', event)" style="background: none; border: none; color: #cbd5e1; font-size: 0.8rem; cursor: pointer; padding: 0.25rem;">✏️</button>
                                    <button onclick="deleteBookmarkFolder('${sf.id}', event)" style="background: none; border: none; color: #ef4444; font-size: 0.8rem; cursor: pointer; padding: 0.25rem;">🗑️</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        const selectedCount = state.selectedBookmarkQuestionKeys ? state.selectedBookmarkQuestionKeys.length : 0;
        let selectionActionBar = '';
        if (selectedCount > 0) {
            selectionActionBar = `
                <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 1rem 1.2rem; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div style="text-align: left;">
                        <strong style="color: #60a5fa; font-size: 1rem; display: block;">📝 ${selectedCount}개 문제 선택됨</strong>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button onclick="moveMultipleQuestionsFolder('${folder.id}')" style="background: #3b82f6; color: #fff; border: none; padding: 0.5rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 800; transition: 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">📂 일괄 이동</button>
                        <button onclick="removeMultipleQuestionsFromFolder('${folder.id}')" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; padding: 0.5rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.25)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.15)'">❌ 일괄 삭제</button>
                    </div>
                </div>
            `;
        }

        const isAllChecked = matchingQuestions.length > 0 && matchingQuestions.every(q => {
            const qKey = (q.original_id || q.id) + "_" + q.type;
            return state.selectedBookmarkQuestionKeys.includes(qKey);
        });
        
        const selectAllBar = matchingQuestions.length > 0 ? `
            <div style="display: flex; align-items: center; gap: 0.8rem; background: rgba(255,255,255,0.02); padding: 0.6rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03); width: 100%;">
                <input type="checkbox" ${isAllChecked ? 'checked' : ''} onclick="toggleSelectAllQuestions('${folder.id}', event)" style="width: 1.15rem; height: 1.15rem; accent-color: #3b82f6; cursor: pointer;" />
                <span style="font-size: 0.9rem; color: #94a3b8; font-weight: 600;">전체 선택 (${matchingQuestions.length}개 문제 중)</span>
            </div>
        ` : '';
        
        sub.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem; width: 100%; flex-wrap: wrap; gap: 1rem;">
                    <div style="text-align: left;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.95rem; margin-bottom: 0.3rem;">
                            <span onclick="renderBookmarkFoldersList()" style="cursor: pointer; color: #cbd5e1; text-decoration: underline;" onmouseover="this.style.color='#fbbf24'" onmouseout="this.style.color='#cbd5e1'">Root</span>
                            <span style="color:var(--muted);">&gt;</span>
                            ${breadcrumbHtml}
                        </div>
                        <span style="color: var(--muted); font-size: 0.9rem;">이 폴더 문제 ${matchingQuestions.length}개 (하위 폴더 제외)</span>
                    </div>
                    <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                        <button onclick="${folder.parentId ? `selectBookmarkFolder('${folder.parentId}')` : 'renderBookmarkFoldersList()'}" style="background: rgba(255, 255, 255, 0.05); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">뒤로가기</button>
                        <button onclick="addNewSubfolder('${folder.id}')" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.25)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.15)'">➕ 하위 폴더</button>
                        ${matchingQuestions.length > 0 ? `
                            <button onclick="startBookmarkFolderQuiz('${folder.id}', false)" style="background: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(251,191,36,0.25)'" onmouseout="this.style.background='rgba(251,191,36,0.15)'">▶️ 순차 풀기</button>
                            <button onclick="startBookmarkFolderQuiz('${folder.id}', true)" style="background: #fbbf24; color: #000; border: none; padding: 0.6rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='#f59e0b'" onmouseout="this.style.background='#fbbf24'">🔀 랜덤 풀기</button>
                        ` : ''}
                    </div>
                </div>
                
                ${subfoldersHtml}
                
                ${selectionActionBar}
                ${selectAllBar}
                
                <div style="display: flex; flex-direction: column; gap: 0.8rem; max-height: 400px; overflow-y: auto; padding-right: 0.5rem; width: 100%;">
                    ${matchingQuestions.length === 0 ? `
                        <div style="color: var(--muted); text-align: center; padding: 2rem; width: 100%;">이 폴더에 저장된 문제가 없습니다. (상단 '하위 폴더'나 문제 풀이 중에 북마크 버튼으로 추가해 주세요.)</div>
                    ` : matchingQuestions.map(q => {
                        const snippet = q.question.substring(0, 100).replace(/\n/g, ' ') + (q.question.length > 100 ? '...' : '');
                        const qKey = (q.original_id || q.id) + "_" + q.type;
                        const isQuestionChecked = state.selectedBookmarkQuestionKeys && state.selectedBookmarkQuestionKeys.includes(qKey);
                        return `
                            <div style="display: flex; align-items: center; background: rgba(30, 41, 59, 0.4); border: 1px solid ${isQuestionChecked ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.03)'}; border-radius: 8px; padding: 0.8rem 1rem; gap: 1rem; width: 100%;">
                                <input type="checkbox" ${isQuestionChecked ? 'checked' : ''} onclick="toggleSelectQuestion('${folder.id}', '${qKey}', event)" style="width: 1.15rem; height: 1.15rem; accent-color: #3b82f6; cursor: pointer; flex-shrink: 0;" />
                                <div onclick="viewSingleBookmarkQuestion('${folder.id}', '${qKey}')" style="flex: 1; text-align: left; cursor: pointer; min-width: 0;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                                    <span style="font-size: 0.8rem; color: #fbbf24; font-weight: 700; background: rgba(251, 191, 36, 0.1); padding: 0.2rem 0.5rem; border-radius: 4px; margin-right: 0.5rem;">${TYPE_LABEL[q.type]}</span>
                                    <span style="font-size: 0.85rem; color: var(--muted); font-weight: 500;">${q.session} - ${q.original_id || q.id}번</span>
                                    <div style="color: #cbd5e1; font-size: 0.95rem; font-weight: 500; margin-top: 0.4rem; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${snippet}</div>
                                </div>
                                <div style="display: flex; gap: 0.3rem;">
                                    <button onclick="moveQuestionFolder('${folder.id}', '${qKey}', event)" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.2)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.1)'" title="다른 폴더로 이동">
                                        📂 이동
                                    </button>
                                    <button onclick="removeQuestionFromFolder('${folder.id}', '${qKey}', event)" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 700; transition: 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'" title="북마크 삭제">
                                        ❌ 삭제
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    } catch (e) {
        console.error('Failed to load bookmark questions list:', e);
        sub.innerHTML = '<div style="color:#ef4444;padding:1rem">문제 목록을 가져오는 데 실패했습니다.</div>';
    }
}
window.selectBookmarkFolder = selectBookmarkFolder;

window.moveQuestionFolder = function(sourceFolderId, qKey, event) {
    if (event) event.stopPropagation();
    if (bookmarkData.folders.length <= 1) {
        alert('이동할 다른 폴더가 없습니다. 먼저 상단에서 폴더를 생성해 주세요.');
        return;
    }
    
    const title = document.getElementById('custom-dialog-title');
    const body = document.getElementById('custom-dialog-body');
    const actions = document.getElementById('custom-dialog-actions');
    
    title.innerHTML = '📂 문제 폴더 이동';
    body.innerHTML = `
        <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 600; margin-bottom: 0.5rem; display: block; text-align: left;">이동할 대상 폴더를 선택해 주세요:</span>
        <div style="display: flex; flex-direction: column; gap: 0.6rem; max-height: 250px; overflow-y: auto; width: 100%;">
            ${getHierarchicalMoveButtons(bookmarkData.folders, null, 0, sourceFolderId, qKey)}
        </div>
    `;
    
    actions.innerHTML = `
        <button onclick="closeCustomDialog()" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #cbd5e1; padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; width: 100%;">취소</button>
    `;
    
    openCustomDialog();
};

window.submitMoveQuestionFolder = async function(sourceFolderId, targetFolderId, qKey) {
    const sourceFolder = bookmarkData.folders.find(f => f.id === sourceFolderId);
    const targetFolder = bookmarkData.folders.find(f => f.id === targetFolderId);
    
    if (sourceFolder) {
        sourceFolder.keys = sourceFolder.keys.filter(k => k !== qKey);
    }
    
    if (targetFolder) {
        if (!targetFolder.keys) targetFolder.keys = [];
        if (!targetFolder.keys.includes(qKey)) {
            targetFolder.keys.push(qKey);
        }
    }
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    closeCustomDialog();
    renderBookmarkFoldersList();
};

window.removeQuestionFromFolder = async function(folderId, qKey, event) {
    if (event) event.stopPropagation();
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    folder.keys = folder.keys.filter(k => k !== qKey);
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    updateBookmarkButtonState();
    
    renderBookmarkFoldersList();
};

window.toggleSelectQuestion = function(folderId, qKey, event) {
    if (event) event.stopPropagation();
    if (!state.selectedBookmarkQuestionKeys) {
        state.selectedBookmarkQuestionKeys = [];
    }
    const idx = state.selectedBookmarkQuestionKeys.indexOf(qKey);
    if (idx > -1) {
        state.selectedBookmarkQuestionKeys.splice(idx, 1);
    } else {
        state.selectedBookmarkQuestionKeys.push(qKey);
    }
    renderBookmarkFoldersList();
};

window.toggleSelectAllQuestions = function(folderId, event) {
    if (event) event.stopPropagation();
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder || !folder.keys) return;
    
    const isAllChecked = folder.keys.length > 0 && folder.keys.every(k => state.selectedBookmarkQuestionKeys.includes(k));
    
    if (isAllChecked) {
        state.selectedBookmarkQuestionKeys = state.selectedBookmarkQuestionKeys.filter(k => !folder.keys.includes(k));
    } else {
        folder.keys.forEach(k => {
            if (!state.selectedBookmarkQuestionKeys.includes(k)) {
                state.selectedBookmarkQuestionKeys.push(k);
            }
        });
    }
    renderBookmarkFoldersList();
};

window.moveMultipleQuestionsFolder = function(sourceFolderId) {
    if (!state.selectedBookmarkQuestionKeys || state.selectedBookmarkQuestionKeys.length === 0) return;
    if (bookmarkData.folders.length <= 1) {
        alert('이동할 다른 폴더가 없습니다. 먼저 상단에서 폴더를 생성해 주세요.');
        return;
    }
    
    const title = document.getElementById('custom-dialog-title');
    const body = document.getElementById('custom-dialog-body');
    const actions = document.getElementById('custom-dialog-actions');
    
    title.innerHTML = '📂 문제 일괄 이동';
    body.innerHTML = `
        <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 600; margin-bottom: 0.5rem; display: block; text-align: left;">선택한 ${state.selectedBookmarkQuestionKeys.length}개 문제를 이동할 대상 폴더를 선택해 주세요:</span>
        <div style="display: flex; flex-direction: column; gap: 0.6rem; max-height: 250px; overflow-y: auto; width: 100%;">
            ${getHierarchicalMoveButtonsForMultiple(bookmarkData.folders, null, 0, sourceFolderId)}
        </div>
    `;
    
    actions.innerHTML = `
        <button onclick="closeCustomDialog()" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #cbd5e1; padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; width: 100%;">취소</button>
    `;
    
    openCustomDialog();
};

function getHierarchicalMoveButtonsForMultiple(folders, parentId = null, depth = 0, sourceFolderId) {
    const list = folders.filter(f => f.parentId === parentId || (!parentId && !f.parentId));
    let html = '';
    list.forEach(f => {
        const indentPadding = depth * 1.5;
        const isSource = f.id === sourceFolderId;
        
        if (isSource) {
            html += `
                <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); color: var(--muted); padding: 0.8rem; border-radius: 8px; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; justify-content: space-between; margin-left: ${indentPadding}rem; opacity: 0.5;">
                    <span>📁 ${f.name} (현재 폴더)</span>
                </div>
            `;
        } else {
            html += `
                <button onclick="submitMoveMultipleQuestionsFolder('${sourceFolderId}', '${f.id}')" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); color: #fff; padding: 0.8rem; border-radius: 8px; cursor: pointer; text-align: left; font-size: 0.95rem; font-weight: 600; transition: 0.2s; display: flex; align-items: center; justify-content: space-between; margin-left: ${indentPadding}rem;" onmouseover="this.style.background='rgba(251,191,36,0.1)'; this.style.borderColor='rgba(251,191,36,0.3)';" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.05)';">
                    <span>📁 ${f.name}</span>
                    <span style="font-size: 0.8rem; color: #94a3b8;">${f.keys ? f.keys.length : 0}개 문제</span>
                </button>
            `;
        }
        
        html += getHierarchicalMoveButtonsForMultiple(folders, f.id, depth + 1, sourceFolderId);
    });
    return html;
}

window.submitMoveMultipleQuestionsFolder = async function(sourceFolderId, targetFolderId) {
    const sourceFolder = bookmarkData.folders.find(f => f.id === sourceFolderId);
    const targetFolder = bookmarkData.folders.find(f => f.id === targetFolderId);
    
    if (!state.selectedBookmarkQuestionKeys || state.selectedBookmarkQuestionKeys.length === 0) return;
    
    const keysToMove = state.selectedBookmarkQuestionKeys;
    
    if (sourceFolder) {
        sourceFolder.keys = sourceFolder.keys.filter(k => !keysToMove.includes(k));
    }
    
    if (targetFolder) {
        if (!targetFolder.keys) targetFolder.keys = [];
        keysToMove.forEach(k => {
            if (!targetFolder.keys.includes(k)) {
                targetFolder.keys.push(k);
            }
        });
    }
    
    state.selectedBookmarkQuestionKeys = [];
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    closeCustomDialog();
    renderBookmarkFoldersList();
};

window.removeMultipleQuestionsFromFolder = async function(folderId) {
    if (!state.selectedBookmarkQuestionKeys || state.selectedBookmarkQuestionKeys.length === 0) return;
    if (!confirm(`선택한 ${state.selectedBookmarkQuestionKeys.length}개 문제를 이 폴더의 북마크에서 삭제하시겠습니까?`)) return;
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const keysToRemove = state.selectedBookmarkQuestionKeys;
    folder.keys = folder.keys.filter(k => !keysToRemove.includes(k));
    
    state.selectedBookmarkQuestionKeys = [];
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    updateBookmarkButtonState();
    renderBookmarkFoldersList();
};

window.startBookmarkFolderQuiz = async function(folderId, shuffle = false, event) {
    if (event) event.stopPropagation();
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder || !folder.keys || folder.keys.length === 0) return;
    
    try {
        const res = await fetch('./data/questions_all.json?t=' + Date.now());
        const data = await res.json();
        const allQuestions = data.questions || [];
        
        let matchingQuestions = allQuestions.filter(q => {
            const qKey = (q.original_id || q.id) + "_" + q.type;
            return folder.keys.includes(qKey);
        });
        
        if (matchingQuestions.length === 0) {
            alert('이 폴더에 저장된 문제들을 데이터베이스에서 찾을 수 없습니다.');
            return;
        }
        
        if (shuffle) {
            matchingQuestions = [...matchingQuestions].sort(() => Math.random() - 0.5);
        }
        
        document.getElementById('sub-list').classList.add('hidden');
        state.subMode = null;
        
        launchQuiz(matchingQuestions, `⭐ 북마크: ${folder.name} (${matchingQuestions.length}제)${shuffle ? ' [랜덤]' : ''}`);
    } catch (e) {
        console.error('Failed to start bookmark quiz:', e);
        alert('북마크 퀴즈를 시작하지 못했습니다.');
    }
};

window.viewSingleBookmarkQuestion = function(folderId, qKey) {
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    fetch('./data/questions_all.json?t=' + Date.now())
        .then(res => res.json())
        .then(data => {
            const allQuestions = data.questions || [];
            
            const folderQuestions = allQuestions.filter(q => {
                const k = (q.original_id || q.id) + "_" + q.type;
                return folder.keys && folder.keys.includes(k);
            });
            
            const clickedIndex = folderQuestions.findIndex(q => {
                const k = (q.original_id || q.id) + "_" + q.type;
                return k === qKey;
            });
            
            if (clickedIndex === -1) {
                alert('문제를 찾을 수 없습니다.');
                return;
            }
            
            document.getElementById('sub-list').classList.add('hidden');
            state.subMode = null;
            
            launchQuiz(folderQuestions, `⭐ 북마크: ${folder.name} (${folderQuestions.length}제)`);
            state.index = clickedIndex;
            renderQuestion();
        })
        .catch(e => {
            console.error('Failed to view single bookmark question:', e);
            alert('문제를 불러오지 못했습니다.');
        });
};

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
    await syncBookmarks();
    await syncMemos();
    applyLoginState();
    loadSettings();
    restoreQuizStateIfAvailable();
}

// ─── Custom Past Exam AI Parsing & Upload Logic ────────────────
let parsedQuestionsBuffer = [];
let parsedSessionName = '';

// Dedicated fetch to Gemini with large maxOutputTokens for parsing text
async function callGeminiForParsing(prompt, schema) {
    const key = window.getGeminiKey();
    if (!key) {
        throw new Error("Gemini API 키가 등록되지 않았습니다.");
    }
    const model = window.getGeminiModel() || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    
    const bodyPayload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192
        }
    };
    
    if (schema) {
        bodyPayload.generationConfig.responseSchema = schema;
    }
    
    let retries = 3;
    while (retries >= 0) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error?.message || `HTTP ${res.status}`;
            
            // 429 (Too Many Requests) -> Wait 65s for quota reset
            // 503 (Service Unavailable) -> Wait 10s
            if ((res.status === 429 || res.status === 503) && retries > 0) {
                const waitTime = res.status === 429 ? 65000 : 10000;
                console.warn(`[Gemini API] ${res.status} Error. Retrying in ${waitTime/1000}s... (${retries} retries left)`);
                await new Promise(r => setTimeout(r, waitTime));
                retries--;
                continue;
            }
            throw new Error(`Gemini API Error: ${errMsg}`);
        }
        
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error("올바른 응답을 받지 못했습니다. 안전 필터에 의해 차단되었을 수 있습니다.");
        }
        return text;
    }
}

function switchAdminTab(tabName) {
    const usersBtn = document.getElementById('tab-users-btn');
    const examsBtn = document.getElementById('tab-exams-btn');
    const usersSection = document.getElementById('admin-users-section');
    const examsSection = document.getElementById('admin-exams-section');
    
    if (!usersBtn || !examsBtn || !usersSection || !examsSection) return;
    
    if (tabName === 'users') {
        usersBtn.classList.add('active');
        usersBtn.style.color = '#fff';
        usersBtn.style.borderBottom = '2px solid var(--primary)';
        examsBtn.classList.remove('active');
        examsBtn.style.color = 'var(--muted)';
        examsBtn.style.borderBottom = '2px solid transparent';
        usersSection.classList.remove('hidden');
        examsSection.classList.add('hidden');
    } else {
        examsBtn.classList.add('active');
        examsBtn.style.color = '#fff';
        examsBtn.style.borderBottom = '2px solid var(--primary)';
        usersBtn.classList.remove('active');
        usersBtn.style.color = 'var(--muted)';
        usersBtn.style.borderBottom = '2px solid transparent';
        examsSection.classList.remove('hidden');
        usersSection.classList.add('hidden');
    }
}

async function runAIParsing() {
    const nameInput = document.getElementById('admin-exam-name');
    const textInput = document.getElementById('admin-exam-raw-text');
    const parseBtn = document.getElementById('admin-parse-btn');
    const previewContainer = document.getElementById('admin-parse-preview-container');
    const previewList = document.getElementById('admin-parse-preview-list');
    const previewCount = document.getElementById('admin-preview-count');
    
    if (!nameInput || !textInput || !parseBtn || !previewContainer || !previewList || !previewCount) return;
    
    const examName = nameInput.value.trim();
    const rawText = textInput.value.trim();
    
    if (!examName) {
        alert('회차 이름을 입력해 주세요.');
        return;
    }
    if (!rawText) {
        alert('기출문제 텍스트 원문을 입력해 주세요.');
        return;
    }
    
    const apiKey = window.getGeminiKey();
    if (!apiKey) {
        alert('Gemini API 키가 설정에 등록되어 있지 않습니다. 설정 탭에서 API 키를 먼저 입력해 주세요.');
        switchView('settings');
        return;
    }
    
    parseBtn.disabled = true;
    parseBtn.style.opacity = '0.7';
    
    // --- 텍스트 자동 쪼개기 (Auto Chunking) ---
    // 빈 줄 기준으로 먼저 나누고, 없으면 일반 줄바꿈 기준으로 나눔
    let paragraphs = rawText.split(/\n\s*\n/);
    if (paragraphs.length < 2) paragraphs = rawText.split('\n');
    
    const chunks = [];
    let currentChunk = '';
    
    for (const p of paragraphs) {
        if (currentChunk.length + p.length > 2500 && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = p;
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + p;
        }
    }
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    const parsingSchema = {
        type: "OBJECT",
        properties: {
            session: { type: "STRING" },
            questions: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        id: { type: "INTEGER" },
                        type: { 
                            type: "STRING", 
                            enum: ["short", "essay", "practical"] 
                        },
                        question: { type: "STRING" },
                        answer: { type: "STRING" },
                        explanation: { type: "STRING" }
                    },
                    required: ["id", "type", "question", "answer"]
                }
            }
        },
        required: ["questions"]
    };

    try {
        let allQuestions = [];
        
        for (let i = 0; i < chunks.length; i++) {
            parseBtn.textContent = `🔄 AI 분석 및 파싱 중... (${i + 1}/${chunks.length} 단계 - 최대 1~2분 소요)`;
            
            const prompt = `
[초강력 지시사항]
당신은 정보보안기사 실기 기출문제를 분석하여 서비스용 JSON 포맷으로 구조화하는 전문 데이터 파서입니다.
제공된 [기출 원본 텍스트]에 있는 **모든 문제를 단 하나도 빠짐없이 100% 추출**해야 합니다. 임의로 요약하거나 일부 문제를 건너뛰는 행위는 절대 금지됩니다.

[규칙]
1. 각 문항을 모두 추출하여 questions 배열에 담습니다.
2. 각 문항은 다음 필드를 가져야 합니다:
   - "id": 1부터 시작하는 순차적인 문제 번호 (integer)
   - "type": 문제 유형으로 다음 세 가지 중 하나만 지정해야 합니다:
     - "short" (단답형): 지문에 괄호 (A), (B)가 있거나, "무엇인지 쓰시오", "명칭을 쓰시오", "알맞은 용어를 쓰시오" 등 **짧은 명사나 단답**을 요구하는 모든 문제. (지문이 길더라도 요구하는 답안의 형태가 단어라면 무조건 short로 분류하세요.)
     - "essay" (서술형): "원리를 설명하시오", "절차를 3가지 기술하시오", "이유를 쓰시오" 등 **문장형 답변**을 명시적으로 요구하거나 길게 풀어써야 하는 문제에만 엄격하게 지정하세요.
     - "practical" (실무형): 리눅스/윈도우 명령어 작성, 보안 장비 설정값, 로그 파일 분석 등 실무 설정이나 명령어를 요구하는 문제.
   - "question": 지문 텍스트. 줄바꿈을 유지하여 가독성 있게 작성하세요.
   - "answer": 모범 답안 텍스트. 지문에 빈칸 (A), (B) 또는 1), 2) 등이 있다면 답안에도 그에 맞춰 작성해 주세요. (예: "(A) 인증, (B) 인가" 또는 "1) /etc/securetty, 2) 600")
   - "explanation": 해당 문제에 대한 간단한 개념 해설 또는 설명 (없거나 불확실하면 빈 문자열 ""로 지정)
3. 출력은 오직 순수한 JSON 데이터여야 합니다.
4. 다시 한번 강조합니다. 원본 텍스트를 끝까지 읽고 모든 문제를 누락 없이 배열에 포함시키세요.

[기출 원본 텍스트]:
${chunks[i]}
`;
            
            // 429 에러 방지를 위해 첫 요청 이후에는 4.2초 대기
            if (i > 0) await new Promise(r => setTimeout(r, 4200));
            
            const resultText = await callGeminiForParsing(prompt, parsingSchema);
            const parsed = JSON.parse(resultText);
            
            if (parsed.questions && parsed.questions.length > 0) {
                allQuestions = allQuestions.concat(parsed.questions);
            }
        }
        
        if (allQuestions.length === 0) {
            throw new Error("파싱된 문항이 없습니다. 입력 텍스트를 확인해 주세요.");
        }
        
        const appendMode = document.getElementById('admin-append-mode')?.checked;
        if (appendMode) {
            const startId = parsedQuestionsBuffer.length;
            allQuestions.forEach((q, idx) => {
                q.id = startId + idx + 1; // Re-index sequentially
                parsedQuestionsBuffer.push(q);
            });
        } else {
            // 새 파싱이면 1번부터 인덱싱
            allQuestions.forEach((q, idx) => {
                q.id = idx + 1;
            });
            parsedQuestionsBuffer = allQuestions;
        }
        
        parsedSessionName = examName;
        
        renderPreviewTable();
        previewContainer.classList.remove('hidden');
        
        alert(`파싱 성공! 총 ${parsedQuestionsBuffer.length}문항을 추출했습니다. 아래 미리보기를 확인하고 파싱 결과가 괜찮다면 최종 업로드 버튼을 눌러주세요.`);
    } catch (e) {
        console.error('[Admin] Parsing failed:', e);
        alert(`파싱 실패: ${e.message}\n텍스트가 너무 길거나 AI 호출 도중 시간 초과가 발생했을 수 있습니다. 다시 시도하거나 텍스트 양을 줄여보세요.`);
    } finally {
        parseBtn.textContent = '⚡ AI 자동 파싱 시작';
        parseBtn.disabled = false;
        parseBtn.style.opacity = '1';
    }
}

function renderPreviewTable() {
    const previewList = document.getElementById('admin-parse-preview-list');
    const previewCount = document.getElementById('admin-preview-count');
    if (!previewList || !previewCount) return;
    
    previewList.innerHTML = '';
    
    parsedQuestionsBuffer.forEach((q, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;
        
        // 1. 번호 (ID)
        const tdId = document.createElement('td');
        tdId.innerHTML = `<strong>${q.id}</strong>`;
        tr.appendChild(tdId);
        
        // 2. 유형 (Type Select)
        const tdType = document.createElement('td');
        const select = document.createElement('select');
        select.className = 'preview-type-select';
        select.style.cssText = 'background: rgba(15, 23, 42, 0.6); color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 0.2rem; font-size: 0.85rem; outline: none; cursor: pointer;';
        
        const optShort = document.createElement('option');
        optShort.value = 'short';
        optShort.textContent = '단답형';
        const optEssay = document.createElement('option');
        optEssay.value = 'essay';
        optEssay.textContent = '서술형';
        const optPractical = document.createElement('option');
        optPractical.value = 'practical';
        optPractical.textContent = '실무형';
        
        select.appendChild(optShort);
        select.appendChild(optEssay);
        select.appendChild(optPractical);
        select.value = q.type || 'short';
        
        tdType.appendChild(select);
        tr.appendChild(tdType);
        
        // 3. 질문 (Question Textarea)
        const tdQuestion = document.createElement('td');
        const textareaQ = document.createElement('textarea');
        textareaQ.className = 'preview-question-textarea';
        textareaQ.style.cssText = 'width: 100%; min-height: 80px; background: rgba(15, 23, 42, 0.6); color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 0.5rem; font-size: 0.85rem; line-height: 1.4; resize: vertical; font-family: inherit; text-align: left; box-sizing: border-box;';
        textareaQ.value = q.question || '';
        tdQuestion.appendChild(textareaQ);
        tr.appendChild(tdQuestion);
        
        // 4. 모범답안 (Answer Textarea)
        const tdAnswer = document.createElement('td');
        const textareaA = document.createElement('textarea');
        textareaA.className = 'preview-answer-textarea';
        textareaA.style.cssText = 'width: 100%; min-height: 80px; background: rgba(15, 23, 42, 0.6); color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 0.5rem; font-size: 0.85rem; line-height: 1.4; resize: vertical; font-family: inherit; text-align: left; color: var(--primary); font-weight: 700; box-sizing: border-box;';
        textareaA.value = q.answer || '';
        tdAnswer.appendChild(textareaA);
        tr.appendChild(tdAnswer);
        
        // 5. 작업 (Delete Button)
        const tdActions = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '삭제';
        delBtn.style.cssText = 'background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px; padding: 0.3rem 0.6rem; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;';
        delBtn.onmouseover = () => { delBtn.style.background = 'rgba(239, 68, 68, 0.25)'; };
        delBtn.onmouseout = () => { delBtn.style.background = 'rgba(239, 68, 68, 0.15)'; };
        delBtn.onclick = () => {
            parsedQuestionsBuffer.splice(index, 1);
            // Re-index remaining questions sequentially
            parsedQuestionsBuffer.forEach((item, idx) => {
                item.id = idx + 1;
            });
            renderPreviewTable();
        };
        tdActions.appendChild(delBtn);
        tr.appendChild(tdActions);
        
        previewList.appendChild(tr);
    });
    
    // Add table header cell for action column if missing
    const tableEl = previewList.closest('table');
    if (tableEl) {
        const thead = tableEl.querySelector('thead tr');
        if (thead && thead.cells.length === 4) {
            const thActions = document.createElement('th');
            thActions.style.width = '70px';
            thActions.textContent = '작업';
            thead.appendChild(thActions);
        }
    }
    
    previewCount.textContent = `${parsedQuestionsBuffer.length}문항`;
}

function runLocalRegexParsing() {
    const nameInput = document.getElementById('admin-exam-name');
    const textInput = document.getElementById('admin-exam-raw-text');
    const previewContainer = document.getElementById('admin-parse-preview-container');
    const previewCount = document.getElementById('admin-preview-count');
    
    if (!nameInput || !textInput || !previewContainer || !previewCount) return;
    
    const examName = nameInput.value.trim();
    const rawText = textInput.value.trim();
    
    if (!examName) {
        alert('회차 이름을 입력해 주세요.');
        return;
    }
    if (!rawText) {
        alert('기출문제 텍스트 원문을 입력해 주세요.');
        return;
    }
    
    // Split text by questions using newline boundaries followed by digit+dot/bracket/parenthesis, Q+digit, or [문제 digit]
    const questionBlocks = rawText.split(/^(?=\d+[\.\)\s]|Q\d+[\.\)\s]|\[\s*문제\s*\d+\s*\])/gm);
    
    const tempQuestions = [];
    questionBlocks.forEach(block => {
        const trimmed = block.trim();
        if (!trimmed) return;
        
        // Extract ID if possible
        const idMatch = trimmed.match(/^(\d+)[\.\)\s]|^Q(\d+)[\.\)\s]|^\[\s*문제\s*(\d+)\s*\]/);
        let qId = tempQuestions.length + 1;
        if (idMatch) {
            const parsedId = parseInt(idMatch[1] || idMatch[2] || idMatch[3], 10);
            if (!isNaN(parsedId)) {
                qId = parsedId;
            }
        }
        
        // Extract answer
        let questionText = trimmed;
        let answerText = '';
        const ansMatch = trimmed.match(/[\r\n]+(?:답안|정답|답|정답안|\[\s*(?:답|정답|답안)\s*\])\s*[:：]?\s*([\s\S]+)$/i);
        if (ansMatch) {
            answerText = ansMatch[1].trim();
            questionText = trimmed.substring(0, ansMatch.index).trim();
        }
        
        // Detect type heuristics
        let qType = 'short';
        const lowerQ = questionText.toLowerCase();
        if (lowerQ.includes('설명하시오') || lowerQ.includes('서술하시오') || lowerQ.includes('기술하시오') || lowerQ.includes('배점 12') || lowerQ.includes('배점 10') || lowerQ.includes('약술하시오')) {
            qType = 'essay';
        } else if (lowerQ.includes('명령어') || lowerQ.includes('설정 파일') || lowerQ.includes('설정파일') || lowerQ.includes('디렉터리') || lowerQ.includes('배점 16') || lowerQ.includes('/etc/') || lowerQ.includes('iptables') || lowerQ.includes('sysctl.conf') || lowerQ.includes('명령을') || lowerQ.includes('옵션을')) {
            qType = 'practical';
        }
        
        tempQuestions.push({
            id: qId,
            type: qType,
            question: questionText,
            answer: answerText,
            explanation: ''
        });
    });
    
    if (tempQuestions.length === 0) {
        alert('로컬 파서가 문제 패턴(예: 1. 또는 Q1 등)을 감지하지 못했습니다. 형식을 확인해 주세요.');
        return;
    }
    
    const appendMode = document.getElementById('admin-append-mode')?.checked;
    if (appendMode) {
        const startId = parsedQuestionsBuffer.length;
        tempQuestions.forEach((q, idx) => {
            q.id = startId + idx + 1; // Re-index sequentially
            parsedQuestionsBuffer.push(q);
        });
    } else {
        parsedQuestionsBuffer = tempQuestions;
    }
    
    // Ensure all question IDs in the cumulative list are sequential starting from 1
    parsedQuestionsBuffer.forEach((q, idx) => {
        q.id = idx + 1;
    });
    
    parsedSessionName = examName;
    
    renderPreviewTable();
    
    previewContainer.classList.remove('hidden');
    
    alert(`로컬 엔진 파싱 완료! 총 ${tempQuestions.length}문항을 임포트했습니다. (누적 총 ${parsedQuestionsBuffer.length}문항)`);
}

async function saveParsedExam() {
    // Gather final values from preview list DOM elements
    const previewList = document.getElementById('admin-parse-preview-list');
    if (previewList) {
        const rows = previewList.querySelectorAll('tr');
        const updatedQuestions = [];
        rows.forEach((row, idx) => {
            const idText = row.cells[0].textContent.trim();
            const qId = parseInt(idText, 10) || (idx + 1);
            
            const selectEl = row.querySelector('.preview-type-select');
            const qType = selectEl ? selectEl.value : 'short';
            
            const questionTextarea = row.querySelector('.preview-question-textarea');
            const qText = questionTextarea ? questionTextarea.value : '';
            
            const answerTextarea = row.querySelector('.preview-answer-textarea');
            const qAnswer = answerTextarea ? answerTextarea.value : '';
            
            updatedQuestions.push({
                id: qId,
                type: qType,
                question: qText,
                answer: qAnswer,
                explanation: parsedQuestionsBuffer[idx]?.explanation || ''
            });
        });
        
        if (updatedQuestions.length > 0) {
            parsedQuestionsBuffer = updatedQuestions;
        }
    }

    if (parsedQuestionsBuffer.length === 0 || !parsedSessionName) {
        alert('저장할 파싱 데이터가 없습니다. 먼저 파싱을 완료해 주세요.');
        return;
    }
    
    if (!db) {
        alert('데이터베이스(Firestore)가 초기화되지 않았습니다. 네트워크 연결이나 설정을 확인해 주세요.');
        return;
    }
    
    const saveBtn = document.getElementById('admin-save-exam-btn');
    if (!saveBtn) return;
    const origText = saveBtn.textContent;
    saveBtn.textContent = '💾 업로드 중...';
    saveBtn.disabled = true;
    
    const sessionId = `session_${Date.now()}`;
    
    try {
        // 1. Save metadata to custom_sessions
        await db.collection('custom_sessions').doc(sessionId).set({
            id: sessionId,
            name: parsedSessionName,
            count: parsedQuestionsBuffer.length,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // 2. Save questions array to custom_questions
        await db.collection('custom_questions').doc(sessionId).set({
            questions: parsedQuestionsBuffer
        });
        
        alert('기출 시험지가 성공적으로 Firestore에 등록되었습니다!\n모든 사용자가 대시보드 및 기출 풀기에서 즉시 학습할 수 있습니다.');
        
        resetExamForm();
        renderDashboard();
    } catch (e) {
        console.error('[Admin] Upload failed:', e);
        alert(`업로드 실패: ${e.message}\nFirestore 보안 규칙이나 네트워크 상태를 점검해 주세요.`);
    } finally {
        saveBtn.textContent = origText;
        saveBtn.disabled = false;
    }
}

async function handlePDFUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
        alert('PDF 파일만 업로드할 수 있습니다.');
        return;
    }
    
    const statusDiv = document.getElementById('admin-file-status');
    const textInput = document.getElementById('admin-exam-raw-text');
    const nameInput = document.getElementById('admin-exam-name');
    
    if (statusDiv) {
        statusDiv.textContent = `⏳ 파일 읽는 중: ${file.name} ...`;
        statusDiv.classList.remove('hidden');
        statusDiv.style.color = 'var(--primary)';
    }
    
    if (nameInput && !nameInput.value.trim()) {
        const defaultName = file.name.replace(/\.[^/.]+$/, "");
        nameInput.value = defaultName;
    }
    
    try {
        const arrayBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = err => reject(err);
            reader.readAsArrayBuffer(file);
        });
        
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
        
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages;
        
        let extractedText = '';
        if (statusDiv) statusDiv.textContent = `⏳ 텍스트 추출 중 (총 ${totalPages}페이지)...`;
        
        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            extractedText += pageText + '\n\n';
            if (statusDiv) statusDiv.textContent = `⏳ 텍스트 추출 중: ${i} / ${totalPages} 페이지 완료`;
        }
        
        if (textInput) {
            textInput.value = extractedText.trim();
        }
        
        if (statusDiv) {
            statusDiv.textContent = `✅ 성공적으로 ${file.name}에서 텍스트를 추출했습니다!`;
            statusDiv.style.color = '#10b981';
        }
    } catch (e) {
        console.error('[Admin] PDF extraction failed:', e);
        if (statusDiv) {
            statusDiv.textContent = `❌ 텍스트 추출 실패: ${e.message}`;
            statusDiv.style.color = '#f87171';
        }
        alert('PDF 파일에서 텍스트를 추출하지 못했습니다. 스캔 이미지 형태의 PDF이거나 보안이 걸린 파일일 수 있습니다. 이 경우 직접 텍스트를 복사-붙여넣기해 주세요.');
    }
}

function resetExamForm() {
    const nameInput = document.getElementById('admin-exam-name');
    const textInput = document.getElementById('admin-exam-raw-text');
    const fileInput = document.getElementById('admin-exam-file');
    const fileStatus = document.getElementById('admin-file-status');
    const appendCheckbox = document.getElementById('admin-append-mode');
    const previewContainer = document.getElementById('admin-parse-preview-container');
    const previewList = document.getElementById('admin-parse-preview-list');
    
    if (nameInput) nameInput.value = '';
    if (textInput) textInput.value = '';
    if (fileInput) fileInput.value = '';
    if (appendCheckbox) appendCheckbox.checked = false;
    if (fileStatus) {
        fileStatus.textContent = '';
        fileStatus.classList.add('hidden');
        fileStatus.style.color = '';
    }
    if (previewContainer) previewContainer.classList.add('hidden');
    if (previewList) previewList.innerHTML = '';
    
    parsedQuestionsBuffer = [];
    parsedSessionName = '';
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
window.formatModelAnswer = formatModelAnswer;
window.formatUserAnswer = formatUserAnswer;

// Expose new Admin Parser tools
window.switchAdminTab = switchAdminTab;
window.runAIParsing = runAIParsing;
window.runLocalRegexParsing = runLocalRegexParsing;
window.saveParsedExam = saveParsedExam;
window.resetExamForm = resetExamForm;
window.handlePDFUpload = handlePDFUpload;

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

// --- Panel Resizer Logic ---
const resizer = document.getElementById('panel-resizer');
const explanationContainer = document.getElementById('explanation-container');
const sidePanel = document.getElementById('quiz-side-panel');

let isResizing = false;

if (resizer && explanationContainer && sidePanel) {
    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        resizer.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        // Prevent text selection during drag
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        
        const panelRect = sidePanel.getBoundingClientRect();
        let newHeight = e.clientY - panelRect.top;
        
        if (newHeight < 100) newHeight = 100;
        if (newHeight > panelRect.height - 150) newHeight = panelRect.height - 150;

        explanationContainer.style.height = `${newHeight}px`;
    });

    document.addEventListener('mouseup', function(e) {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('active');
            document.body.style.cursor = '';
        }
    });
}

// ─── Guide Modal ──────────────────────────────────────────────
window.openGuideModal = function() {
    let modal = document.getElementById('guide-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'guide-modal';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.background = 'rgba(10, 14, 23, 0.85)';
        modal.style.backdropFilter = 'blur(8px)';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '10000';
        modal.style.padding = '2rem';
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.3s';
        
        modal.innerHTML = `
            <div style="background: #1e293b; width: 100%; max-width: 700px; max-height: 90vh; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); transform: translateY(20px); transition: transform 0.3s; overflow: hidden;">
                <div style="padding: 1.5rem 2rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; background: rgba(15, 23, 42, 0.5);">
                    <h2 style="margin: 0; color: #fff; font-size: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">📘 기출 훈련 시스템 이용 가이드</h2>
                    <button onclick="closeGuideModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.8rem; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
                </div>
                <div style="padding: 2rem; overflow-y: auto; color: #cbd5e1; line-height: 1.7; font-size: 1.05rem;">
                    
                    <h3 style="color: var(--primary); font-size: 1.2rem; margin-top: 0; margin-bottom: 1rem; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 0.5rem;">1. 개인 API 키 설정하기 (필수)</h3>
                    <p style="margin-bottom: 1.5rem; font-size: 0.95rem;">좌측 <strong>⚙️ 설정</strong> 메뉴에서 본인의 <strong>Gemini API 키</strong>를 입력해야 AI 자동 채점 및 튜터 기능을 이용할 수 있습니다. (구글 AI Studio에서 무료 발급 가능)</p>

                    <h3 style="color: var(--primary); font-size: 1.2rem; margin-bottom: 1rem; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 0.5rem;">2. 3가지 학습 모드</h3>
                    <ul style="margin-bottom: 1.5rem; padding-left: 1.5rem; font-size: 0.95rem;">
                        <li style="margin-bottom: 0.5rem;"><strong>⚡ 즉시 채점:</strong> 한 문제를 풀 때마다 제출 버튼을 누르면 AI가 즉시 정답 여부를 판별하고 해설을 제공합니다.</li>
                        <li style="margin-bottom: 0.5rem;"><strong>🎯 실전 모드:</strong> 모든 문제를 다 푼 뒤 마지막에 한 번에 일괄 채점합니다. 실제 시험과 동일한 환경을 연습할 때 유용합니다.</li>
                        <li style="margin-bottom: 0.5rem;"><strong>📖 학습 모드:</strong> 답안 입력 없이 정답과 해설만 보면서 빠르게 기출을 훑어보는 모드입니다.</li>
                    </ul>

                    <h3 style="color: var(--primary); font-size: 1.2rem; margin-bottom: 1rem; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 0.5rem;">3. AI 튜터 & 상세 해설</h3>
                    <p style="margin-bottom: 1.5rem; font-size: 0.95rem;">우측 패널의 <strong>"상세 해설 열기"</strong>를 클릭하면 AI가 문제의 핵심을 짚어줍니다. 이해가 안 되는 부분은 아래쪽 <strong>AI 튜터 채팅창</strong>에서 언제든지 추가 질문을 할 수 있습니다.<br>
                    <span style="font-size: 0.85rem; color: #94a3b8;">* 창의 구분선을 위아래로 드래그하여 패널 크기를 자유롭게 조절할 수 있습니다.</span></p>

                    <h3 style="color: var(--primary); font-size: 1.2rem; margin-bottom: 1rem; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 0.5rem;">4. 유용한 단축키</h3>
                    <ul style="margin-bottom: 0; padding-left: 1.5rem; font-size: 0.95rem;">
                        <li style="margin-bottom: 0.5rem;"><kbd style="background: #334155; padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace;">Ctrl + Enter</kbd> : 정답 제출 / 일괄 채점 제출</li>
                        <li style="margin-bottom: 0.5rem;"><kbd style="background: #334155; padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace;">Ctrl + [</kbd> : 이전 문제로 이동</li>
                        <li style="margin-bottom: 0.5rem;"><kbd style="background: #334155; padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace;">Ctrl + ]</kbd> : 다음 문제로 이동 (건너뛰기)</li>
                        <li style="margin-bottom: 0.5rem;"><kbd style="background: #334155; padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace;">Ctrl + Alt + T</kbd> : 상세 해설 바로 열기</li>
                    </ul>
                </div>
                <div style="padding: 1.5rem 2rem; background: rgba(15, 23, 42, 0.8); border-top: 1px solid rgba(255,255,255,0.05); text-align: right;">
                    <button onclick="closeGuideModal()" style="background: var(--primary); color: #0f172a; border: none; padding: 0.8rem 2rem; border-radius: 8px; font-weight: 800; cursor: pointer; transition: 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">닫기</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Trigger reflow
        void modal.offsetWidth;
    }
    
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.style.opacity = '1';
        modal.querySelector('div').style.transform = 'translateY(0)';
    }, 10);
};

window.closeGuideModal = function() {
    const modal = document.getElementById('guide-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.querySelector('div').style.transform = 'translateY(20px)';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
};

window.toggleFolderExpand = function(folderId, event) {
    if (event) event.stopPropagation();
    if (!state.expandedBookmarkFolderIds) {
        state.expandedBookmarkFolderIds = [];
    }
    const idx = state.expandedBookmarkFolderIds.indexOf(folderId);
    if (idx > -1) {
        state.expandedBookmarkFolderIds.splice(idx, 1);
    } else {
        state.expandedBookmarkFolderIds.push(folderId);
    }
    renderBookmarkFoldersList();
};

window.toggleSelectQuestionFromTree = function(folderId, qKey, event) {
    if (event) event.stopPropagation();
    if (!state.selectedBookmarkQuestionKeys) {
        state.selectedBookmarkQuestionKeys = [];
    }
    const idx = state.selectedBookmarkQuestionKeys.indexOf(qKey);
    if (idx > -1) {
        state.selectedBookmarkQuestionKeys.splice(idx, 1);
    } else {
        state.selectedBookmarkQuestionKeys.push(qKey);
    }
    renderBookmarkFoldersList();
};

window.toggleSelectAllQuestionsFromTree = function(folderId, event) {
    if (event) event.stopPropagation();
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const folderQuestions = (state.allQuestions || []).filter(q => {
        const qKey = (q.original_id || q.id) + "_" + q.type;
        return folder.keys && folder.keys.includes(qKey);
    }).map(q => (q.original_id || q.id) + "_" + q.type);
    
    const isAllChecked = folderQuestions.length > 0 && folderQuestions.every(k => state.selectedBookmarkQuestionKeys && state.selectedBookmarkQuestionKeys.includes(k));
    
    if (isAllChecked) {
        state.selectedBookmarkQuestionKeys = (state.selectedBookmarkQuestionKeys || []).filter(k => !folderQuestions.includes(k));
    } else {
        if (!state.selectedBookmarkQuestionKeys) state.selectedBookmarkQuestionKeys = [];
        folderQuestions.forEach(k => {
            if (!state.selectedBookmarkQuestionKeys.includes(k)) {
                state.selectedBookmarkQuestionKeys.push(k);
            }
        });
    }
    renderBookmarkFoldersList();
};

window.moveQuestionFolderFromTree = function(folderId, qKey, event) {
    if (event) event.stopPropagation();
    moveQuestionFolder(folderId, qKey, event);
};

window.removeQuestionFromFolderFromTree = async function(folderId, qKey, event) {
    if (event) event.stopPropagation();
    if (!confirm('이 문제를 해당 폴더의 북마크에서 제거하시겠습니까?')) return;
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    folder.keys = folder.keys.filter(k => k !== qKey);
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    updateBookmarkButtonState();
    renderBookmarkFoldersList();
};

window.moveMultipleQuestionsFolderFromTree = function(folderId, event) {
    if (event) event.stopPropagation();
    moveMultipleQuestionsFolder(folderId);
};

window.removeMultipleQuestionsFromFolderFromTree = async function(folderId, event) {
    if (event) event.stopPropagation();
    if (!state.selectedBookmarkQuestionKeys || state.selectedBookmarkQuestionKeys.length === 0) return;
    
    const folder = bookmarkData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const folderQKeys = folder.keys || [];
    const keysToRemove = state.selectedBookmarkQuestionKeys.filter(k => folderQKeys.includes(k));
    
    if (keysToRemove.length === 0) return;
    if (!confirm(`이 폴더에서 선택한 ${keysToRemove.length}개 문제를 북마크에서 삭제하시겠습니까?`)) return;
    
    folder.keys = folder.keys.filter(k => !keysToRemove.includes(k));
    state.selectedBookmarkQuestionKeys = state.selectedBookmarkQuestionKeys.filter(k => !keysToRemove.includes(k));
    
    localStorage.setItem('review_bookmarks', JSON.stringify(bookmarkData));
    await syncBookmarks(true);
    updateBookmarkButtonState();
    renderBookmarkFoldersList();
};

initApp();