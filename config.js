/*
  Optional settings. The app works with this file exactly as it is.

  sharing: group location and a plan that stays in sync across phones.
    Off until you add your own free Supabase project (see the README, "Share with the group").
    The URL and the publishable key are meant to be public, so they are safe to put here.
    Never put a secret or service key in this file.

  disneyMapTiles: true shows the park illustration, loaded from Disney's own servers while you browse.
    Nothing from Disney is stored in this repo. Set false to use the free street map only.

  parkMapUrl: leave empty to use the default. Set it only if you host your own tiles.
*/
window.DD_CONFIG = {
  sharing: { url: "", key: "" },
  disneyMapTiles: true,
  parkMapUrl: "",
};
