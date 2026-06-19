const fs = require('fs');

const allData = JSON.parse(fs.readFileSync('./public/exam/data/questions_all.json', 'utf8'));

let fixedCount = 0;

for (let q of allData.questions) {
    if (!q.question.includes('[보기]')) continue;
    
    const lines = q.question.split('\n');
    let bogiIndex = lines.findIndex(l => l.includes('[보기]'));
    if (bogiIndex <= 1) continue; // If [보기] is the first or second line, it's fine.

    // Look for lines before [보기] that start with a marker like (A), (1), 가., etc.
    let firstMarkerIndex = -1;
    for (let i = 1; i < bogiIndex; i++) {
        const line = lines[i].trim();
        if (/^\s*\([a-zA-Z0-9가-힣]+\)\s*[:.]/.test(line) || /^\s*[가-힣0-9]+\)\s*/.test(line) || /^\s*[①-⑳]/.test(line)) {
            firstMarkerIndex = i;
            break;
        }
    }

    if (firstMarkerIndex !== -1 && firstMarkerIndex < bogiIndex) {
        // We found a list item BEFORE [보기]. We need to move [보기] to just before firstMarkerIndex.
        console.log(`Fixing Q${q.original_id || q.id}: moving [보기] from line ${bogiIndex} to ${firstMarkerIndex}`);
        const bogiLine = lines.splice(bogiIndex, 1)[0];
        lines.splice(firstMarkerIndex, 0, bogiLine);
        q.question = lines.join('\n');
        fixedCount++;
    }
}

console.log(`Fixed ${fixedCount} questions.`);
fs.writeFileSync('./public/exam/data/questions_all.json', JSON.stringify(allData, null, 2), 'utf8');

// Now run rebuild logic
const shortQuestions = allData.questions.filter(q => q.type === 'short');
const essayQuestions = allData.questions.filter(q => q.type === 'essay');
const practicalQuestions = allData.questions.filter(q => q.type === 'practical');

fs.writeFileSync('./public/exam/data/questions_type_short.json', JSON.stringify({ questions: shortQuestions }, null, 2));
fs.writeFileSync('./public/exam/data/questions_type_essay.json', JSON.stringify({ questions: essayQuestions }, null, 2));
fs.writeFileSync('./public/exam/data/questions_type_practical.json', JSON.stringify({ questions: practicalQuestions }, null, 2));
