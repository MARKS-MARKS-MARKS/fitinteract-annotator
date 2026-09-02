(function (namespace) {
  "use strict";

  async function signIn(email, password) {
    const client = namespace.Cloud.getClient();
    const response = await client.auth.signInWithPassword({
      email: String(email || "").trim(),
      password: String(password || "")
    });
    if (response.error) throw response.error;
    return response.data;
  }

  async function signOut() {
    const response = await namespace.Cloud.getClient().auth.signOut();
    if (response.error) throw response.error;
  }

  async function getAuthenticatedUser() {
    const response = await namespace.Cloud.getClient().auth.getUser();
    if (response.error || !response.data.user) return null;
    return response.data.user;
  }

  async function getProfile(userId) {
    const response = await namespace.Cloud.getClient()
      .from("profiles")
      .select("id,annotator_code,display_name,role,created_at")
      .eq("id", userId)
      .single();
    if (response.error) throw response.error;
    return response.data;
  }

  async function requireProfile(allowedRoles) {
    const user = await getAuthenticatedUser();
    if (!user) return null;
    const profile = await getProfile(user.id);
    if (Array.isArray(allowedRoles) && !allowedRoles.includes(profile.role)) {
      const error = new Error("当前账号没有访问此页面的权限。");
      error.code = "FORBIDDEN";
      throw error;
    }
    return { user: user, profile: profile };
  }

  function redirectAfterLogin(profile, nextPage) {
    if (nextPage && /^[a-z0-9_-]+\.html(?:\?.*)?$/i.test(nextPage)) {
      window.location.href = "./" + nextPage;
      return;
    }
    window.location.href = profile.role === "admin" ? "./admin.html" : "./index.html?mode=online";
  }

  namespace.Auth = Object.freeze({
    signIn: signIn,
    signOut: signOut,
    getAuthenticatedUser: getAuthenticatedUser,
    getProfile: getProfile,
    requireProfile: requireProfile,
    redirectAfterLogin: redirectAfterLogin
  });
})(window.FitInteract = window.FitInteract || {});
