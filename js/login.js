(function (namespace) {
  "use strict";

  const form = document.getElementById("login-form");
  const email = document.getElementById("login-email");
  const password = document.getElementById("login-password");
  const button = document.getElementById("login-button");
  const message = document.getElementById("login-message");

  function showMessage(text, type) {
    message.textContent = text;
    message.className = "message " + (type || "error");
  }

  async function initialize() {
    if (!namespace.Cloud.isConfigured()) {
      showMessage("Supabase 尚未配置。请先按照 supabase/README_SUPABASE.md 填写 Project URL 与 Publishable Key。Offline Mode 仍可使用。", "info");
      button.disabled = true;
      return;
    }
    try {
      const identity = await namespace.Auth.requireProfile();
      if (identity) namespace.Auth.redirectAfterLogin(identity.profile, new URLSearchParams(location.search).get("next"));
    } catch (error) {
      showMessage("Session 恢复失败：" + error.message, "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!namespace.Cloud.isConfigured()) return;
    button.disabled = true;
    button.textContent = "登录中…";
    try {
      const result = await namespace.Auth.signIn(email.value, password.value);
      const profile = await namespace.Auth.getProfile(result.user.id);
      namespace.Auth.redirectAfterLogin(profile, new URLSearchParams(location.search).get("next"));
    } catch (error) {
      showMessage("Login failed：" + (error.message || "请检查邮箱和密码。"), "error");
      button.disabled = false;
      button.textContent = "登录";
    }
  });

  initialize();
})(window.FitInteract = window.FitInteract || {});
