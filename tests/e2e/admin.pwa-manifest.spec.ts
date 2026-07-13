// ============================================================
//  admin.pwa-manifest.spec.ts
//  ホーム画面追加時のアイコン/名称がGENLINKS固定になっている
//  （2026-07-11・account名の頭文字が出てしまう不具合の対応・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'

test('manifest.jsonとアイコンがGENLINKS固定で提供される', async ({ page, request, baseURL }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  const title = await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content')
  expect(title).toBe('GENLINKS')

  const res = await request.get(`${baseURL}/manifest.json`)
  expect(res.ok()).toBeTruthy()
  const manifest = await res.json()
  expect(manifest.name).toBe('GENLINKS')
  expect(manifest.short_name).toBe('GENLINKS')
  expect(manifest.icons.length).toBeGreaterThan(0)

  const iconRes = await request.get(`${baseURL}${manifest.icons[0].src}`)
  expect(iconRes.ok()).toBeTruthy()
})
