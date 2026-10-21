"""Isolated mock browser regression for versioned faculty editing and student shortcuts."""
import asyncio,json,os,socket,subprocess,tempfile
from pathlib import Path
from playwright.async_api import async_playwright,expect
from candidate_flow import ROOT,PYTHON,NODE,wait_for_server,poll

expect.set_options(timeout=20000)
ARTIFACTS=ROOT/'test-results/viva-management'

async def main():
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    (ARTIFACTS/'result.json').write_text(json.dumps({'passed':False,'status':'running'}))
    for port in (13000,13001,18000):
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.2): raise RuntimeError(f'Test port {port} is occupied')
        except (ConnectionRefusedError,TimeoutError): pass
    processes=[];logs=[]
    with tempfile.TemporaryDirectory(prefix='viva-management-') as directory:
        env={**os.environ,'APP_ENV':'test','MOCK_MODE':'true','LLM_PROVIDER':'mock','TTS_PROVIDER':'mock','DEMO_MODE':'true',
            'DATABASE_URL':f'sqlite+aiosqlite:///{directory}/test.db','AUDIO_LOCAL_DIR':f'{directory}/audio',
            'SECRET_KEY':'synthetic-viva-management-test-secret','COOKIE_SECURE':'false','COOKIE_DOMAIN':'',
            'SCORING_WORKER_ENABLED':'false','API_INTERNAL_URL':'http://127.0.0.1:18000','NEXT_PUBLIC_API_URL':'http://127.0.0.1:18000',
            'NEXT_PUBLIC_WS_URL':'ws://127.0.0.1:18000','NEXT_PUBLIC_MOCK_MODE':'false','NEXT_BUILD_DIR':'.next-e2e',
            'NEXT_PUBLIC_STUDENT_URL':'http://127.0.0.1:13000','NEXT_PUBLIC_FACULTY_URL':'http://127.0.0.1:13001',
            'CORS_ORIGINS':'http://127.0.0.1:13000,http://127.0.0.1:13001','DEEPGRAM_API_KEY':'','ELEVENLABS_API_KEY':'','OPENAI_API_KEY':''}
        try:
            subprocess.run([str(ROOT/'.venv/bin/alembic'),'upgrade','head'],cwd=ROOT/'backend',env=env,check=True)
            for command,cwd,name in [([str(PYTHON),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','18000'],ROOT/'backend','backend'),
                ([str(NODE),'dev','--webpack','-p','13000','--hostname','127.0.0.1'],ROOT/'apps/student-web','student'),
                ([str(NODE),'dev','--webpack','-p','13001','--hostname','127.0.0.1'],ROOT/'apps/faculty-web','faculty')]:
                log=open(ARTIFACTS/f'{name}.log','w');logs.append(log)
                processes.append(subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT))
            for url in ('http://127.0.0.1:18000/health','http://127.0.0.1:13000/login','http://127.0.0.1:13001/login'): await wait_for_server(url,processes)
            async with async_playwright() as p:
                browser=await p.chromium.launch(channel='chrome',headless=True)
                faculty_context=await browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
                student_context=await browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce')
                faculty=await faculty_context.new_page();student=await student_context.new_page();errors=[]
                for page in (faculty,student): page.on('pageerror',lambda e:errors.append(str(e)))
                try:
                    await faculty.goto('http://127.0.0.1:13001/login')
                    await faculty.get_by_label('Email',exact=False).fill('priya.sharma@university.edu');await faculty.get_by_label('Password',exact=True).fill('faculty123')
                    await faculty.get_by_role('button',name='Sign in to Faculty Portal').click();await faculty.wait_for_url('**/dashboard')
                    await expect(faculty.get_by_role('heading',name='Your vivas',exact=True)).to_be_visible()
                    await faculty.goto('http://127.0.0.1:13001/setup')
                    await faculty.get_by_role('button',name='Use sample syllabus',exact=True).click()
                    await faculty.get_by_label('Examination Title',exact=True).fill('Reliable systems viva')
                    await faculty.get_by_role('navigation',name='Viva setup progress').get_by_role('button').nth(3).click()
                    await faculty.get_by_role('button',name='Publish Viva Examination',exact=True).click();await faculty.wait_for_url('**/dashboard')
                    card=faculty.get_by_role('article',name='Viva: Reliable systems viva',exact=True)
                    await expect(card).to_be_visible()
                    original_id=(await card.get_by_role('link',name='Edit viva',exact=True).get_attribute('href')).rsplit('/',1)[1]
                    original=await (await faculty_context.request.get(f'http://127.0.0.1:13001/api/v1/viva-configs/{original_id}')).json()
                    assert original['course_code']=='CS302'
                    # Invitation survives the student's sign-in redirect.
                    await student.goto(f'http://127.0.0.1:13000/interview?viva={original_id}');await student.wait_for_url('**/login')
                    await student.get_by_label('University ID',exact=True).fill('STU001');await student.get_by_label('Password',exact=True).fill('student123')
                    await student.get_by_role('button',name='Sign in to Student Portal').click();await student.wait_for_url('**/interview')
                    choice=student.get_by_role('button').filter(has=student.get_by_role('heading',name='Reliable systems viva',exact=True))
                    await expect(choice).to_have_attribute('aria-pressed','true')
                    await student.get_by_role('checkbox',name=__import__('re').compile('Use typed answers')).check();await student.locator('#exam-consent').check()
                    await student.get_by_role('button',name='Enter Live Examination Room').click();await student.wait_for_url('**/interview/*')
                    await expect(student.get_by_text('Live Connected',exact=True)).to_be_visible()
                    session_id=student.url.rsplit('/',1)[1]
                    await card.get_by_text('More options',exact=True).click()
                    await card.get_by_role('button',name='Pause new enrollment',exact=True).click()
                    await expect(card.get_by_text('Enrollment paused',exact=True)).to_be_visible()
                    blocked=await student_context.request.post('http://127.0.0.1:13000/api/v1/sessions',data={'viva_config_id':original_id},headers={'X-VivaAI-Request':'1'})
                    assert blocked.status==409
                    await expect(student.get_by_text('Live Connected',exact=True)).to_be_visible()
                    await card.get_by_role('link',name='Edit viva',exact=True).click()
                    await faculty.get_by_label('Examination Title',exact=True).fill('Reliable systems viva revised')
                    await faculty.wait_for_timeout(700);await faculty.reload()
                    await expect(faculty.get_by_label('Examination Title',exact=True)).to_have_value('Reliable systems viva revised')
                    await expect(faculty.get_by_text('Unsaved edits restored',exact=False)).to_be_visible()
                    unchanged=await (await faculty_context.request.get(f'http://127.0.0.1:13001/api/v1/viva-configs/{original_id}')).json()
                    assert unchanged['title']=='Reliable systems viva'
                    await faculty.get_by_role('checkbox',name='Open to new student interviews after saving',exact=True).check()
                    nav=faculty.get_by_role('navigation',name='Viva setup progress')
                    await nav.get_by_role('button').nth(2).click()
                    await faculty.get_by_label('Question 1 text',exact=True).fill('Explain fair mutex scheduling and starvation.')
                    await nav.get_by_role('button').nth(3).click()
                    await faculty.locator('#rubric-conceptual').fill('35');await faculty.locator('#rubric-depth').fill('20')
                    await faculty.get_by_role('button',name='Publish new version',exact=True).click();await faculty.wait_for_url('**/dashboard')
                    latest_card=faculty.get_by_role('article',name='Viva: Reliable systems viva revised',exact=True)
                    await expect(latest_card.get_by_text('Version 2',exact=True)).to_be_visible()
                    latest_id=(await latest_card.get_by_role('link',name='Edit viva',exact=True).get_attribute('href')).rsplit('/',1)[1]
                    assert latest_id!=original_id
                    preserved=await (await faculty_context.request.get(f'http://127.0.0.1:13001/api/v1/viva-configs/{original_id}')).json()
                    assert preserved['questions']==original['questions'] and preserved['rubric_weights']==original['rubric_weights']
                    # Live interview remains connected, accepts an answer, and resumes under the old contract.
                    await expect(student.get_by_text('Live Connected',exact=True)).to_be_visible()
                    answer='A mutex serializes access to shared mutable state. A semaphore tracks a number of available resources.'
                    await student.locator('#candidate-text-answer').fill(answer);await student.get_by_role('button',name='Confirm & Submit Answer',exact=True).click()
                    async def transcript():return await (await student_context.request.get(f'http://127.0.0.1:13000/api/v1/transcript/{session_id}')).json()
                    await poll(transcript,lambda turns:any(t['speaker']=='student' and t['text']==answer for t in turns))
                    await student.goto('http://127.0.0.1:13000/interview')
                    resume=student.get_by_role('region',name='Continue your interview',exact=True)
                    await expect(resume.get_by_text('Reliable systems viva',exact=True)).to_be_visible()
                    await resume.get_by_role('link',name='Resume interview',exact=True).click()
                    await student.get_by_role('button',name='Begin Oral Examination',exact=True).click()
                    await expect(student.get_by_text('Live Connected',exact=True)).to_be_visible()
                    session=await (await student_context.request.get(f'http://127.0.0.1:13000/api/v1/sessions/{session_id}')).json()
                    assert session['viva_config_id']==original_id and session['viva_config']['title']=='Reliable systems viva'
                    await student.get_by_role('button',name='End Viva Early',exact=True).click();await student.get_by_role('button',name='Finish & Submit',exact=True).click()
                    await expect(student.get_by_role('heading',name='Your viva has ended',exact=True)).to_be_visible()
                    manual=await faculty_context.request.post(f'http://127.0.0.1:13001/api/v1/sessions/{session_id}/override',data={'override_score':78,'reason':'Synthetic faculty review of saved recording and transcript.'},headers={'X-VivaAI-Request':'1'})
                    assert manual.ok
                    await student.goto('http://127.0.0.1:13000/sessions')
                    await student.get_by_label('Search interview history',exact=True).fill('Reliable systems')
                    await student.get_by_role('button',name='View feedback',exact=True).click()
                    async with student.expect_download() as pending:await student.get_by_role('button',name='Download assessment report',exact=True).click()
                    assert Path(await (await pending.value).path()).read_bytes().startswith(b'%PDF-')
                    await student.screenshot(path=str(ARTIFACTS/'student-feedback-mobile.png'),full_page=True)
                    await latest_card.get_by_text('More options',exact=True).click()
                    async with faculty.expect_download() as pending:await latest_card.get_by_role('button',name='Download questions',exact=True).click()
                    bank=json.loads(Path(await (await pending.value).path()).read_text());assert bank['questions'][0]['text']=='Explain fair mutex scheduling and starvation.'
                    await latest_card.get_by_role('link',name='Duplicate',exact=True).click()
                    await expect(faculty.get_by_label('Examination Title',exact=True)).to_have_value('Copy of Reliable systems viva revised')
                    await faculty.get_by_label('Examination Title',exact=True).fill('Reusable systems viva')
                    await faculty.get_by_role('navigation',name='Viva setup progress').get_by_role('button').nth(2).click()
                    await faculty.get_by_label('Import question bank (JSON)',exact=True).set_input_files({'name':'extra.json','mimeType':'application/json','buffer':json.dumps([{'text':'Explain a condition variable.','phase':'applied'}]).encode()})
                    await expect(faculty.get_by_label('Question 5 text',exact=True)).to_have_value('Explain a condition variable.')
                    await faculty.get_by_role('button',name='Approve Question',exact=True).last.click()
                    await faculty.get_by_role('navigation',name='Viva setup progress').get_by_role('button').nth(3).click()
                    await faculty.get_by_role('button',name='Publish Viva Examination',exact=True).click();await faculty.wait_for_url('**/dashboard')
                    await expect(faculty.get_by_role('article',name='Viva: Reusable systems viva',exact=True)).to_be_visible()
                    await faculty.get_by_role('button',name='Version history',exact=True).click()
                    await expect(faculty.get_by_role('article',name='Viva: Reliable systems viva',exact=True).get_by_text('Historical',exact=True)).to_be_visible()
                    await faculty.get_by_role('button',name='Latest versions',exact=True).click()
                    await faculty.screenshot(path=str(ARTIFACTS/'faculty-library-desktop.png'),full_page=True)
                    await faculty.set_viewport_size({'width':390,'height':844})
                    await faculty.screenshot(path=str(ARTIFACTS/'faculty-library-mobile.png'),full_page=True)
                    assert not await faculty.evaluate('document.documentElement.scrollWidth>innerWidth+1')
                    assert not errors,errors
                    (ARTIFACTS/'result.json').write_text(json.dumps({'passed':True,'versioned_editing':True,'concurrent_student_continuity':True,'reconnect_uses_original_version':True,'pause_enrollment':True,'editor_draft_restore':True,'invitation_sign_in':True,'question_import_export':True,'duplicate':True,'student_report_download':True,'mobile_layout':True,'browser_errors':errors},indent=2))
                    print('PASS: versioned editor, live student continuity, resume, library actions, question import/export, invitations, student PDF and mobile layout.',flush=True)
                except Exception:
                    await faculty.screenshot(path=str(ARTIFACTS/'failure-faculty.png'),full_page=True)
                    await student.screenshot(path=str(ARTIFACTS/'failure-student.png'),full_page=True)
                    (ARTIFACTS/'failure.txt').write_text((await faculty.locator('body').inner_text())+'\nSTUDENT\n'+(await student.locator('body').inner_text()))
                    raise
                finally:
                    await faculty_context.close();await student_context.close();await browser.close()
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait()
            for log in logs:log.close()

if __name__=='__main__':asyncio.run(main())
