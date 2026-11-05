/*
  Optional settings. The app works with this file exactly as it is.

  sharing: group location and a plan that stays in sync across phones.
    Off until you add your own free Supabase project (see the README, "Share with the group").
    The URL and the publishable key are meant to be public, so they are safe to put here.
    Never put a secret or service key in this file.

  disneyMapTiles: true shows the park illustration, loaded from Disney's own servers while you browse.
    Nothing from Disney is stored in this repo. Set false to use the free street map only.

  parkMapUrl: leave empty to use the default. Set it only if you host your own tiles.

  feedback: where the Send feedback button on the Settings tab sends notes. Notes go to the person who made
    the planner, who reads them weekly. The URL and publishable key are meant to be public. Set url to ""
    to hide the button (for example in your own copy).
*/
window.DD_CONFIG = {
  sharing: { url: "", key: "" },
  disneyMapTiles: true,
  parkMapUrl: "",
  feedback: { url: "https://numipmedkfrcwfjikcxv.supabase.co", key: "sb_publishable_wkZJwHrOEGqj2g6UnVbulw_E6R1Msj2" },
};
