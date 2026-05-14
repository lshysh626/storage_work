import { useState, useEffect, useRef, useCallback } from 'react';
import { collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { Book, FileText, Plus, Menu, X, Trash2, GraduationCap, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Image, Type, Palette, List, ListOrdered, ChevronDown } from 'lucide-react';

// ── 기능 소개 홈 화면 ──────────────────────────────────────────
function HomeScreen({ onCreateNote, onGoExam }) {
  const features = [
    {
      icon: '✍️',
      title: '강력한 리치 텍스트',
      desc: '글자 크기, 색상, 배경색은 물론 굵기, 기울기, 밑줄 등 풍성한 서식을 지원합니다.',
      color: '#2383e2',
      bg: 'rgba(35,131,226,0.08)',
    },
    {
      icon: '🖼️',
      title: '이미지 삽입 지원',
      desc: '드래그 앤 드롭이나 파일 선택으로 공부 자료 이미지를 노트에 바로 삽입하세요.',
      color: '#9b59b6',
      bg: 'rgba(155,89,182,0.08)',
    },
    {
      icon: '☁️',
      title: '실시간 클라우드 동기화',
      desc: 'Firebase Firestore를 통해 작성 즉시 저장되며, 모든 기기에서 실시간으로 동기화됩니다.',
      color: '#e67e22',
      bg: 'rgba(230,126,34,0.08)',
    },
    {
      icon: '📱',
      title: '반응형 대시보드',
      desc: 'PC와 모바일 어디서나 최적화된 화면으로 노트를 관리하고 검토할 수 있습니다.',
      color: '#2ecc71',
      bg: 'rgba(46,204,113,0.08)',
    },
    {
      icon: '📂',
      title: '노트 체계적 관리',
      desc: '사이드바에서 모든 노트를 한눈에 보고, 삭제 및 수정을 자유롭게 수행하세요.',
      color: '#34495e',
      bg: 'rgba(52,73,94,0.08)',
    },
    {
      icon: '🎓',
      title: '학습 연동 시스템',
      desc: '공부하다가 기출문제가 풀고 싶다면 상단 메뉴나 버튼을 통해 바로 기출돌려로 이동하세요.',
      color: '#f1c40f',
      bg: 'rgba(241,196,15,0.08)',
    },
  ];

  return (
    <div className="home-screen">
      <div className="home-hero">
        <div className="home-hero-icon">🗒️</div>
        <h1 className="home-title">나의 지식 저장소</h1>
        <p className="home-subtitle">공부한 내용을 실시간으로 정리하고 영구적으로 보관하세요</p>
        <div className="home-cta-row">
          <button className="home-cta-btn primary" onClick={onCreateNote}>
            <Plus size={18} /> 새 노트 시작하기
          </button>
          <a className="home-cta-btn secondary" href="/storage_work/exam/" target="_blank" rel="noopener noreferrer">
            <GraduationCap size={18} /> 기출문제 풀러가기
          </a>
        </div>
      </div>

      <div className="home-features-title">✨ 정리장 주요 기능</div>
      <div className="home-features-grid">
        {features.map((f, i) => (
          <div key={i} className="feature-card" style={{ borderLeftColor: f.color, background: f.bg }}>
            <div className="feature-icon">{f.icon}</div>
            <div className="feature-body">
              <div className="feature-name" style={{ color: f.color }}>{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="home-shortcut-section">
        <div className="home-features-title">⌨️ 편집기 단축키</div>
        <div className="shortcut-grid">
          {[
            ['Ctrl + B', '굵게 (Bold)'],
            ['Ctrl + I', '기울임 (Italic)'],
            ['Ctrl + U', '밑줄 (Underline)'],
            ['Ctrl + Z', '실행 취소'],
          ].map(([key, desc]) => (
            <div key={key} className="shortcut-row">
              <kbd className="shortcut-key">{key}</kbd>
              <span className="shortcut-desc">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ── 리치 텍스트 에디터 툴바 ────────────────────────────────────
function RichToolbar({ editorRef }) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showFontSize, setShowFontSize] = useState(false);

  const exec = useCallback((cmd, value = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  }, [editorRef]);

  const COLORS = [
    '#000000','#374151','#6b7280','#9ca3af','#d1d5db','#ffffff',
    '#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6',
    '#ec4899','#06b6d4','#14b8a6','#a855f7','#f43f5e','#84cc16',
  ];

  const FONT_SIZES = [
    { label: '소 (12px)', val: '2' },
    { label: '보통 (16px)', val: '3' },
    { label: '중 (20px)', val: '4' },
    { label: '대 (24px)', val: '5' },
    { label: '특대 (32px)', val: '6' },
  ];

  const insertImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        editorRef.current?.focus();
        document.execCommand('insertImage', false, ev.target.result);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div className="rich-toolbar">
      {/* 글자 크기 */}
      <div className="toolbar-group relative">
        <button className="tb-btn" title="글자 크기" onClick={() => { setShowFontSize(v => !v); setShowColorPicker(false); setShowBgPicker(false); }}>
          <Type size={14} /><ChevronDown size={10} />
        </button>
        {showFontSize && (
          <div className="tb-dropdown">
            {FONT_SIZES.map(f => (
              <div key={f.val} className="tb-dropdown-item" onMouseDown={e => { e.preventDefault(); exec('fontSize', f.val); setShowFontSize(false); }}>
                {f.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar-sep" />

      {/* 굵기/기울기/밑줄 */}
      <button className="tb-btn" title="굵게 (Ctrl+B)" onMouseDown={e => { e.preventDefault(); exec('bold'); }}><Bold size={14} /></button>
      <button className="tb-btn" title="기울기 (Ctrl+I)" onMouseDown={e => { e.preventDefault(); exec('italic'); }}><Italic size={14} /></button>
      <button className="tb-btn" title="밑줄 (Ctrl+U)" onMouseDown={e => { e.preventDefault(); exec('underline'); }}><Underline size={14} /></button>

      <div className="toolbar-sep" />

      {/* 글자 색 */}
      <div className="toolbar-group relative">
        <button className="tb-btn" title="글자 색" onClick={() => { setShowColorPicker(v => !v); setShowBgPicker(false); setShowFontSize(false); }}>
          <Palette size={14} /><span style={{ fontSize: '9px', marginLeft: '1px' }}>A</span>
        </button>
        {showColorPicker && (
          <div className="color-picker-panel">
            <div className="color-picker-label">글자 색</div>
            <div className="color-grid">
              {COLORS.map(c => (
                <button key={c} className="color-swatch" style={{ background: c, border: c === '#ffffff' ? '1px solid #ccc' : 'none' }}
                  onMouseDown={e => { e.preventDefault(); exec('foreColor', c); setShowColorPicker(false); }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 배경 색 */}
      <div className="toolbar-group relative">
        <button className="tb-btn" title="배경 색" onClick={() => { setShowBgPicker(v => !v); setShowColorPicker(false); setShowFontSize(false); }}>
          <span style={{ fontSize: '12px', fontWeight: 700 }}>BG</span><ChevronDown size={10} />
        </button>
        {showBgPicker && (
          <div className="color-picker-panel">
            <div className="color-picker-label">배경 색</div>
            <div className="color-grid">
              {COLORS.map(c => (
                <button key={c} className="color-swatch" style={{ background: c, border: c === '#ffffff' ? '1px solid #ccc' : 'none' }}
                  onMouseDown={e => { e.preventDefault(); exec('hiliteColor', c); setShowBgPicker(false); }} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="toolbar-sep" />

      {/* 정렬 */}
      <button className="tb-btn" title="왼쪽 정렬" onMouseDown={e => { e.preventDefault(); exec('justifyLeft'); }}><AlignLeft size={14} /></button>
      <button className="tb-btn" title="가운데 정렬" onMouseDown={e => { e.preventDefault(); exec('justifyCenter'); }}><AlignCenter size={14} /></button>
      <button className="tb-btn" title="오른쪽 정렬" onMouseDown={e => { e.preventDefault(); exec('justifyRight'); }}><AlignRight size={14} /></button>

      <div className="toolbar-sep" />

      {/* 목록 */}
      <button className="tb-btn" title="글머리 기호" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }}><List size={14} /></button>
      <button className="tb-btn" title="번호 목록" onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }}><ListOrdered size={14} /></button>

      <div className="toolbar-sep" />

      {/* 이미지 */}
      <button className="tb-btn" title="이미지 삽입" onMouseDown={e => { e.preventDefault(); insertImage(); }}>
        <Image size={14} />
      </button>
    </div>
  );
}

// ── 메인 앱 ────────────────────────────────────────────────────
function App() {
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const editorRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Load notes from Firestore
  useEffect(() => {
    const q = query(collection(db, 'notes'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notesData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setNotes(notesData);
    });
    return () => unsubscribe();
  }, []);

  const activeNote = notes.find(n => n.id === activeNoteId);

  // Sync contentEditable → Firestore (debounced)
  useEffect(() => {
    if (!activeNote || !editorRef.current) return;
    // only set innerHTML if it differs (avoids cursor jump)
    if (editorRef.current.innerHTML !== (activeNote.body || '')) {
      editorRef.current.innerHTML = activeNote.body || '';
    }
  }, [activeNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditorInput = () => {
    if (!activeNoteId) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const html = editorRef.current?.innerHTML || '';
      updateNote(activeNoteId, { body: html });
    }, 800);
  };

  const createNote = async () => {
    const newNote = {
      title: '',
      body: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(db, 'notes'), newNote);
    setActiveNoteId(docRef.id);
    if (window.innerWidth <= 768) setSidebarOpen(false);
    setTimeout(() => editorRef.current?.focus(), 100);
  };

  const updateNote = async (id, fields) => {
    await updateDoc(doc(db, 'notes', id), { ...fields, updatedAt: serverTimestamp() });
  };

  const deleteNote = async (id, e) => {
    e.stopPropagation();
    await deleteDoc(doc(db, 'notes', id));
    if (activeNoteId === id) setActiveNoteId(null);
  };

  return (
    <div className="app-container">
      {/* Mobile Toggle */}
      <button className="mobile-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header" onClick={() => setActiveNoteId(null)}>
          <Book size={18} />
          나의 정리장
        </div>

        <div className="note-list">
          {notes.map(note => (
            <div
              key={note.id}
              className={`note-item ${activeNoteId === note.id ? 'active' : ''}`}
              onClick={() => {
                setActiveNoteId(note.id);
                if (window.innerWidth <= 768) setSidebarOpen(false);
              }}
            >
              <FileText size={16} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {note.title || '새 문서'}
              </span>
              <Trash2
                size={14}
                className="delete-icon"
                onClick={(e) => deleteNote(note.id, e)}
                style={{ color: '#d4d4d4', opacity: activeNoteId === note.id ? 1 : 0 }}
              />
            </div>
          ))}
        </div>

        <a
          href="/storage_work/exam/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            margin: '0 8px 4px 8px', padding: '8px 12px', display: 'flex',
            alignItems: 'center', gap: '8px', cursor: 'pointer',
            color: '#2383e2', fontSize: '14px', borderRadius: '4px',
            border: 'none', background: 'rgba(35,131,226,0.08)',
            textDecoration: 'none', fontWeight: '500',
          }}
        >
          <GraduationCap size={16} />
          📚 기출돌려 (시험 훈련)
        </a>

        <button className="add-note-btn" onClick={createNote}>
          <Plus size={16} />
          페이지 추가
        </button>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {activeNote ? (
          <div className="editor-container">
            <input
              type="text"
              className="title-input"
              placeholder="제목 없음"
              value={activeNote.title}
              onChange={(e) => updateNote(activeNote.id, { title: e.target.value })}
            />

            {/* Rich Text Toolbar */}
            <RichToolbar editorRef={editorRef} />

            {/* ContentEditable Editor */}
            <div
              ref={editorRef}
              className="body-editor"
              contentEditable
              suppressContentEditableWarning
              onInput={handleEditorInput}
              data-placeholder="내용을 입력하세요..."
            />
          </div>
        ) : (
          <HomeScreen onCreateNote={createNote} onGoExam={() => window.open('/storage_work/exam/', '_blank')} />
        )}
      </div>
    </div>
  );
}

export default App;
