// ===== LOGIN LOGIC =====

const runReportBtn = document.getElementById("runReportBtn");
const loginModal = document.getElementById("loginModal");
const submitLogin = document.getElementById("submitLogin");

runReportBtn.addEventListener("click", (e) => {
  e.preventDefault();
  loginModal.style.display = "flex";
});

submitLogin.addEventListener("click", async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    if (response.status === 401) {
      document.getElementById("loginError").style.display = "block";
      return;
    }

    const result = await response.json();

    if (result.success) {
      window.location.href = "demo_report_map.html";
    } else {
      document.getElementById("loginError").style.display = "block";
    }

  } catch (error) {
    console.error("Login error:", error);
  }
});