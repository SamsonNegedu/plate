// Applies the cached theme before first paint. It is a file, not an inline script, because the CSP allows only 'self'.
try {
  var t = localStorage.getItem("plate.theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
