import { chromium } from "@playwright/test";
const B="http://localhost:52853", out=process.argv[2];
const b=await chromium.launch();
const errs=[];

// Desktop: click Get connected from the home page
const p=await b.newPage({viewport:{width:1280,height:900}});
p.on("pageerror",e=>errs.push("desktop: "+String(e).slice(0,120)));
await p.goto(B+"/",{waitUntil:"load",timeout:300000});
await p.waitForTimeout(1200);
await p.getByRole("link",{name:/get connected/i}).first().click();
await p.waitForLoadState("load",{timeout:300000});
await p.waitForTimeout(1500);
console.log("desktop after click:", p.url());
console.log("  wizard visible:", await p.getByText(/let.s get you connected/i).isVisible().catch(()=>false));
await p.screenshot({path:`${out}/s-desktop.png`});

// Mobile: through the hamburger menu
const m=await b.newPage({viewport:{width:390,height:844}});
m.on("pageerror",e=>errs.push("mobile: "+String(e).slice(0,120)));
await m.goto(B+"/",{waitUntil:"load",timeout:300000});
await m.waitForTimeout(1200);
await m.getByRole("link",{name:/get connected/i}).first().click();
await m.waitForLoadState("load",{timeout:300000});
await m.waitForTimeout(1500);
console.log("mobile after click:", m.url());
await m.screenshot({path:`${out}/s-mobile.png`});

// Favicon + head icons actually served
const icons = await p.evaluate(() =>
  [...document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]')]
    .map(l => ({ rel: l.getAttribute("rel"), href: l.getAttribute("href"), sizes: l.getAttribute("sizes") })));
console.log("head icons:", JSON.stringify(icons));
for (const path of ["/favicon.ico","/icon.png","/brand/icon-192.png","/brand/apple-touch-icon.png"]) {
  const r = await p.request.get(B+path);
  console.log(`  ${r.status()} ${r.headers()["content-type"] ?? ""} ${path}`);
}
console.log("page errors:", errs.length?errs:"none");
await b.close();
