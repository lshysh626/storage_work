// ─── Gemini Direct API ────────────────────────────────────────
// 백엔드를 거치지 않고 Gemini API를 브라우저에서 직접 호출합니다.

const GEMINI_DEFAULT_KEY = 'AIzaSyCZiT-lW8pNscz62zTs9yjS_gWP3bNr_FU';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 모델 후보 (순서대로 시도)
const GEMINI_MODEL_FALLBACKS = [
    'gemini-2.0-flash',
    'gemini-flash-latest',
    'gemini-3-flash-preview'
];

function getGeminiKey() {
    return localStorage.getItem('gemini_api_key') || GEMINI_DEFAULT_KEY;
}

function getGeminiModel() {
    return localStorage.getItem('gemini_model') || GEMINI_MODEL_FALLBACKS[0];
}

// ─── 에러 메시지 파싱 (간결하게) ────────────────────────────
function parseGeminiError(status, errBody) {
    const msg = errBody?.error?.message || '';
    if (status === 429) {
        // 재시도 권장 시간 추출
        const retryMatch = msg.match(/Please retry in ([\d.]+)s/);
        const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
        return { isRateLimit: true, retrySec, message: `API 요청 한도 초과 — ${retrySec}초 후 자동 재시도합니다.` };
    }
    if (status === 400) return { isRateLimit: false, message: 'API 키 또는 요청이 잘못되었습니다.' };
    if (status === 403) return { isRateLimit: false, message: 'API 키 권한이 없습니다. 설정에서 키를 확인하세요.' };
    return { isRateLimit: false, message: `API 오류 (${status})` };
}

// ─── sleep 유틸 ──────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 일반 호출 (재시도 + 모델 폴백) ─────────────────────────
async function callGemini(prompt) {
    const key = getGeminiKey();
    const preferredModel = getGeminiModel();
    const models = [preferredModel, ...GEMINI_MODEL_FALLBACKS.filter(m => m !== preferredModel)];
    let lastErrorMsg = '';

    for (const model of models) {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`;
        let retries = 2;

        while (retries >= 0) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { 
                        temperature: 0.1,
                        responseMimeType: 'application/json'
                    }
                })
            });

            if (res.ok) {
                const data = await res.json();
                return data.candidates[0].content.parts[0].text;
            }

            const errBody = await res.json().catch(() => ({}));
            const parsed = parseGeminiError(res.status, errBody);
            lastErrorMsg = parsed.message;

            if (parsed.isRateLimit) {
                console.warn(`[${model}] Rate Limit hit. Waiting 4 seconds before fallback...`);
                await sleep(4000);
                break;
            }

            // 기타 오류 시에도 다음 모델 시도
            break;
        }
    }

    throw new Error(lastErrorMsg || 'API 요청 실패');
}

// ─── 스트리밍 호출 (재시도 + 모델 폴백) ─────────────────────
async function callGeminiStream(prompt, onChunk, onStatus) {
    const key = getGeminiKey();
    const preferredModel = getGeminiModel();
    const models = [preferredModel, ...GEMINI_MODEL_FALLBACKS.filter(m => m !== preferredModel)];
    let lastErrorMsg = '';

    for (const model of models) {
        const url = `${GEMINI_BASE}/${model}:streamGenerateContent?key=${key}&alt=sse`;
        let retries = 2;

        while (retries >= 0) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.5 }
                })
            });

            if (res.ok) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const json = line.slice(6).trim();
                        if (!json || json === '[DONE]') continue;
                        try {
                            const data = JSON.parse(json);
                            if (data.error) {
                                throw new Error(data.error.message || 'API 스트림 에러');
                            }
                            
                            const candidate = data.candidates?.[0];
                            if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
                                throw new Error(`응답 차단됨 (사유: ${candidate.finishReason})`);
                            }
                            
                            const text = candidate?.content?.parts?.[0]?.text;
                            if (text) onChunk(text);
                        } catch (e) {
                            if (e.name === 'SyntaxError') continue;
                            throw e;
                        }
                    }
                }
                return; // 성공
            }

            const errBody = await res.json().catch(() => ({}));
            const parsed = parseGeminiError(res.status, errBody);
            lastErrorMsg = parsed.message;

            if (parsed.isRateLimit) {
                if (onStatus) onStatus(`[${model}] 한도 초과. 4초 대기 후 전환...`);
                await sleep(4000);
                break; // 대기 후 다음 모델로
            }

            break; // 다음 모델로
        }
    }

    throw new Error(lastErrorMsg || 'API 요청 실패');
}

// ─── 채점 ─────────────────────────────────────────────────────
async function geminiScore(question, correct_answer, user_answer, points) {
    // 0. 미입력 시 빠른 오답 처리 (AI 호출 생략)
    if (!user_answer || user_answer === '미입력' || String(user_answer).trim() === '') {
        return {
            score: 0,
            is_correct: false,
            feedback: "답안을 작성하지 않았습니다."
        };
    }

    // 1. 빠른 채점 (단답형 등에서 내용이 완벽히 일치할 경우 AI 호출 생략)
    if (user_answer && correct_answer) {
        const cleanU = String(user_answer).replace(/\s+/g, '').toLowerCase();
        const cleanC = String(correct_answer).replace(/\s+/g, '').toLowerCase();
        if (cleanU === cleanC || (cleanC.length > 2 && cleanU.includes(cleanC))) {
            return {
                score: points,
                is_correct: true,
                feedback: "정답과 완벽하게 일치합니다. (초고속 자동 채점)"
            };
        }
    }

    // 2. AI 정밀 채점
    const prompt = `정보보안기사 실기 채점.
문제: ${question}
정답: ${correct_answer}
사용자 답변: ${user_answer}
배점: ${points}점

반드시 아래 JSON 형태로만 응답:
{"score": 숫자, "feedback": "1문장 이내 짧은 피드백", "is_correct": true/false}`;

    try {
        const text = await callGemini(prompt);
        const match = text.match(/\{[\s\S]*?\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('채점 응답 파싱 실패');
    } catch (err) {
        return {
            score: 0,
            is_correct: false,
            feedback: `[AI 채점 보류] 일시적 오류 발생 (${err.message})\n결과 창(오답 노트)에서 정답과 내 답안을 직접 비교해 보세요.`
        };
    }
}

// ─── 해설 (스트리밍) ──────────────────────────────────────────
async function geminiExplainStream(question, answer, onChunk, onStatus) {
    const prompt = `정보보안기사 실기 전문가입니다. 다음 문제의 핵심 해설을 작성하세요.

규칙:
- 3~5문장 이내로 간결하게
- 핵심 개념 중심으로
- 마크다운, 불릿, 별표 없이 순수 텍스트만

문제: ${question}
정답: ${answer}`;

    await callGeminiStream(prompt, onChunk, onStatus);
}

// ─── AI 튜터 채팅 (스트리밍) ─────────────────────────────────
async function geminiChatStream(question, answer, explanation, message, onChunk, onStatus) {
    const prompt = `정보보안기사 실기 AI 튜터입니다. 학생의 질문에 답변하세요.

규칙:
- 3~5문장 이내로 핵심만
- 마크다운, 불릿, 별표 없이 순수 텍스트만

[문제] ${question}
[정답] ${answer}
[해설] ${explanation}
[질문] ${message}`;

    await callGeminiStream(prompt, onChunk, onStatus);
}

// 전역 노출
window.callGemini = callGemini;
window.callGeminiStream = callGeminiStream;
window.geminiScore = geminiScore;
window.geminiExplainStream = geminiExplainStream;
window.geminiChatStream = geminiChatStream;
window.getGeminiKey = getGeminiKey;
window.getGeminiModel = getGeminiModel;
