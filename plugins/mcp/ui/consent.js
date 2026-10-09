// Consent form guard: one submission only. The pending request is single-use,
// so a double click must not burn it and then show "request expired".
"use strict";
const form = document.querySelector("form");
if (form) form.addEventListener("submit", (ev) => {
  if (form.dataset.sent) { ev.preventDefault(); return; }
  form.dataset.sent = "1";
  const pressed = ev.submitter;
  // disable AFTER the browser has read the submitter value
  setTimeout(() => {
    for (const b of form.querySelectorAll("button")) b.disabled = true;
    if (pressed && pressed.dataset.wait)
      (pressed.querySelector("span") ?? pressed).textContent = pressed.dataset.wait;
  });
});
