<script>
document.addEventListener("DOMContentLoaded", function () {

  const sampleReportsBtn = document.getElementById("sampleReportsBtn");
  const loginModal = document.getElementById("loginModal");
  const submitLogin = document.getElementById("submitLogin");

  if (sampleReportsBtn) {
    sampleReportsBtn.addEventListener("click", function (e) {
      e.preventDefault();
      loginModal.style.display = "flex";
    });
  }

  if (submitLogin) {
    submitLogin.addEventListener("click", async function () {

      const username = document.getElementById("username").value;
      const password = document.getElementById("password").value;

      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (response.status === 401) {
        document.getElementById("loginError").style.display = "block";
        return;
      }

      const result = await response.json();

      if (result.success) {
        window.location.href = "/demo_report_map.html";
      } else {
        document.getElementById("loginError").style.display = "block";
      }
    });
  }

});
</script>