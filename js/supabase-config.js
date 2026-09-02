(function () {
  "use strict";

  // Public browser configuration only. Never place a secret/service_role key here.
  window.FITINTERACT_SUPABASE_CONFIG = Object.freeze({
    url: "YOUR_SUPABASE_URL",
    publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
    videoBucket: "fitinteract-videos",
    signedUrlExpiresIn: 3600
  });
})();
