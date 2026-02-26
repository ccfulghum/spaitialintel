const loginModal = document.getElementById("loginModal");
const runReportBtn = document.getElementById("runReportBtn");
const submitLogin = document.getElementById("submitLogin");

runReportBtn.addEventListener("click", () => {
  loginModal.style.display = "flex";
});

submitLogin.addEventListener("click", async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const result = await response.json();

  if (result.success) {
    window.location.href = "demo_report_map.html";
  } else {
    document.getElementById("loginError").style.display = "block";
  }
});