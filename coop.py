# Two headless browsers play co-op through the real Node server:
# host creates a company and hosts, guest joins with the code, both move around,
# the guest orders parts, and each side screenshots the other player.
import asyncio, subprocess, os, sys, time, json
from playwright.async_api import async_playwright

SP = os.environ.get("FOUNDRY_SHOTS", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test-output"))
os.makedirs(SP, exist_ok=True)
PORT = 8877
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"]
# headless audio is very CPU-hungry under SwiftShader: stub it for tests
NOAUDIO = "(()=>{const g=__game; g.audio.start=()=>{}; g.manual=true; window.G=g; return 'ready'})()"

async def main():
    env = dict(os.environ, PORT=str(PORT), FOUNDRY_LOCAL_THREE="1")
    srv = subprocess.Popen(["node", "server/server.js"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(1.2)
    logs = {"host": [], "guest": []}
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=ARGS)
            ch = await b.new_context(viewport={"width": 1100, "height": 620})
            cg = await b.new_context(viewport={"width": 1100, "height": 620})
            host, guest = await ch.new_page(), await cg.new_page()
            for name, pg in (("host", host), ("guest", guest)):
                pg.on("console", lambda m, n=name: logs[n].append(f"[{m.type}] {m.text}"))
                pg.on("pageerror", lambda e, n=name: logs[n].append(f"[pageerror] {e}"))
                await pg.goto(f"http://localhost:{PORT}/")
                await pg.wait_for_function("window.__game !== undefined", timeout=60000)
                await pg.evaluate(NOAUDIO)
                await pg.wait_for_function("__game.serverInfo !== null", timeout=10000)
            print("server info:", await host.evaluate("JSON.stringify(G.serverInfo)"))
            await host.screenshot(path=f"{SP}/co_menu.png")

            # host: profile + company, then host it
            await host.evaluate("""(async()=>{ const g=G; g.settings.name='Ethan'; g.settings.color=0x2fb5c9; g.saveSettings();
                const m=g.saves.create('Ross Industries', 0x2fb5c9); g.deploy=()=>{};
                const d=new (g.session.constructor)(g.world, null); const data=d.serialize(); data.funds=4000; d.dispose(); g.saves.write(m.id, data);
                await g.hostCoop(m.id); g.debugStart(); return 'hosting '+g.session.code })()""")
            code = await host.evaluate("G.session.code")
            print("session code:", code)
            await host.evaluate("(()=>{for(let i=0;i<10;i++) G.step(1/60); return 1})()")
            await host.screenshot(path=f"{SP}/co_host_ready.png")

            # guest: join by code
            await guest.evaluate("""(async()=>{ const g=G; g.settings.name='Gus'; g.settings.color=0xff6b1a; g.saveSettings(); g.deploy=()=>{};
                g.menu.show('coop'); return 1 })()""")
            await guest.fill("#join-code", code.lower())
            await guest.screenshot(path=f"{SP}/co_join.png")
            await guest.evaluate(f"(async()=>{{ await G.joinCoop('{code}'); G.debugStart(); return G.session.playerId }})()")
            print("guest id:", await guest.evaluate("G.session.playerId"), "funds seen by guest:", await guest.evaluate("G.factory.funds"))

            # run both clients in real time (manual stepping) for a few seconds while they move
            async def run(pg, secs, js_each=""):
                await pg.evaluate(f"""(async()=>{{ const g=G; const end=performance.now()+{secs*1000};
                    while(performance.now()<end){{ {js_each} g.step(1/30,false); await new Promise(r=>setTimeout(r,16)); }} return 1 }})()""")

            # host walks toward the guest's spawn and looks at them; guest faces the host
            await host.evaluate("(()=>{G.input.keys.add('KeyW'); G.yaw=Math.PI*0.5; return 1})()")
            await asyncio.gather(run(host, 1.2), run(guest, 1.2))
            await host.evaluate("(()=>{G.input.keys.delete('KeyW'); return 1})()")
            await asyncio.gather(run(host, 0.6), run(guest, 0.6))
            hp = json.loads(await host.evaluate("JSON.stringify({x:G.player.x,z:G.player.z})"))
            gp = json.loads(await guest.evaluate("JSON.stringify({x:G.player.x,z:G.player.z})"))
            seen = json.loads(await guest.evaluate("JSON.stringify(G.session.remoteStates().map(r=>({id:r.id,x:r.x,z:r.z})))"))
            print("host at", hp, "guest at", gp, "guest sees", seen)
            # point each camera at the other player
            await guest.evaluate(f"(()=>{{const g=G; const dx={hp['x']}-g.player.x, dz={hp['z']}-g.player.z; g.yaw=Math.atan2(-dx,-dz); g.pitch=-0.05; return 1}})()")
            await host.evaluate(f"(()=>{{const g=G; const dx={gp['x']}-g.player.x, dz={gp['z']}-g.player.z; g.yaw=Math.atan2(-dx,-dz); g.pitch=-0.05; g.view='tp'; return 1}})()")
            await asyncio.gather(run(host, 0.4), run(guest, 0.4))
            await host.evaluate("G.step(1/60)"); await guest.evaluate("G.step(1/60)")
            await guest.screenshot(path=f"{SP}/co_guest_sees_host.png")
            await host.screenshot(path=f"{SP}/co_host_sees_guest.png")

            # guest shoots (relayed muzzle flash + gunshot on the host side)
            await guest.evaluate("(()=>{G.input.mouse.left=true; return 1})()")
            await run(guest, 0.1)
            await guest.evaluate("(()=>{G.input.mouse.left=false; return 1})()")
            await asyncio.gather(run(host, 0.3), run(guest, 0.3))

            # guest orders parts through the terminal command; host's HUD funds follow
            f0 = await host.evaluate("G.factory.funds")
            await guest.evaluate("(()=>{G.factoryCommand({type:'order', items:{steel_plate:4}}, r=>{window.__res=r}); return 1})()")
            await asyncio.gather(run(host, 1.0), run(guest, 1.0))
            print("guest order result:", await guest.evaluate("JSON.stringify(window.__res)"))
            f1h, f1g = await host.evaluate("G.factory.funds"), await guest.evaluate("G.factory.funds")
            print(f"funds host {f0} -> {f1h}, guest sees {f1g}; truck host={await host.evaluate('G.factory.truck.phase')} guest={await guest.evaluate('G.factory.truck.phase')}")
            await host.evaluate("(()=>{G.state='paused'; document.body.dataset.state='paused'; G.menu.showPause('main'); G.step(1/60); return 1})()")
            await host.screenshot(path=f"{SP}/co_host_pause.png")

            # host ends the session: save written back to the host's slot, guest bounced to menu
            await host.evaluate("(()=>{G.quitToMenu(); return 1})()")
            await asyncio.gather(run(host, 1.5), run(guest, 1.5))
            meta = await host.evaluate("JSON.stringify(G.saves.list()[0])")
            print("host slot after session:", meta)
            print("guest state:", await guest.evaluate("G.state"), "| guest message:", await guest.evaluate("G.menu.msg && G.menu.msg.text"))
            await guest.evaluate("G.step(1/60)")
            await guest.screenshot(path=f"{SP}/co_guest_after.png")
            await b.close()
    finally:
        srv.terminate()
        out = srv.stdout.read() if srv.stdout else ""
        print("--- server log ---\n" + out[-1500:])
        for n, l in logs.items():
            errs = [x for x in l if "error" in x.lower() and "ERR_TUNNEL" not in x and "fonts" not in x]
            print(f"--- {n} errors ({len(errs)}) ---")
            for x in errs[:15]: print(x)

asyncio.run(main())
