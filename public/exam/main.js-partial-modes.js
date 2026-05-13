// --- Quiz Modes Selection ---
window.showSessionSelection = function() {
    const sub = document.getElementById('sub-selection-area');
    sub.classList.remove('hidden');
    document.getElementById('sub-title').innerText = '📅 회차 선택';
    loadSessions();
};

window.showTypeSelection = function() {
    const sub = document.getElementById('sub-selection-area');
    sub.classList.remove('hidden');
    document.getElementById('sub-title').innerText = '📂 유형 선택';
    const list = document.getElementById('sessions-list');
    list.innerHTML = `
        <div class="item-row" onclick="startTypeQuiz('short')"><span class="label-blue">📝 단답형</span> <span>단답형 풀기</span></div>
        <div class="item-row" onclick="startTypeQuiz('long')"><span class="label-blue">🖋️ 서술형</span> <span>서술형 풀기</span></div>
        <div class="item-row" onclick="startTypeQuiz('practical')"><span class="label-blue">🛠️ 실무형</span> <span>실무형 풀기</span></div>
    `;
};

window.hideSubSelection = function() {
    document.getElementById('sub-selection-area').classList.add('hidden');
};
