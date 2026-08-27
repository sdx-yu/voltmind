import { useEffect, useState } from 'react'
import type { Project } from '../shared/types'
import { api } from './lib/api'
import { Bookshelf } from './components/Bookshelf'
import { Toast, type ToastState } from './components/Toast'
import { Workspace } from './components/Workspace'
import { applyStoredDisplay } from './lib/display'
import { RescueScreen } from './components/RescueScreen'
import { MobileHome } from './components/MobileHome'
import { ReviewWorkspace } from './components/ReviewWorkspace'
import { activatePwaUpdate, registerPwa, type PwaRegistrationState } from './lib/pwa'
import { ResearchWorkspace } from './components/ResearchWorkspace'
import { ResearchCohortWorkspace } from './components/ResearchCohortWorkspace'

function isMobileExperience() {
  const query = new URLSearchParams(window.location.search)
  if (query.get('desktop') === '1') return false
  return query.get('mobile') === '1' || window.matchMedia?.('(max-width: 620px)').matches === true
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [rescueMode, setRescueMode] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [mobile] = useState(isMobileExperience)
  const [reviewInbox, setReviewInbox] = useState(false)
  const [researchOpen, setResearchOpen] = useState(false)
  const [researchCohortOpen, setResearchCohortOpen] = useState(false)
  const [pwa, setPwa] = useState<PwaRegistrationState>({ registration: null, updateReady: false, offlineReady: false })
  async function refresh() { setProjects(await api.listProjects()) }
  function notify(type: ToastState['type'], message: string) { setToast({ type, message }); window.setTimeout(() => setToast(null), 4_500) }
  useEffect(() => {
    applyStoredDisplay()
    void registerPwa(setPwa).catch(() => undefined)
    if (mobile) { setLoading(false); return }
    void api.health().then((health) => {
      setRescueMode(health.rescueMode)
      if (!health.rescueMode) return refresh()
    }).catch((error) => notify('error', error instanceof Error ? error.message : '本地服务不可用')).finally(() => setLoading(false))
  }, [mobile])
  return <><Toast toast={toast} onClose={() => setToast(null)} />{pwa.updateReady && <div className="pwa-update" role="status"><span>新版本已准备好</span><button onClick={() => activatePwaUpdate(pwa.registration)}>立即更新</button></div>}{mobile ? <MobileHome/> : rescueMode ? <RescueScreen onRecovered={() => { setRescueMode(false); setLoading(true); window.setTimeout(() => window.location.reload(), 300) }} notify={notify} /> : selected ? <Workspace project={selected} onBack={() => { setSelected(null); void refresh() }} notify={notify} /> : researchCohortOpen ? <ResearchCohortWorkspace onBack={() => { setResearchCohortOpen(false); setResearchOpen(true) }} notify={notify}/> : researchOpen ? <ResearchWorkspace projects={projects} onBack={() => setResearchOpen(false)} onOpenCohort={() => { setResearchOpen(false); setResearchCohortOpen(true) }} notify={notify}/> : reviewInbox ? <ReviewWorkspace project={null} nodes={[]} reviewerOnly onSelectScene={() => undefined} onChanged={async () => undefined} onBack={() => setReviewInbox(false)} notify={notify}/> : <Bookshelf projects={projects} loading={loading} onOpen={setSelected} onRefresh={refresh} onOpenReview={() => setReviewInbox(true)} onOpenResearch={() => setResearchOpen(true)} notify={notify} />}</>
}
