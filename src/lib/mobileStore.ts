import type { MobileInboxAction, MobileInboxItem, MobileLibraryScene, Project, SprintResultCard } from '../../shared/types'

const DATABASE_NAME = 'bibudai-mobile-v1'
const DATABASE_VERSION = 1

export interface CachedMobileLibrary { projects: Project[]; scenes: MobileLibraryScene[]; sprintCards?: SprintResultCard[]; cachedAt: string }

export async function putLocalMobileItem(item: Omit<MobileInboxItem, 'actions' | 'currentAction'>) {
  const database = await openMobileDatabase(); const transaction = database.transaction('items', 'readwrite')
  const store = transaction.objectStore('items'); const existing = await requestResult<typeof item | undefined>(store.get(item.id))
  if (existing && JSON.stringify(existing) !== JSON.stringify(item)) { transaction.abort(); database.close(); throw new Error('Mobile inbox ID collision') }
  if (!existing) store.add(item); await transactionDone(transaction); database.close()
}

export async function putLocalMobileAction(action: MobileInboxAction) {
  const database = await openMobileDatabase(); const transaction = database.transaction('actions', 'readwrite')
  const store = transaction.objectStore('actions'); const existing = await requestResult<MobileInboxAction | undefined>(store.get(action.id))
  if (existing && JSON.stringify(existing) !== JSON.stringify(action)) { transaction.abort(); database.close(); throw new Error('Mobile action ID collision') }
  if (!existing) store.add(action); await transactionDone(transaction); database.close()
}

export async function mergeLocalMobileItems(items: MobileInboxItem[]) {
  const database = await openMobileDatabase(); const transaction = database.transaction(['items', 'actions'], 'readwrite')
  const itemStore = transaction.objectStore('items'); const actionStore = transaction.objectStore('actions')
  for (const item of items) { const { actions, currentAction: _currentAction, ...record } = item; itemStore.put(record); for (const action of actions) actionStore.put(action) }
  await transactionDone(transaction); database.close()
}

export async function listLocalMobileItems(): Promise<MobileInboxItem[]> {
  const database = await openMobileDatabase(); const transaction = database.transaction(['items', 'actions'], 'readonly')
  const items = await requestResult<Array<Omit<MobileInboxItem, 'actions' | 'currentAction'>>>(transaction.objectStore('items').getAll())
  const actions = await requestResult<MobileInboxAction[]>(transaction.objectStore('actions').getAll()); await transactionDone(transaction); database.close()
  return items.map((item) => { const current = actions.filter((action) => action.itemId === item.id).sort(compareAction); return { ...item, actions: current, currentAction: current.at(-1)?.action ?? null } }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export async function saveMobileLibrary(library: Omit<CachedMobileLibrary, 'cachedAt'>) {
  const database = await openMobileDatabase(); const transaction = database.transaction('library', 'readwrite')
  transaction.objectStore('library').put({
    id: 'main',
    projects: Array.isArray(library.projects) ? library.projects : [],
    scenes: Array.isArray(library.scenes) ? library.scenes : [],
    sprintCards: Array.isArray(library.sprintCards) ? library.sprintCards : [],
    cachedAt: new Date().toISOString(),
  }); await transactionDone(transaction); database.close()
}

export async function getMobileLibrary(): Promise<CachedMobileLibrary> {
  const database = await openMobileDatabase(); const transaction = database.transaction('library', 'readonly')
  const record = await requestResult<(CachedMobileLibrary & { id: string }) | undefined>(transaction.objectStore('library').get('main')); await transactionDone(transaction); database.close()
  return record ? {
    projects: Array.isArray(record.projects) ? record.projects : [],
    scenes: Array.isArray(record.scenes) ? record.scenes : [],
    sprintCards: Array.isArray(record.sprintCards) ? record.sprintCards : [],
    cachedAt: typeof record.cachedAt === 'string' ? record.cachedAt : '',
  } : { projects: [], scenes: [], sprintCards: [], cachedAt: '' }
}

export function getMobileDeviceId(): string {
  const key = 'bbd-mobile-device-id'; const current = localStorage.getItem(key); if (current) return current
  const created = crypto.randomUUID(); localStorage.setItem(key, created); return created
}

export async function clearMobileStoreForTests() {
  return resetMobileStore()
}

export async function resetMobileStore() {
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(DATABASE_NAME); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('IndexedDB deletion blocked')) })
}

function openMobileDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => { const database = request.result; if (!database.objectStoreNames.contains('items')) database.createObjectStore('items', { keyPath: 'id' }); if (!database.objectStoreNames.contains('actions')) database.createObjectStore('actions', { keyPath: 'id' }); if (!database.objectStoreNames.contains('library')) database.createObjectStore('library', { keyPath: 'id' }) }
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
function transactionDone(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')) }) }
function compareAction(a: MobileInboxAction, b: MobileInboxAction) { return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) }
