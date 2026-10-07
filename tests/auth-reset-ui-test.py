import json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
STUB="""window.__c=[];let cb=null;window.supabase={createClient:()=>({auth:{
 getSession:async()=>({data:{session:null}}),signOut:async(a)=>{window.__c.push(['signOut',a&&a.scope])},
 onAuthStateChange:(f)=>{cb=f;window.__fire=(e)=>cb(e);return {data:{subscription:{}}}},
 resetPasswordForEmail:async(e,o)=>{window.__c.push(['reset',e,o.redirectTo]);return {error:null}},
 signInWithOtp:async(a)=>{window.__c.push(['otp',a.email,a.options.shouldCreateUser]);return {error:null}},
 updateUser:async(a)=>{window.__c.push(['update',a.password]);return {error:null}}}})};"""
def api(route):
    u=urlparse(route.request.url)
    if u.path=="/api/auth/me": return route.fulfill(status=200,content_type="application/json",body=json.dumps({"user":{"id":"1","role":"buyer","first_name":"A"}}))
    if u.path.startswith("/api"): return route.fulfill(status=200,content_type="application/json",body="{}")
    route.continue_()
SHOP={"shop":{"id":1,"name":"StarMart","slug":"starmart","category":"Other","description":"d","color":"#ff4fa3","emoji":"🌟","openDays":[],"socials":{},"rating":None,"reviewCount":0,"orderCount":0}}
B="http://127.0.0.1:8765/"; res=[]
def ck(n,c): res.append(c); print("PASS" if c else "FAIL",n)
with sync_playwright() as p:
    b=p.chromium.launch()
    def pg():
        x=b.new_context().new_page(); x.errs=[]; x.on("pageerror",lambda e:x.errs.append(str(e)))
        x.route("**/cdn.jsdelivr.net/**",lambda r:r.fulfill(status=200,content_type="application/javascript",body=STUB)); x.route("**/api/**",api); return x
    a=pg(); a.goto(B+"auth.html"); a.fill("#login-email","jo@x.com"); a.click("#forgot-link")
    ck("forgot form visible, prefilled",a.is_visible("#form-forgot") and a.input_value("#forgot-email")=="jo@x.com" and not a.is_visible("#form-login"))
    a.click("#forgot-submit"); a.wait_for_selector("#forgot-msg:visible")
    c=a.evaluate("window.__c"); ck("resetPasswordForEmail with /reset-password.html redirect",c[0][0]=="reset" and c[0][2].endswith("/reset-password.html"))
    ck("generic message (no account enumeration)","If an account exists" in a.inner_text("#forgot-msg"))
    a.evaluate("document.getElementById('magic-submit').disabled=false"); a.click("#magic-submit")
    a.wait_for_timeout(200); c=a.evaluate("window.__c"); ck("magic link never creates accounts",c[-1]==["otp","jo@x.com",False])
    a.click("text=Back to sign in"); ck("back to login",a.is_visible("#form-login"))
    ck("no js errors auth",a.errs==[])
    r=pg(); r.goto(B+"reset-password.html"); r.wait_for_selector("#state-bad:visible",timeout=6000); ck("no recovery link -> invalid, form hidden",not r.is_visible("#state-form"))
    r=pg(); r.goto(B+"reset-password.html#access_token=x&type=recovery"); r.wait_for_timeout(300); r.evaluate("window.__fire('PASSWORD_RECOVERY')")
    r.wait_for_selector("#state-form:visible"); ck("recovery event shows form, token scrubbed from URL","access_token" not in r.url)
    r.fill("#pw1","short"); r.fill("#pw2","short"); r.evaluate("document.getElementById('pw1').removeAttribute('minlength');document.getElementById('pw2').removeAttribute('minlength')")
    r.click("#pw-btn"); ck("short rejected",("8 characters" in r.inner_text("#pw-err")) and not any(x[0]=="update" for x in r.evaluate("window.__c")))
    r.fill("#pw1","Newpass123"); r.fill("#pw2","Different1"); r.click("#pw-btn"); ck("mismatch rejected","don't match" in r.inner_text("#pw-err"))
    r.fill("#pw2","Newpass123"); r.click("#pw-btn"); r.wait_for_selector("#state-done:visible")
    c=r.evaluate("window.__c"); ck("updateUser called, other sessions revoked",["update","Newpass123"] in c and ["signOut","others"] in c)
    ck("no js errors reset",r.errs==[])
    s=pg(); s.route("**/api/shops/starmart",lambda q:q.fulfill(status=200,content_type="application/json",body=json.dumps(SHOP)))
    s.route("**/api/products/**",lambda q:q.fulfill(status=200,content_type="application/json",body='{"products":[]}'))
    s.route("http://127.0.0.1:8765/starmart",lambda q:q.fulfill(status=200,content_type="text/html",body=open("w/aurora-build/public/shop.html").read()))
    s.goto(B+"starmart"); s.wait_for_selector("text=StarMart",timeout=6000); ck("vanity path loads shop",True)
    s.evaluate("navigator.clipboard.writeText=(t)=>{window.__clip=t;return Promise.resolve()}"); s.evaluate("copyShopLink()")
    ck("copied link is /starmart",s.evaluate("window.__clip")==B+"starmart"); ck("no js errors shop",s.errs==[])
print("ALL PASS" if all(res) else "SOME FAILED")
