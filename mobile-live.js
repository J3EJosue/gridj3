const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const mobile = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await mobile.goto('https://gridj3.vercel.app/', { waitUntil: 'networkidle' });
  await mobile.waitForSelector('text=Ajustes');
  await mobile.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await mobile.waitForTimeout(150);
  const info = await mobile.evaluate(() => {
    const footer = document.querySelector('.credit-footer').getBoundingClientRect();
    return { footerTop: footer.top, position: getComputedStyle(document.querySelector('.credit-footer')).position };
  });
  console.log('mobile footer:', JSON.stringify(info));
  await mobile.screenshot({ path: 'live-mobile-footer.png' });
  await browser.close();
})();
