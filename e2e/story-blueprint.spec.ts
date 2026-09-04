import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext } from '@playwright/test'

type Project = { id: string; title: string }
type StoryPlan = { blueprint: { genre: string; premise: string; endingState: string }; beats: Array<{ title: string }> }

const title = '[STORY-E] 雨夜遗书'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  await session(request)
  const projects = await json<Project[]>(request.get('/api/projects'))
  for (const project of projects.filter((item) => item.title === title)) await request.delete(`/api/projects/${project.id}`)
})

test.afterAll(async ({ request }) => {
  await session(request)
  const projects = await json<Project[]>(request.get('/api/projects'))
  for (const project of projects.filter((item) => item.title === title)) await request.delete(`/api/projects/${project.id}`)
})

test('creates a guided story and keeps its blueprint independently editable', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: '新故事' }).click()
  const dialog = page.getByRole('dialog', { name: '新建故事' })
  await dialog.getByRole('textbox', { name: /书名/ }).fill(title)
  await dialog.getByRole('radio', { name: /先定故事方向/ }).click()
  await dialog.getByRole('textbox', { name: /类型/ }).fill('古风悬疑')
  await dialog.getByRole('textbox', { name: /结局落点/ }).fill('旧案公开，主角选择不再归朝。')
  await dialog.getByRole('textbox', { name: /一句话故事前提/ }).fill('被逐出京城的仵作必须护送仇人的遗书回乡，否则旧案将被永远掩埋。')
  await dialog.getByRole('button', { name: '创建并规划故事' }).click()

  await expect(page.getByRole('heading', { name: '先确定故事要去哪里' })).toBeVisible()
  await expect(page.getByText('被逐出京城的仵作必须护送仇人的遗书回乡，否则旧案将被永远掩埋。')).toBeVisible()
  await expect(page.getByRole('button', { name: /编辑节拍/ })).toHaveCount(9)
  await expect(page.getByText('开场承诺', { exact: true })).toBeVisible()

  await session(request)
  const project = (await json<Project[]>(request.get('/api/projects'))).find((item) => item.title === title)!
  const plan = await json<StoryPlan>(request.get(`/api/projects/${project.id}/story-plan`))
  expect(plan.blueprint).toMatchObject({ genre: '古风悬疑', endingState: '旧案公开，主角选择不再归朝。' })
  expect(plan.beats).toHaveLength(9)

  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(accessibility.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

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

async function json<T>(responsePromise: Promise<import('@playwright/test').APIResponse>) {
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<T>
}
