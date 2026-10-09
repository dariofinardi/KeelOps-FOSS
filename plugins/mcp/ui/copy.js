// Copy button for the instructions page. External file on purpose: the core
// CSP blocks inline scripts and inline handlers; same-origin files are fine.
document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("copy-btn");
  const url = document.getElementById("mcp-url");
  if (!button || !url) return;
  const label = button.querySelector("span") ?? button;
  button.addEventListener("click", () => {
    navigator.clipboard.writeText(url.textContent).then(() => {
      const previous = label.textContent;
      label.textContent = button.dataset.copied || "Copiato";
      setTimeout(() => { label.textContent = previous; }, 1600);
    });
  });
});
