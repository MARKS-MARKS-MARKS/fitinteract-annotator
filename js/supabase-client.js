(function (namespace) {
  "use strict";

  let client = null;

  function config() {
    return window.FITINTERACT_SUPABASE_CONFIG || {};
  }

  function isConfigured() {
    const current = config();
    return typeof current.url === "string" && /^https:\/\/[^\s/]+/i.test(current.url) &&
      !current.url.includes("YOUR_SUPABASE") &&
      typeof current.publishableKey === "string" && current.publishableKey.length > 20 &&
      !current.publishableKey.includes("YOUR_SUPABASE");
  }

  function getClient() {
    if (!isConfigured()) throw new Error("Supabase 尚未配置。请填写 js/supabase-config.js。");
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase 浏览器 SDK 未加载。");
    }
    if (!client) {
      const current = config();
      client = window.supabase.createClient(current.url.replace(/\/$/, ""), current.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        },
        global: {
          headers: { "X-Client-Info": "fitinteract-annotator/2.0" }
        }
      });
    }
    return client;
  }

  function getVideoBucket() {
    return config().videoBucket || "fitinteract-videos";
  }

  function getSignedUrlExpiresIn() {
    const seconds = Number(config().signedUrlExpiresIn);
    return Number.isFinite(seconds) && seconds >= 60 ? seconds : 3600;
  }

  function getTusEndpoint() {
    if (!isConfigured()) throw new Error("Supabase 尚未配置。");
    const projectUrl = new URL(config().url);
    if (projectUrl.hostname.endsWith(".supabase.co")) {
      const projectRef = projectUrl.hostname.split(".")[0];
      return projectUrl.protocol + "//" + projectRef + ".storage.supabase.co/storage/v1/upload/resumable";
    }
    return config().url.replace(/\/$/, "") + "/storage/v1/upload/resumable";
  }

  function wantsOnlineMode() {
    const parameters = new URLSearchParams(window.location.search);
    const requested = parameters.get("mode");
    if (requested === "offline") return false;
    if (requested === "online") return true;
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function relativeUrl(page, parameters) {
    const query = parameters ? "?" + new URLSearchParams(parameters).toString() : "";
    return "./" + page + query;
  }

  namespace.Cloud = Object.freeze({
    config: config,
    isConfigured: isConfigured,
    getClient: getClient,
    getVideoBucket: getVideoBucket,
    getSignedUrlExpiresIn: getSignedUrlExpiresIn,
    getTusEndpoint: getTusEndpoint,
    wantsOnlineMode: wantsOnlineMode,
    relativeUrl: relativeUrl
  });
})(window.FitInteract = window.FitInteract || {});
