# Demo playable

A small playable to try PlayGuard without a file of your own: tap three stars, then an end card with an Install button.

| File | What for |
| --- | --- |
| `demo.html` | Playable tied to no network: the button opens the store with `window.open` |
| `builds/applovin/index.html` | Build for AppLovin (`mraid.open`) |
| `builds/unity/index.html` | Build for Unity Ads (`mraid.open`) |
| `builds/meta/index.html` | Build for Meta (`FbPlayableAd.onCTAClick`) |
| `demo-builds.zip` | The same three builds in one archive |

How to try it:

1. **One playable.** Check → drop `builds/applovin/index.html`. At the Playthrough step enter `com.example.demo` in the Google Play field: that is the app the demo's button leads to. Then play it, or press Quick check.
2. **Every network at once.** Builds → drop `demo-builds.zip` (or the `builds` folder). PlayGuard works out which build is for which network and checks all three.

Every check passes on the demo: this is what a "Ready" verdict looks like.
