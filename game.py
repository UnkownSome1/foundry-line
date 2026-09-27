import sys, asyncio, json, os
from playwright.async_api import async_playwright
SP = os.environ.get("FOUNDRY_SHOTS", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test-output"))
os.makedirs(SP, exist_ok=True)
# scenario file: list of [js_to_eval, screenshot_name_or_null]
async def main():
    scen = json.load(open(sys.argv[1]))
    w = int(sys.argv[2]) if len(sys.argv)>2 else 1100
    h = int(sys.argv[3]) if len(sys.argv)>3 else 650
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width":w,"height":h})
        logs=[]
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
        await pg.goto("http://localhost:8765/test/local.html")
        await pg.wait_for_function("window.__game !== undefined", timeout=60000)
        await pg.wait_for_timeout(500)
        for js, shot in scen:
            if js: 
                r = await pg.evaluate(js)
                if r is not None: print("eval:", r)
            if shot: await pg.screenshot(path=f"{SP}/{shot}.png", timeout=120000)
        for l in logs[:40]: print(l)
        await b.close()
asyncio.run(main())
