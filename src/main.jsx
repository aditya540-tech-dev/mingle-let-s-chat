import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = '/api';
const tokenKey = 'mingle-token';
const getToken = () => localStorage.getItem(tokenKey);
const initials = value => (value || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
function usePrivateAsset(path) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!path) { setSrc(''); return; }
    if (!path.startsWith('/uploads/')) { setSrc(path); return; }
    let objectUrl; let alive = true;
    fetch(`/api/files/${encodeURIComponent(path.slice('/uploads/'.length))}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(response => { if (!response.ok) throw new Error('File unavailable'); return response.blob(); })
      .then(blob => { objectUrl = URL.createObjectURL(blob); if (alive) setSrc(objectUrl); })
      .catch(() => { if (alive) setSrc(''); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return src;
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (getToken()) headers.set('Authorization', `Bearer ${getToken()}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API}${url}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function Avatar({ person, className = '' }) {
  const src = usePrivateAsset(person?.photo);
  return <span className={`avatar ${className}`}>{src ? <img src={src} alt="" /> : initials(person?.name)}</span>;
}

function PrivateImage({ path, name }) {
  const src = usePrivateAsset(path);
  return src ? <img className="chat-image" src={src} alt={name} /> : <span className="file-chip">Loading photo…</span>;
}

async function downloadPrivateFile(path, filename) {
  const response = await fetch(`/api/files/${encodeURIComponent(path.split('/').at(-1))}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!response.ok) throw new Error('File is unavailable.');
  const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function Auth({ onAuth }) {
  const [mode, setMode] = useState('login'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await request(`/auth/${mode === 'signup' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') }) });
      localStorage.setItem(tokenKey, data.token); onAuth(data.user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="auth-screen"><form className="auth-card" onSubmit={submit}>
    <div className="brand"><span className="brand-mark">m</span><span className="brand-name">Mingle</span></div>
    <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1><p className="muted">{mode === 'signup' ? 'A few details and you’re ready to mingle.' : 'Sign in to pick up where you left off.'}</p>
    <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Create account</button></div>
    {mode === 'signup' && <label>Your name<input name="name" autoComplete="name" required maxLength="50" /></label>}
    <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
    <label>Password<input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength="8" placeholder="At least 8 characters" /></label>
    {error && <p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
    <p className="fine-print">Your Mingle account is stored securely on the server. Messages are saved in your database.</p>
  </form></main>;
}

function ProfileDialog({ user, onClose, onSave, onSignOut }) {
  const [name, setName] = useState(user.name); const [photo, setPhoto] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event) { event.preventDefault(); setBusy(true); setError(''); const body = new FormData(); body.append('name', name); if (photo) body.append('photo', photo); try { await onSave(body); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}><form className="dialog" onSubmit={save}><button type="button" className="x" onClick={onClose}>×</button><h2>Your profile</h2><p className="muted">Update how you appear in Mingle.</p><div className="profile-photo"><Avatar person={{ ...user, photo: photo ? URL.createObjectURL(photo) : user.photo }} /><label className="outline small">Choose photo<input hidden type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] || null)} /></label></div><label>Display name<input value={name} onChange={e => setName(e.target.value)} required maxLength="50" /></label><label>Email<input value={user.email} disabled /></label>{error && <p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button><button type="button" className="outline signout" onClick={onSignOut}>Sign out</button></form></div>;
}

function SummaryDialog({ summary, onClose }) {
  return <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="dialog summary-dialog"><button className="x" onClick={onClose}>×</button><span className="tag">GEMINI CHAT RECAP</span><h2>Here’s the gist</h2><p className="muted">A concise overview of the conversation.</p><div className="summary-text">{summary}</div><button className="primary" onClick={onClose}>Done</button></section></div>;
}

function App() {
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false); const [chats, setChats] = useState([]); const [active, setActive] = useState(null); const [messages, setMessages] = useState([]); const [text, setText] = useState(''); const [file, setFile] = useState(null); const [query, setQuery] = useState(''); const [theme, setTheme] = useState(localStorage.getItem('mingle-theme') || 'light'); const [profileOpen, setProfileOpen] = useState(false); const [summary, setSummary] = useState(''); const [busy, setBusy] = useState(false); const [toast, setToast] = useState(''); const [editingId, setEditingId] = useState(null); const [editText, setEditText] = useState(''); const fileRef = useRef(null); const bottomRef = useRef(null);
  const notify = message => { setToast(message); window.setTimeout(() => setToast(''), 2800); };
  const loadChats = useCallback(async () => { const data = await request('/conversations'); setChats(data.conversations); setActive(current => current ? data.conversations.find(chat => chat.id === current.id) || current : data.conversations[0] || null); }, []);
  const loadMessages = useCallback(async id => { const data = await request(`/conversations/${id}/messages`); setMessages(data.messages); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('mingle-theme', theme); }, [theme]);
  useEffect(() => { let mounted = true; (async () => { if (getToken()) { try { const data = await request('/auth/me'); if (mounted) { setUser(data.user); const chatsData = await request('/conversations'); setChats(chatsData.conversations); setActive(chatsData.conversations[0] || null); } } catch { localStorage.removeItem(tokenKey); } } if (mounted) setReady(true); })(); return () => { mounted = false; }; }, []);
  useEffect(() => { if (active && user) { loadMessages(active.id).catch(err => notify(err.message)); } else setMessages([]); }, [active?.id, user, loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (!user) return; const timer = window.setInterval(() => { loadChats().catch(() => {}); if (active) loadMessages(active.id).catch(() => {}); }, 8000); return () => window.clearInterval(timer); }, [user, active?.id, loadChats, loadMessages]);
  if (!ready) return <div className="loading">Opening Mingle…</div>;
  if (!user) return <Auth onAuth={async value => { setUser(value); await loadChats(); }} />;
  const filtered = chats.filter(chat => `${chat.person?.name || ''} ${chat.person?.email || ''} ${chat.lastMessage || ''}`.toLowerCase().includes(query.toLowerCase()));
  async function send(event) { event.preventDefault(); if (!text.trim() && !file) return; const body = new FormData(); if (text.trim()) body.append('text', text.trim()); if (file) body.append('attachment', file); setBusy(true); try { const data = await request(`/conversations/${active.id}/messages`, { method: 'POST', body }); setMessages(previous => [...previous, data.message]); setText(''); setFile(null); if (fileRef.current) fileRef.current.value = ''; await loadChats(); } catch (err) { notify(err.message); } finally { setBusy(false); } }
  async function saveEdit(messageId) { try { const data = await request(`/conversations/${active.id}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ text: editText }) }); setMessages(previous => previous.map(message => message._id === messageId ? data.message : message)); setEditingId(null); setEditText(''); await loadChats(); } catch (err) { notify(err.message); } }
  async function newChat() { const email = window.prompt('Enter the email address of the person you want to chat with:'); if (!email) return; try { const data = await request('/conversations', { method: 'POST', body: JSON.stringify({ email }) }); await loadChats(); setActive(data.conversation); } catch (err) { notify(err.message); } }
  async function doSummary() { if (!active) return; setBusy(true); try { const data = await request(`/conversations/${active.id}/summarize`, { method: 'POST' }); setSummary(data.summary); } catch (err) { notify(err.message); } finally { setBusy(false); } }
  async function saveProfile(body) { const data = await request('/auth/me', { method: 'PATCH', body }); setUser(data.user); }
  function signOut() { localStorage.removeItem(tokenKey); setUser(null); setChats([]); setActive(null); setMessages([]); setProfileOpen(false); }
  return <div className="app"><header className="topbar"><a className="brand" href="#"><span className="brand-mark">m</span><span className="brand-name">Mingle</span><span className="brand-note">a little more in sync</span></a><div className="top-actions"><button className="icon-button" title="Switch theme" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '☾' : '☼'}</button><button className="user-button" onClick={() => setProfileOpen(true)}><Avatar person={user} /><span>{user.name}</span></button></div></header>
    <main className="shell"><aside className={`sidebar ${active ? 'mobile-hidden' : ''}`}><div className="side-head"><h1>Messages</h1><button className="new-chat" title="New conversation" onClick={newChat}>＋</button></div><input className="search" placeholder="Find a conversation" value={query} onChange={e => setQuery(e.target.value)} /><div className="label-row">YOUR PEOPLE <span>{chats.length}</span></div><div className="chat-list">{filtered.map(chat => <button key={chat.id} className={`chat-item ${active?.id === chat.id ? 'selected' : ''}`} onClick={() => setActive(chat)}><Avatar person={chat.person} /><span className="chat-details"><span className="chat-title">{chat.person?.name || 'Unknown person'}</span><span className="chat-preview">{chat.lastMessage || 'Start a conversation'}</span></span></button>)}{!filtered.length && <div className="empty-state">{query ? 'No matches. Try another search.' : 'Your conversations will show up here. Start one with ＋.'}</div>}</div><button className="account-row" onClick={() => setProfileOpen(true)}><Avatar person={user} /><span><strong>{user.name}</strong><small>{user.email}</small></span><span className="more">•••</span></button></aside>
    <section className={`conversation ${active ? 'mobile-open' : ''}`}><div className="conversation-head">{active ? <><button className="back-button" onClick={() => setActive(null)} aria-label="Back to chats">‹</button><Avatar person={active.person} /><div className="person"><strong>{active.person?.name}</strong><small>{active.person?.email}</small></div><span className="head-spacer"/><button className="recap-button" disabled={busy} onClick={doSummary}>✦ <span>{busy ? 'Working…' : 'Recap'}</span></button></> : <div className="empty-head">Your messages</div>}</div>
      {active ? <><div className="message-area">{messages.length ? <div className="day-divider">YOUR CONVERSATION</div> : <div className="empty-chat"><span className="brand-mark">m</span><h2>Say hello to {active.person?.name?.split(' ')[0] || 'your new friend'}</h2><p>Your conversation starts here.</p></div>}{messages.map(message => { const mine = message.sender?._id === user.id || message.sender === user.id; return <article key={message._id} className={`message-row ${mine ? 'mine' : ''}`}>{!mine && <Avatar person={message.sender} className="tiny" />}<div className="message-content">{message.text && <div className="bubble message-bubble">{editingId === message._id ? <form onSubmit={e => { e.preventDefault(); saveEdit(message._id); }}><textarea className="edit-input" value={editText} onChange={e => setEditText(e.target.value)} maxLength="5000" autoFocus /><div className="edit-actions"><button type="submit">Save</button><button type="button" onClick={() => setEditingId(null)}>Cancel</button></div></form> : <>{message.text}{mine && <button className="edit-message" title="Edit message" aria-label="Edit sent message" onClick={() => { setEditingId(message._id); setEditText(message.text); }}>✎</button>}</>}</div>}{message.attachment && <div className="bubble attachment">{message.attachment.mimeType?.startsWith('image/') ? <PrivateImage path={message.attachment.url} name={message.attachment.name} /> : <button className="pdf-card" onClick={() => downloadPrivateFile(message.attachment.url, message.attachment.name).catch(err => notify(err.message))}><span className="pdf-icon">PDF</span><span><strong>{message.attachment.name}</strong><small>{(message.attachment.size / 1024).toFixed(0)} KB</small></span></button>}</div>}<small className="message-time">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{message.editedAt ? ' · edited' : ''}</small></div></article>; })}<div ref={bottomRef} /></div>
      <div className="composer-wrap">{file && <div className="file-chip">{file.name}<button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>×</button></div>}<form className="composer" onSubmit={send}><button type="button" className="attach-button" title="Attach photo or PDF" onClick={() => fileRef.current?.click()}>⌁</button><input ref={fileRef} type="file" hidden accept="image/*,.pdf,application/pdf" onChange={e => { const selected = e.target.files?.[0]; if (selected && selected.size > 12 * 1024 * 1024) { notify('Choose a file smaller than 12 MB.'); e.target.value = ''; return; } if (selected) setFile(selected); }} /><input value={text} onChange={e => setText(e.target.value)} placeholder="Write something kind…" aria-label="Write a message" /><button className="send-button" disabled={busy || (!text.trim() && !file)} aria-label="Send">➤</button></form><div className="compose-hint">A good conversation can start with anything.</div></div></> : <div className="empty-chat welcome"><span className="brand-mark">m</span><h2>Make room for a good conversation</h2><p>Start a new chat with someone who already has a Mingle account.</p><button className="primary compact" onClick={newChat}>Start a conversation</button></div>}</section></main>
    {profileOpen && <ProfileDialog user={user} onClose={() => setProfileOpen(false)} onSave={saveProfile} onSignOut={signOut} />}{summary && <SummaryDialog summary={summary} onClose={() => setSummary('')} />}{toast && <div className="toast">{toast}</div>}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
