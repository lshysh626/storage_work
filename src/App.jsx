import { useState, useEffect, useRef } from 'react';
import { collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { Book, FileText, Plus, Menu, X, Trash2 } from 'lucide-react';

function App() {
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Load notes from Firestore
  useEffect(() => {
    const q = query(collection(db, "notes"), orderBy("updatedAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setNotes(notesData);
      
      // Auto-select first note if none selected
      if (!activeNoteId && notesData.length > 0) {
        setActiveNoteId(notesData[0].id);
      }
    });

    return () => unsubscribe();
  }, [activeNoteId]);

  const activeNote = notes.find(n => n.id === activeNoteId);

  const createNote = async () => {
    const newNote = {
      title: "",
      body: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, "notes"), newNote);
    setActiveNoteId(docRef.id);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const updateNote = async (id, fields) => {
    const noteRef = doc(db, "notes", id);
    await updateDoc(noteRef, {
      ...fields,
      updatedAt: serverTimestamp()
    });
  };

  const deleteNote = async (id, e) => {
    e.stopPropagation();
    await deleteDoc(doc(db, "notes", id));
    if (activeNoteId === id) {
      setActiveNoteId(null);
    }
  };

  return (
    <div className="app-container">
      {/* Mobile Toggle */}
      <button 
        className="mobile-toggle" 
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
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
                {note.title || "새 문서"}
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
            <textarea
              className="body-textarea"
              placeholder="내용을 입력하세요..."
              value={activeNote.body}
              onChange={(e) => updateNote(activeNote.id, { body: e.target.value })}
            />
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={48} color="#d4d4d4" />
            <p>왼쪽에서 페이지를 선택하거나 새 페이지를 만드세요.</p>
            <button 
              style={{ padding: '8px 16px', background: '#2383e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              onClick={createNote}
            >
              + 새 페이지 만들기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
