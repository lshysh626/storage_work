// ─── Gemini Direct API ────────────────────────────────────────
// 백엔드를 거치지 않고 Gemini API를 브라우저에서 직접 호출합니다.

const GEMINI_DEFAULT_KEY = '';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 모델 후보 (순서대로 시도)
const GEMINI_MODEL_FALLBACKS = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
];

function getGeminiKey() {
    return localStorage.getItem('gemini_api_key') || GEMINI_DEFAULT_KEY;
}

function getGeminiModel() {
    let model = localStorage.getItem('gemini_model');
    if (!model || model.includes('1.5')) {
        model = GEMINI_MODEL_FALLBACKS[0]; // gemini-2.0-flash
        localStorage.setItem('gemini_model', model);
    }
    return model;
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
    if (status === 400) return { isRateLimit: false, message: msg || 'API 키 또는 요청이 잘못되었습니다.' };
    if (status === 403) return { isRateLimit: false, message: msg || 'API 키 권한이 없습니다. 설정에서 키를 확인하세요.' };
    if (msg) {
        return { isRateLimit: false, message: `API 오류 (${status}): ${msg}` };
    }
    return { isRateLimit: false, message: `API 오류 (${status})` };
}

// ─── sleep 유틸 ──────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 일반 호출 (재시도 + 모델 폴백) ─────────────────────────
async function callGemini(prompt, schema = null) {
    const key = getGeminiKey();
    if (!key) {
        throw new Error("API 키가 등록되지 않았습니다. 설정(⚙️) 탭에서 개인 Gemini API 키를 입력해 주세요.");
    }
    const preferredModel = getGeminiModel();
    const models = [preferredModel, ...GEMINI_MODEL_FALLBACKS.filter(m => m !== preferredModel)];
    let lastErrorMsg = '';

    console.log("[Gemini API] callGemini Start. Key length:", key ? key.length : 0, "Preferred Model:", preferredModel);

    for (const model of models) {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`;
        console.log("[Gemini API] Attempting with model:", model);
        
        let retries = 2;
        let rateLimitCount = 0;
        while (retries >= 0) {
            retries--;
            
            const bodyPayload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { 
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    maxOutputTokens: 300
                }
            };

            if (schema) {
                bodyPayload.generationConfig.responseSchema = schema;
            }

            console.log(`[Gemini API] Sending fetch request to ${model}... (Remaining retries: ${retries + 1})`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000); // 12초 타임아웃

            try {
                const startTime = Date.now();
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyPayload),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`[Gemini API] Response received in ${duration}s. Status:`, res.status);

                if (res.ok) {
                    const data = await res.json();
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        console.log("[Gemini API] Call success!");
                        return text;
                    }
                    throw new Error("API 응답 구조가 올바르지 않거나 안전 필터링에 의해 차단되었습니다.");
                }

                if (res.status >= 500) {
                    const errBody = await res.json().catch(() => ({}));
                    const parsed = parseGeminiError(res.status, errBody);
                    lastErrorMsg = parsed.message;
                    const waitSec = 2 * (3 - retries); // 2s, 4s
                    console.warn(`[Gemini API] 5xx Server Error (${res.status}) on model ${model}. Retrying in ${waitSec} seconds...`);
                    await sleep(waitSec * 1000);
                    continue; // 동일 모델 재시도
                }

                const errBody = await res.json().catch(() => ({}));
                const parsed = parseGeminiError(res.status, errBody);
                lastErrorMsg = parsed.message;
                console.warn(`[Gemini API] Error status ${res.status}:`, lastErrorMsg, errBody);

                if (parsed.isRateLimit) {
                    if (key === GEMINI_DEFAULT_KEY) {
                        throw new Error("기본 제공 API 키의 일일 할당량이 모두 소진되었습니다. 설정(Settings) 탭에서 개인 API 키를 등록하시면 대기 시간 없이 즉시 채점이 가능합니다.");
                    }
                    
                    const errMsg = errBody?.error?.message || '';
                    const isDailyLimit = errMsg.includes('limit: 0') || errMsg.includes('limit:0') || 
                                         errMsg.includes('limit: 20') || errMsg.includes('limit:20') ||
                                         errMsg.includes('quota') || errMsg.includes('Quota');
                    if (isDailyLimit) {
                        console.warn(`[${model}] Daily limit reached. Falling back to next model...`);
                        lastErrorMsg = `[${model}] 일일 사용량 초과 (다른 모델로 대처 중)`;
                        break; // Try next model in the fallback list
                    }
                    
                    rateLimitCount++;
                    if (rateLimitCount > 1) {
                        console.warn(`[${model}] Exceeded maximum rate limit retries. Trying next model...`);
                        lastErrorMsg = parsed.message;
                        break; // Try next model in the fallback list instead of throwing
                    }
                    
                    const waitSec = Math.min(parsed.retrySec || 5, 10);
                    console.warn(`[${model}] Rate Limit hit. Waiting ${waitSec}s before retry...`);
                    await sleep(waitSec * 1000);
                    retries++; // 재시도 횟수 차감 방지
                    continue; // 동일 모델 재시도
                }

                break; // 다음 모델로 fallback
            } catch (fetchErr) {
                clearTimeout(timeoutId);
                console.error(`[Gemini API] Fetch exception on model ${model}:`, fetchErr);
                lastErrorMsg = fetchErr.name === 'AbortError' 
                    ? "API 요청 시간 초과 (12초) - 네트워크 연결이 원활하지 않거나 API 응답이 지연되고 있습니다." 
                    : `네트워크 오류 (${fetchErr.message})`;
                
                if (retries >= 0) {
                    console.warn(`[Gemini API] Retrying model ${model} after network error in 2 seconds...`);
                    await sleep(2000);
                    continue;
                }
                break;
            }
        }
    }

    throw new Error(lastErrorMsg || 'API 요청 실패');
}

// ─── 스트리밍 호출 (재시도 + 모델 폴백) ─────────────────────
async function callGeminiStream(prompt, onChunk, onStatus) {
    const key = getGeminiKey();
    if (!key) {
        throw new Error("API 키가 등록되지 않았습니다. 설정(⚙️) 탭에서 개인 Gemini API 키를 입력해 주세요.");
    }
    const preferredModel = getGeminiModel();
    const models = [preferredModel, ...GEMINI_MODEL_FALLBACKS.filter(m => m !== preferredModel)];
    let lastErrorMsg = '';

    for (const model of models) {
        const url = `${GEMINI_BASE}/${model}:streamGenerateContent?key=${key}&alt=sse`;
        let retries = 2;
        let rateLimitCount = 0;

        while (retries >= 0) {
            retries--;

            try {
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

                if (res.status >= 500) {
                    const errBody = await res.json().catch(() => ({}));
                    const parsed = parseGeminiError(res.status, errBody);
                    lastErrorMsg = parsed.message;
                    const waitSec = 2 * (3 - retries); // 2s, 4s
                    console.warn(`[Gemini API Stream] 5xx Server Error (${res.status}) on model ${model}. Retrying in ${waitSec} seconds...`);
                    await sleep(waitSec * 1000);
                    continue; // 동일 모델 재시도
                }

                const errBody = await res.json().catch(() => ({}));
                const parsed = parseGeminiError(res.status, errBody);
                lastErrorMsg = parsed.message;

                if (parsed.isRateLimit) {
                    if (key === GEMINI_DEFAULT_KEY) {
                        throw new Error("기본 제공 API 키의 일일 할당량이 모두 소진되었습니다. 설정(Settings) 탭에서 개인 API 키를 등록하시면 대기 시간 없이 즉시 채점이 가능합니다.");
                    }
                    
                    const errMsg = errBody?.error?.message || '';
                    const isDailyLimit = errMsg.includes('limit: 0') || errMsg.includes('limit:0') || 
                                         errMsg.includes('limit: 20') || errMsg.includes('limit:20') ||
                                         errMsg.includes('quota') || errMsg.includes('Quota');
                    if (isDailyLimit) {
                        console.warn(`[${model}] Daily limit reached. Falling back to next model...`);
                        lastErrorMsg = `[${model}] 일일 사용량 초과 (다른 모델로 대처 중)`;
                        break; // Try next model in the fallback list
                    }
                    
                    rateLimitCount++;
                    if (rateLimitCount > 1) {
                        console.warn(`[${model}] Exceeded maximum stream rate limit retries. Trying next model...`);
                        lastErrorMsg = parsed.message;
                        break; // Try next model in the fallback list instead of throwing
                    }
                    
                    const waitSec = Math.min(parsed.retrySec || 5, 10);
                    if (onStatus) onStatus(`[${model}] 한도 초과. ${waitSec}초 후 재시도...`);
                    await sleep(waitSec * 1000);
                    retries++; // 재시도 횟수 차감 방지
                    continue; // 동일 모델 재시도
                }

                break; // 다음 모델로 fallback
            } catch (err) {
                console.error(`[Gemini API Stream] Fetch exception on model ${model}:`, err);
                lastErrorMsg = `네트워크 오류 (${err.message})`;
                if (retries >= 0) {
                    console.warn(`[Gemini API Stream] Retrying model ${model} after error in 2 seconds...`);
                    await sleep(2000);
                    continue;
                }
                break;
            }
        }
    }

    throw new Error(lastErrorMsg || 'API 요청 실패');
}

// Robust parsing helper for AI scoring responses
function parseScoringResponse(text, defaultPoints) {
    const trimmed = text.trim();
    let result = null;
    
    // 1. Try standard JSON parse
    try {
        result = JSON.parse(trimmed);
    } catch (e) {
        // Ignore and try next
    }
    
    // 2. Try to extract JSON block from text
    if (!result) {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                result = JSON.parse(jsonMatch[0]);
            } catch (e) {
                // Ignore and try regex parsing
            }
        }
    }
    
    // 3. Fallback: Parse fields manually using Regex
    if (!result) {
        console.warn("[Gemini API] Failed to parse JSON response. Attempting regex field extraction on raw text:", trimmed);
        
        // Extract score
        let score = 0;
        const scoreMatch = trimmed.match(/"?(?:score|점수|점)"?\s*:\s*(\d+)/i) || trimmed.match(/(\d+)\s*(?:점|points)/i);
        if (scoreMatch) {
            score = parseInt(scoreMatch[1], 10);
        }
        
        // Extract is_correct
        let isCorrect = false;
        const correctMatch = trimmed.match(/"?(?:is_correct|correct|정답여부|정답)"?\s*:\s*(true|false|yes|no|y|n|일치|불일치|O|X)/i);
        if (correctMatch) {
            const val = correctMatch[1].toLowerCase();
            isCorrect = (val === 'true' || val === 'yes' || val === 'y' || val === '일치' || val === 'o');
        } else {
            // If score is 60% or more of max points, assume correct
            isCorrect = (score > 0 && score >= defaultPoints * 0.6);
        }
        
        // Extract feedback
        let feedback = '';
        // Try to match double-quoted string first to avoid greediness into other fields
        const jsonFeedbackMatch = trimmed.match(/"feedback"\s*:\s*"((?:[^"\\]|\\.)*)"/i) || 
                                trimmed.match(/(?:feedback|피드백|설명)\s*:\s*"((?:[^"\\]|\\.)*)"/i);
        if (jsonFeedbackMatch) {
            feedback = jsonFeedbackMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
        } else {
            const feedbackMatch = trimmed.match(/"?(?:feedback|피드백|설명)"?\s*:\s*([^\n]+)/i);
            if (feedbackMatch) {
                feedback = feedbackMatch[1].trim().replace(/^["']|["']$/g, '');
            } else {
                feedback = trimmed.replace(/[\{\}]/g, '').trim();
            }
        }
        
        result = {
            score: score,
            is_correct: isCorrect,
            feedback: feedback
        };
    }
    
    // Post-processing cleanup for feedback
    if (result && typeof result.feedback === 'string') {
        let fb = result.feedback.trim();
        // Remove trailing/leading quotes if they were returned as literal string escapes or leftovers
        if (fb === '"' || fb === '""' || fb === '\\"' || fb === '\\"\\"') {
            fb = '';
        }
        result.feedback = fb;
    }
    
    return result;
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

반드시 다른 설명 없이 아래 형태의 JSON 데이터만 응답하세요:
{"score": 숫자, "feedback": "오답/부분점수 시 1문장 피드백 (정답 시 빈 문자열 \\"\\")", "is_correct": true/false}`;

    let text = '';
    try {
        const schema = {
            type: 'OBJECT',
            properties: {
                score: { type: 'NUMBER' },
                feedback: { type: 'STRING' },
                is_correct: { type: 'BOOLEAN' }
            },
            required: ['score', 'feedback', 'is_correct']
        };
        text = await callGemini(prompt, schema);
        return parseScoringResponse(text, points);
    } catch (err) {
        console.error("[Gemini API] Single score error:", err, "Raw text was:", text);
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

작성 규칙:
- 가독성을 높이기 위해 영역/단락별로 줄바꿈(\\n)을 적극적으로 사용하세요.
- 글머리 기호(예: - 또는 ▶)와 번호(1., 2.)를 활용해 구조적으로 설명해 주세요.
- **, * 와 같은 마크다운 강조 표시(굵게/기울임 등)는 텍스트 그대로 화면에 출력되므로 절대 사용하지 마세요. 대신 줄바꿈과 띄어쓰기를 활용하세요.
- 핵심 개념 위주로 오답 원인이나 주의점을 3~5줄 내외로 간결하게 설명해 주세요.

문제: ${question}
정답: ${answer}`;

    await callGeminiStream(prompt, onChunk, onStatus);
}

// ─── AI 튜터 채팅 (스트리밍) ─────────────────────────────────
async function geminiChatStream(question, answer, explanation, message, onChunk, onStatus) {
    const prompt = `정보보안기사 실기 AI 튜터입니다. 학생의 질문에 핵심 위주로 친절하게 답변하세요.

작성 규칙:
- 가독성을 높이기 위해 설명 간에 줄바꿈(\\n)을 적극적으로 사용하세요.
- 번호(1., 2.) 또는 글머리 기호(예: - 또는 ▶)를 활용해 개념을 정리해 주세요.
- **, * 와 같은 마크다운 강조 표시(굵게/기울임 등)는 텍스트 그대로 화면에 출력되므로 절대 사용하지 마세요. 대신 줄바꿈과 문단 나누기를 활용하세요.
- 친근하고 간결하게 설명해 주세요.

[문제] ${question}
[정답] ${answer}
[해설] ${explanation}
[질문] ${message}`;

    await callGeminiStream(prompt, onChunk, onStatus);
}

// ─── 일괄 채점 ──────────────────────────────────────────────────
async function geminiScoreBulk(questionsToGrade) {
    const prompt = `정보보안기사 실기 시험 답안 일괄 채점기입니다. 다음 여러 문제들의 답안을 정밀 채점해 주세요.

채점할 문제 목록:
${JSON.stringify(questionsToGrade, null, 2)}

반드시 각 문제의 채점 결과를 담은 JSON 배열 형태로만 정확하게 응답해 주세요. 순서(index)는 원래 목록의 index 값과 일치해야 합니다.
JSON 응답 형식 예시:
[
  {"index": 0, "score": 3, "feedback": "피드백 문장", "is_correct": true},
  {"index": 2, "score": 0, "feedback": "피드백 문장", "is_correct": false}
]`;

    console.log("[Gemini API] Requesting bulk score for", questionsToGrade.length, "questions...");
    let text = '';
    try {
        const schema = {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    index: { type: 'INTEGER' },
                    score: { type: 'NUMBER' },
                    feedback: { type: 'STRING' },
                    is_correct: { type: 'BOOLEAN' }
                },
                required: ['index', 'score', 'feedback', 'is_correct']
            }
        };
        text = await callGemini(prompt, schema);
        console.log("[Gemini API] Received bulk response:", text);
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed;
        } catch (parseErr) {
            const match = text.match(/\[[\s\S]*\]/);
            const jsonText = match ? match[0] : text;
            const parsed = JSON.parse(jsonText);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (e) {
        console.error("[Gemini API] JSON Parse Error in bulk score:", e, "Raw text was:", text);
    }
    throw new Error('일괄 채점 응답 파싱 실패');
}

// 전역 노출
window.callGemini = callGemini;
window.callGeminiStream = callGeminiStream;
window.geminiScore = geminiScore;
window.geminiScoreBulk = geminiScoreBulk;
window.geminiExplainStream = geminiExplainStream;
window.geminiChatStream = geminiChatStream;
window.getGeminiKey = getGeminiKey;
window.getGeminiModel = getGeminiModel;

