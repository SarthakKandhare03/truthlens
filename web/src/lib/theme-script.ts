// The theme bootstrap script, kept OUT of any "use client" module: the root
// layout (a server component) needs the actual string to inline it, and
// importing a value from a client module would only give it a reference.
export const THEME_STORAGE_KEY = "truthlens-theme";

/**
 * Runs in <head> before the first paint: applies the saved theme, so the page
 * never flashes the wrong one. With no saved choice it opens on "night shift"
 * (dark), the site's signature look. Tiny and dependency-free.
 */
export const THEME_INIT_SCRIPT = `(function(){var t="dark";try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.dataset.theme=t})()`;
