"""Exercise browser speech events without depending on Chrome's external STT service."""
from playwright.async_api import expect


async def verify_speech_draft_edits(page):
    await page.evaluate("""() => {
      const original = { speech: window.SpeechRecognition, webkit: window.webkitSpeechRecognition };
      window.__draftSpeech = { original, instances: [] };
      class Recognition {
        start() { window.__draftSpeech.instances.push(this); queueMicrotask(() => this.onstart?.()); }
        stop() { queueMicrotask(() => this.onend?.()); }
        abort() { queueMicrotask(() => this.onend?.()); }
      }
      window.SpeechRecognition = window.webkitSpeechRecognition = Recognition;
      window.__draftSpeech.emit = (text, final = true) => {
        const instance = window.__draftSpeech.instances.at(-1);
        instance.onresult?.({resultIndex: 0, results: [{isFinal: final, 0: {transcript: text}}]});
      };
    }""")
    box = page.locator('#candidate-text-answer')
    speak = page.get_by_role('button', name='Speak your answer', exact=True)
    pause = page.get_by_role('button', name='Listening — pause', exact=True)
    clear = page.get_by_role('button', name='Clear answer', exact=True)
    try:
        await expect(clear).to_be_disabled()
        await speak.click()
        await expect(pause).to_be_visible()
        await page.evaluate("window.__draftSpeech.emit('I built the wrong project')")
        await expect(box).to_have_value('I built the wrong project')
        # Chrome sends cumulative results. Re-delivery must not duplicate a phrase.
        await page.evaluate("window.__draftSpeech.emit('I built the wrong project')")
        await expect(box).to_have_value('I built the wrong project')
        await pause.click()
        await box.fill('I built')
        await speak.click()
        await expect(pause).to_be_visible()
        await page.evaluate("window.__draftSpeech.emit('a scheduler')")
        await expect(box).to_have_value('I built a scheduler')
        await clear.click()
        await expect(box).to_have_value('')
        await expect(box).to_be_focused()
        await expect(clear).to_be_disabled()
        await expect(speak).to_be_visible()
        await speak.click()
        await expect(pause).to_be_visible()
        await page.evaluate("window.__draftSpeech.emit('Threads share memory', false)")
        await expect(box).to_have_value('Threads share memory')
        # An edit while listening retires the recognizer, including queued events.
        await page.evaluate("() => { window.__draftSpeech.staleResult = window.__draftSpeech.instances.at(-1).onresult; }")
        await box.fill('Threads')
        await expect(speak).to_be_visible()
        await speak.click()
        await expect(pause).to_be_visible()
        await page.evaluate("""() => {
          window.__draftSpeech.staleResult({results: [{isFinal: true, 0: {transcript: 'deleted words'}}]});
        }""")
        await expect(box).to_have_value('Threads')
        await page.evaluate("window.__draftSpeech.emit('share state')")
        await expect(box).to_have_value('Threads share state')
        # Automatic recognition restarts also resume from the visible draft.
        await page.evaluate("window.__draftSpeech.instances.at(-1).onend()")
        await page.wait_for_function('window.__draftSpeech.instances.length === 5')
        await expect(pause).to_be_visible()
        await page.evaluate("window.__draftSpeech.emit('safely')")
        await expect(box).to_have_value('Threads share state safely')
        await page.evaluate("() => { window.__draftSpeech.beforeClear = window.__draftSpeech.instances.at(-1).onresult; }")
        await clear.click()
        await expect(box).to_have_value('')
        await expect(box).to_be_focused()
        await expect(clear).to_be_disabled()
        await speak.click()
        await expect(pause).to_be_visible()
        await page.evaluate('''() => {
          window.__draftSpeech.beforeClear({results: [{isFinal: true, 0: {transcript: 'discarded speech'}}]});
        }''')
        await expect(box).to_have_value('')
        await page.evaluate("window.__draftSpeech.emit('A fresh answer')")
        await expect(box).to_have_value('A fresh answer')
        await clear.click()
        await box.fill('A typed draft')
        await clear.click()
        await expect(box).to_have_value('')
        await expect(box).to_be_focused()
        session_id = page.url.rsplit('/', 1)[1]
        assert await page.evaluate('(id) => sessionStorage.getItem(`vivaai_draft_${id}`)', session_id) is None

    finally:
        await page.evaluate("""() => {
          window.SpeechRecognition = window.__draftSpeech.original.speech;
          window.webkitSpeechRecognition = window.__draftSpeech.original.webkit;
        }""")
