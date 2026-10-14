/**
 * Print windows (reports, bin labels) are blank pages opened by the app, so they follow its
 * Content-Security-Policy: no inline <style> or scripts. Their CSS is handed over as a file made in the
 * browser (blob: URL) instead. Downloaded HTML files are not affected (they keep their inline styles).
 */
export function linkStyles(html: string): string {
  return html.replace(/<style>([\s\S]*?)<\/style>/g, (_m, css: string) => `<link rel="stylesheet" href="${URL.createObjectURL(new Blob([css], { type: 'text/css' }))}">`);
}
/** Open a print window with this HTML and start printing once it has rendered. */
export function printHtml(html: string): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(linkStyles(html));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
  return true;
}
