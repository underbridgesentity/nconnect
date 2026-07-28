import { chromium } from "@playwright/test";
const B="http://localhost:52853";
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1280,height:900}});
const msgs=[];
p.on("console",m=>{if(m.type()==="error")msgs.push(m.text().slice(0,160));});
await p.goto(B+"/",{waitUntil:"load",timeout:300000});
await p.waitForTimeout(2000);

const links = await p.evaluate(() =>
  [...document.querySelectorAll("a")]
    .filter(a => /get connected/i.test(a.textContent||""))
    .map(a => {
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return { href: a.getAttribute("href"), w: Math.round(r.width), h: Math.round(r.height),
               display: cs.display, visibility: cs.visibility,
               inHeader: !!a.closest("header"), parentTag: a.parentElement?.tagName };
    }));
console.log("Get connected links:", JSON.stringify(links, null, 1));

// Click the one in the header specifically and watch for navigation
const header = p.locator("header a", { hasText: /get connected/i }).first();
console.log("header link visible:", await header.isVisible());
console.log("header link href:", await header.getAttribute("href"));
await header.click();
await p.waitForTimeout(3000);
console.log("url after header click:", p.url());
console.log("console errors:", msgs.length ? msgs.slice(0,4) : "none");
await b.close();
