import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { Bold, Heading2, Italic, List, ListOrdered, Maximize2, Quote, Redo2, Undo2 } from 'lucide-react'
import type { ManuscriptNode, SceneDocument } from '../../shared/types'
import { api } from '../lib/api'
import { sceneStatusLabel } from '../lib/status'
import { countWords } from '../lib/text'

interface Props {
  node: ManuscriptNode
  focusMode: boolean
  onFocusMode: (value: boolean) => void
  onSaved: (document: SceneDocument, wordCount: number) => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function WritingEditor({ node, focusMode, onFocusMode, onSaved, notify }: Props) {
  const [document, setDocument] = useState<SceneDocument | null>(null)
  const [saveState, setSaveState] = useState<'loading' | 'dirty' | 'saving' | 'saved' | 'error'>('loading')
  const [words, setWords] = useState(node.wordCount)
  const loadingRef = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeNodeRef = useRef(node.id)
  const nextSourceRef = useRef<'human' | 'ai_accepted'>('human')
  const nextTaskRef = useRef<string | null>(null)

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: '从这里开始。先写下一句话，故事就会继续。' }), CharacterCount],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    autofocus: 'end',
    editorProps: { attributes: { class: 'prose-editor', 'aria-label': '正文编辑器' } },
    onUpdate: ({ editor }) => {
      if (loadingRef.current) return
      setWords(countWords(editor.getText()))
      setSaveState('dirty')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const nodeId = activeNodeRef.current
      saveTimer.current = setTimeout(() => void persist(nodeId, editor.getJSON() as Record<string, unknown>, editor.getText(), nextSourceRef.current, nextTaskRef.current), 900)
    },
  })

  async function persist(nodeId: string, json: Record<string, unknown>, text: string, sourceType: 'human' | 'ai_accepted' = 'human', sourceTaskId: string | null = null) {
    setSaveState('saving')
    try {
      const saved = await api.saveScene(nodeId, json, text, sourceType, sourceTaskId)
      if (activeNodeRef.current === nodeId) {
        setDocument(saved); setSaveState('saved'); onSaved(saved, countWords(text)); nextSourceRef.current = 'human'; nextTaskRef.current = null
      }
    } catch (error) { setSaveState('error'); notify('error', error instanceof Error ? error.message : '保存失败') }
  }

  useEffect(() => {
    let cancelled = false
    activeNodeRef.current = node.id
    loadingRef.current = true
    setSaveState('loading')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void api.getScene(node.id).then((next) => {
      if (cancelled || !editor) return
      setDocument(next)
      editor.commands.setContent(next.contentJson)
      setWords(countWords(next.plainText))
      setSaveState('saved')
      setTimeout(() => { loadingRef.current = false }, 0)
    }).catch((error) => notify('error', error instanceof Error ? error.message : '场景加载失败'))
    return () => { cancelled = true }
  }, [node.id, editor])

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  useEffect(() => {
    const acceptAi = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; taskId: string }>).detail
      if (!detail?.text || !editor) return
      nextSourceRef.current = 'ai_accepted'
      nextTaskRef.current = detail.taskId
      editor.chain().focus().insertContent(`\n${detail.text}`).run()
    }
    window.addEventListener('bbd:accept-ai', acceptAi)
    const undoAi = () => { nextSourceRef.current = 'human'; nextTaskRef.current = null; editor?.chain().focus().undo().run() }
    window.addEventListener('bbd:undo-ai', undoAi)
    return () => { window.removeEventListener('bbd:accept-ai', acceptAi); window.removeEventListener('bbd:undo-ai', undoAi) }
  }, [editor])

  useEffect(() => {
    const locate = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string; startOffset: number; endOffset: number }>).detail
      if (!editor || detail?.nodeId !== activeNodeRef.current) return
      const from = documentPosition(editor.state.doc, detail.startOffset); const to = documentPosition(editor.state.doc, detail.endOffset)
      editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()
    }
    window.addEventListener('bbd:locate-mention', locate)
    window.addEventListener('bbd:read-position', locate)
    return () => { window.removeEventListener('bbd:locate-mention', locate); window.removeEventListener('bbd:read-position', locate) }
  }, [editor])

  if (!editor) return <div className="editor-loading">正在准备纸张…</div>

  const stateLabel = { loading: '正在读取', dirty: '有未保存修改', saving: '正在保存', saved: '已保存到本机', error: '保存失败' }[saveState]
  return <section className={`editor-pane ${focusMode ? 'focus-mode' : ''}`}>
    <header className="editor-header">
      <div><span className="scene-kicker">{sceneStatusLabel(node.status)}</span><h2>{node.title}</h2></div>
      <div className="editor-meta"><span>{words.toLocaleString('zh-CN')} 字</span><span className={`save-state save-${saveState}`}>{stateLabel}</span><button className="icon-button" onClick={() => onFocusMode(!focusMode)} aria-label={focusMode ? '退出专注模式' : '进入专注模式'}><Maximize2 size={17} /></button></div>
    </header>
    <div className="format-toolbar" role="toolbar" aria-label="文字格式">
      <button className={editor.isActive('bold') ? 'active' : ''} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="粗体"><Bold size={16} /></button>
      <button className={editor.isActive('italic') ? 'active' : ''} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="斜体"><Italic size={16} /></button>
      <button className={editor.isActive('heading', { level: 2 }) ? 'active' : ''} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="二级标题"><Heading2 size={16} /></button>
      <span className="toolbar-separator" />
      <button className={editor.isActive('bulletList') ? 'active' : ''} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="无序列表"><List size={16} /></button>
      <button className={editor.isActive('orderedList') ? 'active' : ''} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="有序列表"><ListOrdered size={16} /></button>
      <button className={editor.isActive('blockquote') ? 'active' : ''} onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label="引用"><Quote size={16} /></button>
      <span className="toolbar-spacer" />
      <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} aria-label="撤销"><Undo2 size={16} /></button>
      <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} aria-label="重做"><Redo2 size={16} /></button>
    </div>
    <div className="paper-scroll"><EditorContent editor={editor} /></div>
    <footer className="editor-footer"><span>{document ? `版本 ${document.contentHash.slice(0, 7)}` : '加载中'}</span><span>离线可写 · 自动留痕</span></footer>
  </section>
}

function documentPosition(doc: { descendants: (callback: (node: { isText: boolean; text?: string | null }, pos: number) => boolean | void) => void; content: { size: number } }, offset: number) {
  let seen = 0; let result = Math.min(1 + offset, doc.content.size)
  doc.descendants((node, pos) => { if (!node.isText) return; const length = node.text?.length ?? 0; if (seen + length >= offset) { result = pos + Math.max(0, offset - seen); return false } seen += length })
  return Math.max(1, Math.min(result, doc.content.size))
}

