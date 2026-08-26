import { useEffect, useState } from 'react'
import type { Project } from '../shared/types'
import { api } from './lib/api'
import { Bookshelf } from './components/Bookshelf'
import { Toast, type ToastState } from './components/Toast'
import { Workspace } from './components/Workspace'
import { applyStoredDisplay } from './lib/display'
import { RescueScreen } from './components/RescueScreen'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [rescueMode, setRescueMode] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  async function refresh() { setProjects(await api.listProjects()) }
  function notify(type: ToastState['type'], message: string) { setToast({ type, message }); window.setTimeout(() => setToast(null), 4_500) }
  useEffect(() => {
    applyStoredDisplay()
    void api.health().then((health) => {
      setRescueMode(health.rescueMode)
      if (!health.rescueMode) return refresh()
    }).catch((error) => notify('error', error instanceof Error ? error.message : '本地服务不可用')).finally(() => setLoading(false))
  }, [])
  return <><Toast toast={toast} onClose={() => setToast(null)} />{rescueMode ? <RescueScreen onRecovered={() => { setRescueMode(false); setLoading(true); window.setTimeout(() => window.location.reload(), 300) }} notify={notify} /> : selected ? <Workspace project={selected} onBack={() => { setSelected(null); void refresh() }} notify={notify} /> : <Bookshelf projects={projects} loading={loading} onOpen={setSelected} onRefresh={refresh} notify={notify} />}</>
}
