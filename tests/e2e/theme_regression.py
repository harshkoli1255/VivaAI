"""Catch mismatched dark tokens and verify the accessible Three.js preview controls."""
import re
from playwright.async_api import expect


async def verify_theme_and_preview(page, artifacts):
    await page.emulate_media(color_scheme='dark')
    await page.wait_for_function("document.documentElement.classList.contains('dark')")
    assert await page.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(17, 27, 46)'
    assert await page.evaluate("getComputedStyle(document.querySelector('h1')).color") == 'rgb(242, 245, 252)'
    await page.screenshot(path=str(artifacts / 'student-home-dark.png'), full_page=True)
    await page.get_by_role('button', name='Switch to light theme', exact=True).click()
    await page.wait_for_function("!document.documentElement.classList.contains('dark')")
    assert await page.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(243, 245, 251)'
    await page.emulate_media(color_scheme='light')
    preview = page.get_by_role('group', name='Interactive examiner preview')
    await preview.get_by_role('button', name='Think', exact=True).click()
    await expect(preview.get_by_role('button', name='Think', exact=True)).to_have_attribute('aria-pressed', 'true')
    await expect(page.get_by_role('img', name=re.compile('thinking'))).to_be_visible(timeout=30000)
    await page.emulate_media(reduced_motion='reduce')
    await expect(page.locator('canvas')).to_have_count(0)
    await expect(page.get_by_role('img', name=re.compile('thinking'))).to_be_visible()
    await page.emulate_media(reduced_motion='no-preference')
