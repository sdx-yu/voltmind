import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

type Project = { id: string; title: string; description: string; createdAt: string; updatedAt: string; deletedAt: string | null }
type Node = { id: string; parentId: string | null; type: 'book' | 'volume' | 'chapter' | 'scene'; title: string }
type Entity = { id: string; canonicalName: string }

let project: Project
let longProject: Project
let longScene: Node

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  await session(request)
  const existing = await json<Project[]>(request.get('/api/projects'))
  for (const item of existing.filter((item) => item.title.startsWith('[UI-E]'))) await request.delete(`/api/projects/${item.id}`)

  project = await json<Project>(request.post('/api/projects', { data: { title: '[UI-E] 雾港来信', description: '视觉与键盘验收样稿' } }))
  const nodes = await json<Node[]>(request.get(`/api/projects/${project.id}/tree`))
  const scene = nodes.find((item) => item.type === 'scene')!
  await request.put(`/api/scenes/${scene.id}`, { data: scenePayload('雾从河面漫上来，先吞没了对岸的灯。\n\n林照把未寄出的信收回口袋。') })

  longProject = await json<Project>(request.post('/api/projects', { data: { title: '[UI-E] 二十万字性能稿', description: '只用于本机性能门' } }))
  const longNodes = await json<Node[]>(request.get(`/api/projects/${longProject.id}/tree`))
  longScene = longNodes.find((item) => item.type === 'scene')!
  const text = `${'长夜无声。'.repeat(39_999)}唯一线索`
  await request.put(`/api/scenes/${longScene.id}`, { data: scenePayload(text) })
  const chapter = longNodes.find((item) => item.type === 'chapter')!
  const next = await json<Node>(request.post(`/api/projects/${longProject.id}/nodes`, { data: { parentId: chapter.id, type: 'scene', title: '短场景' } }))
  await request.put(`/api/scenes/${next.id}`, { data: scenePayload('天亮以后，线索仍在桌面。') })
})

test.afterAll(async ({ request }) => {
  await session(request)
  for (const item of [project, longProject]) if (item) await request.delete(`/api/projects/${item.id}`)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('bbd-display', JSON.stringify({ fontSize: 18, paperWidth: 680, lineHeight: 2, theme: 'paper', density: 'comfortable' }))
  })
})

test('stores stable visual baselines for themes, density and overlays', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design-system')
  await expect(page.getByRole('heading', { name: '温润纸感，克制工具感' })).toBeVisible()
  await expect(page).toHaveScreenshot('gallery-paper-1440.png')

  await page.getByRole('tab', { name: '夜间' }).click()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page).toHaveScreenshot('gallery-night-1280.png')

  await page.getByRole('tab', { name: '高对比' }).click()
  await page.getByRole('tab', { name: '触控' }).click()
  await page.setViewportSize({ width: 430, height: 932 })
  await expect(page).toHaveScreenshot('gallery-contrast-touch-430.png')

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: '打开对话框' }).click()
  await expect(page.getByRole('dialog', { name: '接受事实候选' })).toBeVisible()
  await expect(page).toHaveScreenshot('gallery-dialog-1024.png')
})

test('stores real bookshelf, editor and workflow baselines', async ({ page }) => {
  const bookshelfProjects = [project, ...['潮声未歇', '旧城来客', '无灯长街', '山海回信', '十二夜', '纸上迷局', '远岸', '薄雾列车', '最后一页', '春潮'].map((title, index) => ({
    ...project,
    id: `bookshelf-visual-${index}`,
    title,
    description: index % 3 === 0 ? '' : ['秘密藏在每一次潮汐之间。', '尚未说出口的故事仍在继续。'][index % 2],
  }))]
  await onlyProjects(page, bookshelfProjects)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '继续写下去' })).toBeVisible()
  await expect(page.getByRole('button', { name: project.title }).first()).toBeVisible()
  await expect(page).toHaveScreenshot('bookshelf-paper-1440.png')

  await page.getByRole('button', { name: project.title }).first().click()
  await expect(page.getByRole('heading', { name: '场景 1' })).toBeVisible()
  await expect(page).toHaveScreenshot('editor-paper-1440.png')

  await page.getByRole('combobox', { name: '进度' }).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page).toHaveScreenshot('editor-select-paper-1440.png')
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: '正典', exact: true }).click()
  await expect(page.getByRole('heading', { name: '故事中的事实' })).toBeVisible()
  await expect(page).toHaveScreenshot('canon-paper-1024.png')

  await page.getByRole('button', { name: '交付', exact: true }).click()
  await expect(page.getByRole('heading', { name: '把故事安全地带出去' })).toBeVisible()
  await expect(page).toHaveScreenshot('delivery-paper-1024.png')
})

test('keeps branded selects keyboard-operable and viewport-bound', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/design-system')
  const select = page.getByRole('combobox', { name: '场景状态' })
  await select.focus()
  await select.press('Enter')
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page).toHaveScreenshot('gallery-select-paper-1024.png')
  const revising = page.getByRole('option', { name: '修订中' })
  await revising.focus()
  await expect(revising).toBeFocused()
  await revising.press('Enter')
  await expect(select).toHaveText('修订中')
  await expect(select).toBeFocused()
})

test('keeps multi-column controls aligned when only one field has help text', async ({ page }) => {
  await onlyProjects(page, [project])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: project.title }).first().click()
  await page.getByRole('button', { name: /编辑故事时间/ }).click()
  const dialog = page.getByRole('dialog', { name: '设置本场故事时间' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input[type="date"]')).toHaveCount(0)
  await expect(dialog).toHaveScreenshot('story-time-modern-1440.png')
  await dialog.getByRole('combobox', { name: '时间方式' }).click()
  await page.getByRole('option', { name: '古风／自定义纪年' }).click()

  const era = await dialog.getByRole('textbox', { name: /纪年／年号/ }).boundingBox()
  const eraOrder = await dialog.getByRole('spinbutton', { name: '纪年顺序' }).boundingBox()
  expect(era).not.toBeNull(); expect(eraOrder).not.toBeNull()
  expect(Math.abs(era!.y - eraOrder!.y)).toBeLessThanOrEqual(1)

  const dates = await Promise.all(['年', '月 选填', '日 选填'].map((name) => dialog.getByRole('spinbutton', { name, exact: true }).boundingBox()))
  expect(dates.every(Boolean)).toBe(true)
  expect(Math.max(...dates.map((box) => box!.y)) - Math.min(...dates.map((box) => box!.y))).toBeLessThanOrEqual(1)
  await assertA11y(page)
})

test('keeps scene status controls separated and visually ordered', async ({ page }) => {
  await onlyProjects(page, [project])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: project.title }).first().click()

  const section = page.locator('.scene-status-section')
  const progress = section.getByRole('combobox', { name: '进度' })
  const storyTime = section.getByRole('button', { name: /编辑故事时间/ })
  const pov = section.getByRole('combobox', { name: '视角人物' })
  const action = section.getByRole('button', { name: '完成本场景并提取事实' })
  await expect(section).toBeVisible()

  const boxes = await Promise.all([progress, storyTime, pov, action].map((item) => item.boundingBox()))
  expect(boxes.every(Boolean)).toBe(true)
  expect(boxes[1]!.y - (boxes[0]!.y + boxes[0]!.height)).toBeGreaterThanOrEqual(12)
  expect(boxes[2]!.y - (boxes[1]!.y + boxes[1]!.height)).toBeGreaterThanOrEqual(28)
  expect(boxes[3]!.y - (boxes[2]!.y + boxes[2]!.height)).toBeGreaterThanOrEqual(24)
  await assertA11y(page)
})

test('requires the completion workflow and reopens a completed scene after editing', async ({ page, request }) => {
  await session(request)
  const scene = (await json<Node[]>(request.get(`/api/projects/${project.id}/tree`))).find((item) => item.type === 'scene')!
  await request.patch(`/api/nodes/${scene.id}`, { data: { status: 'draft' } })
  await request.post(`/api/scenes/${scene.id}/complete`)
  await onlyProjects(page, [project])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: project.title }).first().click()

  const section = page.locator('.scene-status-section')
  await expect(section.getByText('已完成', { exact: true })).toBeVisible()
  await expect(section.getByRole('combobox', { name: '进度' })).toHaveCount(0)
  await expect(section.getByRole('button', { name: '完成本场景并提取事实' })).toHaveCount(0)

  const editor = page.getByRole('textbox', { name: '正文编辑器' })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 又写了一句。')
  await expect(page.getByText('修订中', { exact: true }).first()).toBeVisible({ timeout: 8_000 })
  await expect(section.getByRole('combobox', { name: '进度' })).toBeVisible()
  await assertA11y(page)
})

test('projects dossier and temporal relationships from canon into an accessible graph', async ({ page, request }) => {
  await session(request)
  const scene = (await json<Node[]>(request.get(`/api/projects/${project.id}/tree`))).find((item) => item.type === 'scene')!
  const lin = await json<Entity>(request.post(`/api/projects/${project.id}/entities`, { data: { type: 'character', canonicalName: '林照', aliases: [], summary: '雾港调查员', privacyLevel: 'normal' } }))
  const shen = await json<Entity>(request.post(`/api/projects/${project.id}/entities`, { data: { type: 'character', canonicalName: '沈砚', aliases: [], summary: '旧案证人', privacyLevel: 'normal' } }))
  await json(request.post(`/api/entities/${lin.id}/profile-fields`, { data: { category: '语言', label: '口头禅', value: '证据先行', privacyLevel: 'author_only' } }))
  const relationship = await json<{ id: string }>(request.post(`/api/projects/${project.id}/relationships`, { data: { sourceEntityId: lin.id, targetEntityId: shen.id, relationType: 'alliance', direction: 'mutual', label: '调查搭档', summary: '旧案让两人再次合作', privacyLevel: 'normal' } }))
  await json(request.post(`/api/relationships/${relationship.id}/states`, { data: { statusLabel: '互相信任', note: '交换关键证据', validFromNodeId: scene.id, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: scene.id, evidence: '林照把未寄出的信收回口袋' } }))

  await onlyProjects(page, [project])
  await page.goto('/')
  await page.getByRole('button', { name: project.title }).first().click()
  await page.getByRole('button', { name: '正典', exact: true }).click()
  await page.getByRole('button', { name: /林照/ }).first().click()
  await page.getByRole('tab', { name: '档案' }).click()
  await expect(page.getByText('证据先行')).toBeVisible()
  await page.getByRole('tab', { name: '关系' }).click()
  await expect(page.locator('.relationship-current .ui-badge', { hasText: '互相信任' })).toBeVisible()
  await page.getByRole('tab', { name: '关联图' }).click()
  const graphNode = page.getByRole('button', { name: '查看沈砚的关系：互相信任' })
  await graphNode.focus()
  await expect(graphNode).toBeFocused()
  await graphNode.press('Enter')
  await expect(page.getByRole('complementary', { name: '沈砚关系详情' })).toContainText('旧案让两人再次合作')
  await expect(page.locator('.relationship-graph-card')).toHaveScreenshot('canon-relationship-graph-1440.png')
  await page.getByRole('button', { name: '打开档案' }).click()
  await expect(page.getByRole('heading', { name: '沈砚' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('passes serious WCAG scans on the component system and core workspaces', async ({ page }) => {
  await page.goto('/design-system')
  await assertA11y(page)

  await onlyProjects(page, [project])
  await page.goto('/')
  await assertA11y(page)
  await page.getByRole('button', { name: project.title }).first().click()
  await expect(page.getByRole('heading', { name: '场景 1' })).toBeVisible()
  await assertA11y(page)
  await page.getByRole('button', { name: '交付', exact: true }).click()
  await expect(page.getByRole('heading', { name: '把故事安全地带出去' })).toBeVisible()
  await assertA11y(page)
})

test('keeps overlays keyboard-contained and restores focus', async ({ page }) => {
  await page.goto('/design-system')
  const dialogTrigger = page.getByRole('button', { name: '打开对话框' })
  await dialogTrigger.focus()
  await dialogTrigger.press('Enter')
  await expect(page.getByRole('dialog', { name: '接受事实候选' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialogTrigger).toBeFocused()

  const drawerTrigger = page.getByRole('button', { name: '打开详情栏' })
  await drawerTrigger.focus()
  await drawerTrigger.press('Enter')
  await expect(page.getByRole('dialog', { name: '正典详情' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawerTrigger).toBeFocused()
})

test('supports command keyboard flow, IME composition and a 200% reflow equivalent', async ({ page }) => {
  await onlyProjects(page, [project])
  await page.setViewportSize({ width: 720, height: 900 })
  await page.goto('/?desktop=1')
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, isComposing: true, bubbles: true })))
  await expect(page.getByRole('dialog', { name: '书架命令' })).toHaveCount(0)
  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('dialog', { name: '书架命令' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: project.title }).first().click()
  await expect(page.getByRole('heading', { name: '场景 1' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '交付', exact: true }).click()
  await expect(page.getByRole('heading', { name: '把故事安全地带出去' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('keeps touch targets at 44px in touch density', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto('/design-system')
  await page.getByRole('tab', { name: '触控' }).click()
  const violations = await page.locator('button:visible, a[href]:visible, input:visible, select:visible, textarea:visible').evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect()
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) && element.closest('label')?.getBoundingClientRect().height! >= 44) return []
    return rect.width + .5 < 44 || rect.height + .5 < 44 ? [{ tag: element.tagName, name: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40), width: Math.round(rect.width), height: Math.round(rect.height) }] : []
  }))
  expect(violations).toEqual([])
})

test('reflows across the frozen desktop, narrow and PWA viewport matrix', async ({ page }) => {
  for (const width of [1440, 1280, 1024, 430, 390, 360]) {
    for (const theme of ['宣纸', '夜间']) {
      await test.step(`${width}px · ${theme}`, async () => {
        await page.setViewportSize({ width, height: width <= 430 ? 800 : 768 })
        await page.goto('/design-system')
        if (theme === '夜间') await page.getByRole('tab', { name: theme }).click()
        await expect(page.getByRole('heading', { name: '温润纸感，克制工具感' })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      })
    }
  }

  for (const width of [430, 390, 360]) {
    await test.step(`PWA ${width}px`, async () => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/mobile-acceptance.html')
      await expect(page.getByRole('heading', { name: '笔不怠 · 移动真机验收' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    })
  }
})

test('loads, scrolls and switches a 200k-character manuscript within a bounded budget', async ({ page }) => {
  await onlyProjects(page, [longProject])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const projectButton = page.getByRole('button', { name: longProject.title }).first()
  await expect(projectButton).toBeVisible()
  const started = Date.now()
  await projectButton.click()
  await expect(page.getByRole('heading', { name: '场景 1' })).toBeVisible({ timeout: 8_000 })
  expect(Date.now() - started).toBeLessThan(8_000)
  const scrollDuration = await page.locator('.paper-scroll').evaluate(async (scroller) => {
    const start = performance.now()
    scroller.scrollTop = scroller.scrollHeight
    await new Promise(requestAnimationFrame)
    return performance.now() - start
  })
  expect(scrollDuration).toBeLessThan(1_000)
  const switched = Date.now()
  await page.getByRole('button', { name: /短场景/ }).first().click()
  await expect(page.getByText('天亮以后，线索仍在桌面。')).toBeVisible()
  expect(Date.now() - switched).toBeLessThan(2_500)
})

async function onlyProjects(page: Page, projects: Project[]) {
  await page.route('**/api/projects', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname === '/api/projects' && !url.search) await route.fulfill({ json: projects })
    else await route.continue()
  })
}

async function assertA11y(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(result.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([])
}

async function session(request: APIRequestContext) {
  let lastStatus = 'unreachable'
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await request.post('/api/session')
      lastStatus = `${response.status()} ${response.statusText()}`
      if (response.ok()) return
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`本地 API 在 8 秒内未就绪：${lastStatus}`)
}
async function json<T>(responsePromise: Promise<import('@playwright/test').APIResponse>) { const response = await responsePromise; expect(response.ok(), await response.text()).toBe(true); return response.json() as Promise<T> }
function scenePayload(text: string) { return { contentJson: { type: 'doc', content: text.split('\n\n').map((paragraph) => ({ type: 'paragraph', content: paragraph ? [{ type: 'text', text: paragraph }] : [] })) }, plainText: text, sourceType: 'human', sourceTaskId: null } }
