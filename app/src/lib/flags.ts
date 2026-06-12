// Compile-time feature flags — flip, rebuild, deploy.
//
// EVENT_NIGHT_NAV: surfaces the Election Night page in the desktop nav and the
// mobile tab bar, and switches the page header into its live framing (LIVE
// pill, present-tense copy). The page itself stays routable at /election-night
// either way — call-detail back-links depend on it. Turn this on for the next
// big live-event night, back off once it's over.
export const EVENT_NIGHT_NAV = false;
