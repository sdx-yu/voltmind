import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { Bold, Heading2, Italic, List, ListOrdered, Quote, Redo2, Sparkles, Undo2 } from 'lucide-react'
import type { EditorAiRequest, ManuscriptNode, SceneDocument, TextSelectionAnchor } from '../../shared/types'
import { api } from '../lib/api'
import { sceneStatusLabel } from '../lib/status'
import { countWords } from '../lib/text'
import { IconButton, Toolbar, ToolGroup } from '../ui'
import { SceneHeader, type EditorSaveState } from './SceneHeader'

interface Props {
  node: ManuscriptNode
  focusMode: boolean
  onFocusMode: (value: boolean) => void
  onSaved: (document: SceneDocument, wordCount: number) => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function WritingEditor({ node, focusMode, onFocusMode, onSaved, notify }: Props) {
  const [document, setDocument] = useState<SceneDocument | null>(null)
  const [saveState, setSaveState] = useState<EditorSaveState>('loading')
  const [words, setWords] = useState(node.wordCount)
  const loadingRef = useRef(true)
  const documentRef = useRef<SceneDocument | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateRef = useRef(saveState)
  const activeNodeRef = useRef(node.id)
  const nextSourceRef = useRef<'human' | 'ai_accepted'>('human')
  const nextTaskRef = useRef<string | null>(null)
  const aiSelectionRef = useRef<{ anchor: TextSelectionAnchor; from: number; to: number } | null>(null)
  useEffect(() => { saveStateRef.current = saveState }, [saveState])

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: '从这里开始。先写下一句话，故事就会继续。' }), CharacterCount],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    autofocus: 'end',
    editorProps: { attributes: { class: 'prose-editor', 'aria-label': '正文编辑器' } },
    onUpdate: ({ editor }) => {
      if (loadingRef.current) return
      setWords(countWords(editor.getText()))
      saveStateRef.current = 'dirty'; setSaveState('dirty')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const nodeId = activeNodeRef.current
      saveTimer.current = setTimeout(() => void persist(nodeId, editor.getJSON() as Record<string, unknown>, editor.getText(), nextSourceRef.current, nextTaskRef.current), 900)
    },
  })

  async function persist(nodeId: string, json: Record<string, unknown>, text: string, sourceType: 'human' | 'ai_accepted' = 'human', sourceTaskId: string | null = null): Promise<SceneDocument | null> {
    saveStateRef.current = 'saving'; setSaveState('saving')
    try {
      const saved = await api.saveScene(nodeId, json, text, sourceType, sourceTaskId)
      if (activeNodeRef.current === nodeId) {
        documentRef.current = saved; saveStateRef.current = 'saved'; setDocument(saved); setSaveState('saved'); onSaved(saved, countWords(text)); nextSourceRef.current = 'human'; nextTaskRef.current = null
      }
      return saved
    } catch (error) { saveStateRef.current = 'error'; setSaveState('error'); notify('error', error instanceof Error ? error.message : '保存失败'); return null }
  }

  useEffect(() => {
    let cancelled = false
    activeNodeRef.current = node.id
    loadingRef.current = true
    setSaveState('loading')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void api.getScene(node.id).then((next) => {
      if (cancelled || !editor) return
      documentRef.current = next; setDocument(next)
      editor.commands.setContent(next.contentJson)
      setWords(countWords(next.plainText))
      saveStateRef.current = 'saved'; setSaveState('saved')
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

  async function openSelectionAi(taskType: EditorAiRequest['taskType']) {
    if (!editor || editor.state.selection.empty) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n').trim()
    if (!selectedText) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const plainText = editor.getText()
    const saved = saveStateRef.current === 'dirty'
      ? await persist(activeNodeRef.current, editor.getJSON() as Record<string, unknown>, plainText, nextSourceRef.current, nextTaskRef.current)
      : documentRef.current
    if (!saved) return
    const approximate = editor.state.doc.textBetween(0, from, '\n', '\n').length
    const startOffset = nearestOccurrence(plainText, selectedText, approximate)
    if (startOffset < 0) { notify('error', '无法定位当前选区，请重新选择后再试'); return }
    const selection: TextSelectionAnchor = {
      nodeId: activeNodeRef.current,
      sourceContentHash: saved.contentHash,
      startOffset,
      endOffset: startOffset + selectedText.length,
      originalText: selectedText,
      contextBefore: plainText.slice(Math.max(0, startOffset - 80), startOffset),
      contextAfter: plainText.slice(startOffset + selectedText.length, startOffset + selectedText.length + 80),
    }
    aiSelectionRef.current = { anchor: selection, from, to }
    window.dispatchEvent(new CustomEvent<EditorAiRequest>('bbd:open-ai-selection', { detail: { taskType, selection } }))
  }

  useEffect(() => {
    const replaceAi = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; taskId: string; selection: TextSelectionAnchor; applied?: boolean }>).detail
      if (!detail?.text || !detail.selection || !editor || detail.selection.nodeId !== activeNodeRef.current) return
      const plainText = editor.getText()
      const { startOffset, endOffset, originalText } = detail.selection
      if (saveStateRef.current !== 'saved' || documentRef.current?.contentHash !== detail.selection.sourceContentHash || plainText.slice(startOffset, endOffset) !== originalText) {
        notify('error', '原选区已发生变化，为避免误改，候选没有写入正文')
        return
      }
      const retained = aiSelectionRef.current
      const exactRange = retained && retained.anchor.sourceContentHash === detail.selection.sourceContentHash && retained.anchor.startOffset === startOffset && editor.state.doc.textBetween(retained.from, retained.to, '\n', '\n').trim() === originalText
        ? { from: retained.from, to: retained.to }
        : { from: documentPosition(editor.state.doc, startOffset), to: documentPosition(editor.state.doc, endOffset) }
      nextSourceRef.current = 'ai_accepted'; nextTaskRef.current = detail.taskId
      detail.applied = editor.chain().focus().setTextSelection(exactRange).insertContent(detail.text).run()
    }
    window.addEventListener('bbd:replace-ai', replaceAi)
    return () => window.removeEventListener('bbd:replace-ai', replaceAi)
  }, [editor, notify])

  useEffect(() => {
    const flush = (event: Event) => {
      const done = (event as CustomEvent<{ done?: () => void }>).detail?.done ?? (() => undefined)
      if (!editor || loadingRef.current || saveStateRef.current !== 'dirty') { done(); return }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void persist(activeNodeRef.current, editor.getJSON() as Record<string, unknown>, editor.getText(), nextSourceRef.current, nextTaskRef.current).finally(done)
    }
    window.addEventListener('bbd:flush-editor', flush)
    return () => window.removeEventListener('bbd:flush-editor', flush)
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

  return <section className={`editor-pane ${focusMode ? 'focus-mode' : ''}`}>
    <SceneHeader title={node.title} status={sceneStatusLabel(node.status)} words={words} saveState={saveState} focusMode={focusMode} onFocusMode={onFocusMode} />
    <Toolbar className="ui-editor-toolbar" label="文字格式">
      <ToolGroup label="字形"><IconButton size="small" selected={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="粗体"><Bold size={16} /></IconButton><IconButton size="small" selected={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="斜体"><Italic size={16} /></IconButton><IconButton size="small" selected={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="二级标题"><Heading2 size={16} /></IconButton></ToolGroup>
      <ToolGroup label="段落"><IconButton size="small" selected={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="无序列表"><List size={16} /></IconButton><IconButton size="small" selected={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="有序列表"><ListOrdered size={16} /></IconButton><IconButton size="small" selected={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="引用"><Quote size={16} /></IconButton></ToolGroup>
      <ToolGroup label="历史"><IconButton size="small" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} label="撤销"><Undo2 size={16} /></IconButton><IconButton size="small" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} label="重做"><Redo2 size={16} /></IconButton></ToolGroup>
    </Toolbar>
    <div className="paper-scroll">
      <BubbleMenu editor={editor} shouldShow={({ editor: activeEditor }) => !activeEditor.state.selection.empty} options={{ placement: 'top' }}>
        <div className="selection-ai-menu" role="toolbar" aria-label="选中文字的 AI 工具">
          <button type="button" onClick={() => void openSelectionAi('word_inspiration')}><Sparkles size={14}/>词语灵感</button>
          <button type="button" onClick={() => void openSelectionAi('style_rewrite')}><PenLineIcon/>按文风改写</button>
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
    <footer className="editor-footer"><span>{document ? `版本 ${document.contentHash.slice(0, 7)}` : '加载中'}</span><span>离线可写 · 自动留痕</span></footer>
  </section>
}

function PenLineIcon() { return <span aria-hidden="true">✎</span> }

function nearestOccurrence(text: string, needle: string, approximate: number) {
  const matches: number[] = []
  let offset = text.indexOf(needle)
  while (offset >= 0) { matches.push(offset); offset = text.indexOf(needle, offset + 1) }
  return matches.sort((a, b) => Math.abs(a - approximate) - Math.abs(b - approximate))[0] ?? -1
}

function documentPosition(doc: { descendants: (callback: (node: { isText: boolean; text?: string | null }, pos: number) => boolean | void) => void; content: { size: number } }, offset: number) {
  let seen = 0; let result = Math.min(1 + offset, doc.content.size)
  doc.descendants((node, pos) => { if (!node.isText) return; const length = node.text?.length ?? 0; if (seen + length >= offset) { result = pos + Math.max(0, offset - seen); return false } seen += length })
  return Math.max(1, Math.min(result, doc.content.size))
}
